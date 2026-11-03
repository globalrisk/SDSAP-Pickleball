"""Local HTTP adapter for exercising the deployed handler against test Supabase."""
import importlib.util
import json
import sys
import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location("duel_handler", root / "api" / "duel-solve.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=0)
args = parser.parse_args()
server = ThreadingHTTPServer(("127.0.0.1", args.port), module.handler)
print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}"}), flush=True)
server.serve_forever()
