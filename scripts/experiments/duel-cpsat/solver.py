"""CLI adapter for the production solver; used by the offline benchmark."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from server.duel_solver import balanced, forecast, solve

if __name__ == "__main__":
    for line in sys.stdin:
        print(json.dumps(solve(json.loads(line))), flush=True)
