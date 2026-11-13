import json
import logging
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler

from server.duel_service import ApiError, STREAM_TIMEOUT_SECONDS, generate, load_context

CAPACITY = threading.BoundedSemaphore(1)


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        try:
            import ortools
            from ortools.sat.python import cp_model
            cp_model.CpModel()
            self.send_json(200, {"engine": "cp-sat", "version": 1, "ortools": ortools.__version__})
        except ImportError:
            self.send_json(503, {"error": "SOLVER_NOT_CONFIGURED"})

    def do_POST(self):
        started = time.monotonic()
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            self.send_json(401, {"error": "SOLVER_UNAUTHORIZED"}); return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2_000_000:
                raise ApiError("SOLVER_INVALID_REQUEST", 413)
            body = json.loads(self.rfile.read(size))
            context = load_context(body, authorization[7:])
        except ApiError as error:
            self.send_json(error.status, {"error": error.code}); return
        except (ValueError, TypeError):
            self.send_json(400, {"error": "SOLVER_INVALID_REQUEST"}); return
        if not CAPACITY.acquire(blocking=False):
            self.send_json(429, {"error": "SOLVER_BUSY"}); return
        cancelled = threading.Event()
        events = queue.Queue()
        def run():
            try:
                result = generate(context, cancelled, lambda profile: events.put({"type": "squadProgress", **profile} if isinstance(profile, dict) else {"type": "progress", "profile": profile}))
                events.put({"type": "result", "result": result})
            except ApiError as error:
                events.put({"type": "error", "error": error.code})
            except Exception:
                logging.exception("Team Duel solver failed")
                events.put({"type": "error", "error": "SOLVER_FAILED"})
            finally:
                CAPACITY.release()
        worker = threading.Thread(target=run, daemon=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        worker.start()
        try:
            while time.monotonic() - started < STREAM_TIMEOUT_SECONDS:
                try:
                    event = events.get(timeout=.5)
                except queue.Empty:
                    event = {"type": "heartbeat"}
                self.wfile.write((json.dumps(event) + "\n").encode())
                self.wfile.flush()
                if event["type"] in ("result", "error"):
                    return
            self.wfile.write((json.dumps({"type": "error", "error": "SOLVER_TIMEOUT"}) + "\n").encode())
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            cancelled.set()
            worker.join(timeout=2)
