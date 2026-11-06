"""Fixed-squad CP-SAT scheduling. No database access or fixture writes."""
import itertools
import json
import math
import sys
import time
import threading
import random
from pathlib import Path

import ortools
from ortools.sat.python import cp_model

EPS = 1e-12


def forecast(probabilities):
    """Same independent-game distribution as src/lib/seasonForecast.ts."""
    distribution = [1.0] + [0.0] * len(probabilities)
    for i, probability in enumerate(probabilities):
        for wins in range(i + 1, -1, -1):
            distribution[wins] = distribution[wins] * (1 - probability) + (
                distribution[wins - 1] * probability if wins else 0
            )
    home = sum(p for wins, p in enumerate(distribution) if 2 * wins > len(probabilities))
    away = sum(p for wins, p in enumerate(distribution) if 2 * wins < len(probabilities))
    tie = distribution[len(probabilities) // 2] if len(probabilities) % 2 == 0 else 0
    return {"home": home, "away": away, "tie": tie,
            "decisiveHome": home / (home + away) if home + away > 0 else None}


def balanced(result):
    return result["decisiveHome"] is not None and .45 - EPS <= result["decisiveHome"] <= .55 + EPS


def solve(request, cancelled=None):
    cancelled = cancelled or threading.Event()
    started = time.perf_counter()
    size = request["size"]
    if size not in (4, 5, 6, 7):
        raise ValueError("Squad size must be 4..7")
    settings = request["settings"]
    partner_cap = settings["maxPartnerMeetings"]
    opponent_cap = settings["maxOpponentMeetings"]
    for cap in (partner_cap, opponent_cap):
        if cap is not None and (type(cap) is not int or not 1 <= cap < size):
            raise ValueError("Invalid meeting cap")
    partner_cap = partner_cap if partner_cap is not None else size - 1
    opponent_cap = opponent_cap if opponent_cap is not None else size - 1
    probabilities = request["probabilities"]
    edges = list(itertools.combinations(range(size), 2))
    game_count = len(edges) ** 2
    if len(probabilities) != game_count or any(not math.isfinite(p) or not 0 <= p <= 1 for p in probabilities):
        raise ValueError("Expected one authoritative probability per pair of doubles lineups")
    costs = [max(p, 1 - p) for p in probabilities]
    levels = sorted(set(costs))
    ranks = {cost: i for i, cost in enumerate(levels)}
    rounds = size - 1 + size % 2
    total_games = size * (size - 1) // 2
    limit = request.get("seconds", 15)
    if not math.isfinite(limit) or limit <= 0:
        raise ValueError("Positive finite benchmark time budget required")
    deadline = started + limit
    profile = request.get("profile", "primary")
    model = cp_model.CpModel()
    variables = {}
    by_round = [[] for _ in range(rounds)]
    by_game = [[] for _ in range(game_count)]
    appearances = [[[] for _ in range(2 * size)] for _ in range(rounds)]
    partners = [[[] for _ in edges] for _ in range(2)]
    opponents = [[[] for _ in range(size)] for _ in range(size)]
    upper = request.get("maxWorst", 1)
    worst = model.new_int_var(0, len(levels) - 1, "worst_rank")
    for r in range(rounds):
        for h, home in enumerate(edges):
            # Any odd-squad schedule can label its rounds by the home bye.
            # This removes round permutations without restricting matchups.
            if size % 2 and r in home:
                continue
            for a, away in enumerate(edges):
                g = h * len(edges) + a
                if costs[g] > upper + EPS:
                    continue
                x = model.new_bool_var(f"r{r}_g{g}")
                variables[r, g] = x
                by_round[r].append(x)
                by_game[g].append(x)
                partners[0][h].append(x)
                partners[1][a].append(x)
                for p in home:
                    appearances[r][p].append(x)
                for p in away:
                    appearances[r][size + p].append(x)
                for p in home:
                    for q in away:
                        opponents[p][q].append(x)
                model.add(worst >= ranks[costs[g]]).only_enforce_if(x)
        model.add(sum(by_round[r]) == size // 2)
        for player in range(2 * size):
            model.add(sum(appearances[r][player]) <= 1)
    for player in range(2 * size):
        model.add(sum(x for r in range(rounds) for x in appearances[r][player]) == size - 1)
    partner_used = [[], []]
    for side, pairs in enumerate(partners):
        for pair_index, pair in enumerate(pairs):
            used = model.new_bool_var(f"partner_used_{side}_{pair_index}")
            model.add(sum(pair) <= partner_cap * used)
            model.add(sum(pair) >= used)
            partner_used[side].append(used)
    opponent_used = [[None for _ in range(size)] for _ in range(size)]
    opponent_counts = []
    for p, row in enumerate(opponents):
        for q, pair in enumerate(row):
            used = model.new_bool_var(f"opponent_used_{p}_{q}")
            model.add(sum(pair) <= opponent_cap * used)
            model.add(sum(pair) >= used)
            opponent_used[p][q] = used
            count = model.new_int_var(0, opponent_cap, f"opponent_count_{p}_{q}")
            model.add(count == sum(pair))
            opponent_counts.append(count)
    # These are consequences of participation and the caps, not new coverage
    # rules. Explicit cardinality constraints give SAT propagation more help.
    for p in range(size):
        for side in range(2):
            model.add(sum(partner_used[side][e] for e, pair in enumerate(edges) if p in pair)
                      >= math.ceil((size - 1) / partner_cap))
        model.add(sum(opponent_used[p]) >= math.ceil(2 * (size - 1) / opponent_cap))
        model.add(sum(opponent_used[q][p] for q in range(size)) >= math.ceil(2 * (size - 1) / opponent_cap))
    counts = []
    for g, xs in enumerate(by_game):
        count = model.new_int_var(0, min(partner_cap, opponent_cap), f"count_{g}")
        model.add(count == sum(xs))
        counts.append(count)
    excluded = {tuple(row) for row in request.get("excluded", [])}
    if excluded:
        if any(len(row) != game_count or any(type(x) is not int or x < 0 or x > size - 1 for x in row) for row in excluded):
            raise ValueError("Invalid excluded schedule")
        model.add_forbidden_assignments(counts, list(excluded))
    if not size % 2:
        first_games = []
        for r in range(rounds):
            first = model.new_int_var(0, game_count, f"first_{r}")
            model.add_min_equality(first, [g + (game_count - g) * (1 - x)
                                         for (round_index, g), x in variables.items() if round_index == r])
            first_games.append(first)
        for r in range(rounds - 1):
            model.add(first_games[r] <= first_games[r + 1])
    scale = 1_000_000
    outside = sum(x for (_, g), x in variables.items() if costs[g] > .6 + EPS)
    mean_cost = sum(round(costs[g] * scale) * x for (_, g), x in variables.items())
    history_weights = request.get("partnerHistory", [[0] * len(edges), [0] * len(edges)])
    history = sum(history_weights[side][e] * used for side in range(2) for e, used in enumerate(partner_used[side]))
    covered = sum(used for row in opponent_used for used in row)
    used_partners = sum(used for side in partner_used for used in side)
    repeats = []
    for i, count in enumerate(opponent_counts):
        repeat = model.new_int_var(0, opponent_cap * (opponent_cap - 1) // 2, f"repeats_{i}")
        model.add_element(count, [n * (n - 1) // 2 for n in range(opponent_cap + 1)], repeat)
        repeats.append(repeat)
    hard = []
    disadvantages = []
    for player in range(2 * size):
        side, index = divmod(player, size)
        hard_games, penalties = [], []
        for (r, g), x in variables.items():
            pair = edges[g // len(edges)] if side == 0 else edges[g % len(edges)]
            if index not in pair:
                continue
            probability = probabilities[g] if side == 0 else 1 - probabilities[g]
            if probability < .4:
                hard_games.append(x)
            penalties.append(round(max(0, .5 - probability) * scale) * x)
        hard.append(sum(hard_games))
        disadvantages.append(sum(penalties))
    max_hard = model.new_int_var(0, size - 1, "max_hard")
    max_disadvantage = model.new_int_var(0, (size - 1) * scale, "max_disadvantage")
    model.add_max_equality(max_hard, hard)
    model.add_max_equality(max_disadvantage, disadvantages)
    objectives = {
        "primary": [worst],
        "balance": [worst, outside, mean_cost, history],
        "variety": [-covered, -used_partners, sum(repeats), worst, mean_cost, history],
        "experience": [max_hard, max_disadvantage, worst, mean_cost, history],
    }[profile]
    model.minimize(objectives[0])
    build_ms = (time.perf_counter() - started) * 1000
    best = None
    first_balanced_ms = None
    rejected = 0
    attempts = 0
    branches = 0
    conflicts = 0
    proved = 0

    def candidate(value):
        selected = [(r, g) for (r, g), variable in variables.items() if value(variable)]
        assert len(selected) == total_games
        result = forecast([probabilities[g] for _, g in selected])
        return {"games": [{"round": r + 1, "home": list(edges[g // len(edges)]),
                            "away": list(edges[g % len(edges)])} for r, g in selected],
                "forecast": result, "worstFavorite": max(costs[g] for _, g in selected)}

    def rank(result):
        indices = [edges.index(tuple(sorted(g["home"]))) * len(edges) + edges.index(tuple(sorted(g["away"]))) for g in result["games"]]
        partner_counts = [[0] * len(edges), [0] * len(edges)]
        opponent_meetings = [[0] * size for _ in range(size)]
        hard_games, penalty = [0] * (size * 2), [0] * (size * 2)
        for g in indices:
            h, a = divmod(g, len(edges))
            partner_counts[0][h] += 1; partner_counts[1][a] += 1
            for p in edges[h]:
                for q in edges[a]:
                    opponent_meetings[p][q] += 1
            for side, pair in enumerate((edges[h], edges[a])):
                p = probabilities[g] if side == 0 else 1 - probabilities[g]
                for i in pair:
                    hard_games[side * size + i] += int(p < .4)
                    penalty[side * size + i] += round(max(0, .5 - p) * scale)
        balance_rank = (ranks[result["worstFavorite"]], sum(costs[g] > .6 + EPS for g in indices), sum(round(costs[g] * scale) for g in indices))
        history_rank = sum(history_weights[s][e] for s in range(2) for e, count in enumerate(partner_counts[s]) if count)
        if profile == "primary":
            return balance_rank[:1]
        if profile == "balance":
            return (*balance_rank, history_rank)
        if profile == "variety":
            return (-sum(c > 0 for row in opponent_meetings for c in row), -sum(c > 0 for row in partner_counts for c in row), sum(c * (c - 1) // 2 for row in opponent_meetings for c in row), balance_rank[0], balance_rank[2], history_rank)
        return (max(hard_games), max(penalty), balance_rank[0], balance_rank[2], history_rank)

    # A structural seed gives CP-SAT an immediate valid incumbent rather than
    # spending most of a short request budget rediscovering basic feasibility.
    warm_deadline = min(deadline, time.perf_counter() + request.get("warmMs", 0) / 1000)
    recipe = json.loads(Path(__file__).with_name("duel_skeletons.json").read_text()).get(str(size), [])
    rng = random.Random(request.get("seed", 1))
    edge_indices = {edge: i for i, edge in enumerate(edges)}
    while time.perf_counter() < warm_deadline and not cancelled.is_set():
        permutations = [rng.sample(range(size), size), rng.sample(range(size), size)]
        games = [{"round": g["round"], "home": sorted(permutations[0][p] for p in g["home"]), "away": sorted(permutations[1][p] for p in g["away"])} for g in recipe]
        count_vector = [0] * game_count
        ps = []
        for game in games:
            g = edge_indices[tuple(game["home"])] * len(edges) + edge_indices[tuple(game["away"])]
            count_vector[g] += 1; ps.append(probabilities[g])
        if not games or tuple(count_vector) in excluded or max(max(p, 1 - p) for p in ps) > upper + EPS:
            continue
        # Recipes meet 2/2. Stricter partner caps need a separate check.
        pc = [[0] * len(edges), [0] * len(edges)]
        for game in games:
            for side, key in enumerate(("home", "away")):
                pc[side][edge_indices[tuple(game[key])]] += 1
        if any(c > partner_cap for row in pc for c in row):
            continue
        result = {"games": games, "forecast": forecast(ps), "worstFavorite": max(max(p, 1 - p) for p in ps)}
        if balanced(result["forecast"]) and (best is None or rank(result) < rank(best)):
            best = result; first_balanced_ms = first_balanced_ms or (time.perf_counter() - started) * 1000
    if best:
        hint_games = best["games"]
        if size % 2:
            for r in set(g["round"] for g in hint_games):
                bye = next(p for p in range(size) if all(p not in g["home"] for g in hint_games if g["round"] == r))
                for g in hint_games:
                    if g["round"] == r:
                        g["hintRound"] = bye
        else:
            order = sorted(set(g["round"] for g in hint_games), key=lambda r: min(edge_indices[tuple(g["home"])] * len(edges) + edge_indices[tuple(g["away"])] for g in hint_games if g["round"] == r))
            for g in hint_games:
                g["hintRound"] = order.index(g["round"])
        hint = {(g["hintRound"], edge_indices[tuple(g["home"])] * len(edges) + edge_indices[tuple(g["away"])]) for g in hint_games}
        for key, variable in variables.items():
            model.add_hint(variable, int(key in hint))
        if profile in ("primary", "balance"):
            model.add(worst <= ranks[best["worstFavorite"]])

    class Incumbents(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            nonlocal best, first_balanced_ms
            result = candidate(self.value)
            if balanced(result["forecast"]) and (best is None or rank(result) < rank(best)):
                best = result
                if first_balanced_ms is None:
                    first_balanced_ms = (time.perf_counter() - started) * 1000

    solver_status = "UNKNOWN"
    optimal = False
    best_bound = None
    while time.perf_counter() < deadline and not cancelled.is_set():
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(.001, deadline - time.perf_counter())
        solver.parameters.num_search_workers = request.get("workers", 1)
        solver.parameters.random_seed = int(request.get("seed", 1)) % 2_147_483_647
        # Presolve can overrun a short wall-time limit before search begins.
        # Interactive requests use structural hints and skip that unbounded work.
        solver.parameters.cp_model_presolve = request.get("presolve", True)
        finished = threading.Event()
        def watch():
            while not finished.wait(.1):
                if cancelled.is_set():
                    solver.stop_search(); return
        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            status = solver.solve(model, Incumbents())
        finally:
            finished.set(); watcher.join()
        attempts += 1
        branches += solver.num_branches
        conflicts += solver.num_conflicts
        solver_status = solver.status_name(status)
        if status == cp_model.MODEL_INVALID:
            raise ValueError(solver.solution_info())
        if status in (cp_model.INFEASIBLE, cp_model.UNKNOWN):
            break
        best_bound = levels[max(0, min(len(levels) - 1, math.ceil(solver.best_objective_bound - EPS)))]
        result = candidate(solver.value)
        if balanced(result["forecast"]):
            if best is None or rank(result) <= rank(best):
                best = result
            if status != cp_model.OPTIMAL:
                break
            model.add(objectives[proved] == solver.value(objectives[proved]))
            proved += 1
            if proved == len(objectives):
                optimal = True; break
            model.minimize(objectives[proved])
            continue
        # Season odds depend on the game multiset, not the round arrangement.
        # Exclude every arrangement of this rejected multiset, then re-solve.
        model.add_forbidden_assignments(counts, [[solver.value(count) for count in counts]])
        rejected += 1
    return {"name": request.get("name"), "ortoolsVersion": ortools.__version__, "formulationVersion": 3,
            "workers": request.get("workers", 1), "buildMs": build_ms,
            "elapsedMs": (time.perf_counter() - started) * 1000,
            "firstBalancedMs": first_balanced_ms, "optimal": optimal,
            "status": "OPTIMAL" if optimal else "FEASIBLE" if best else "INFEASIBLE" if solver_status == "INFEASIBLE" else "UNKNOWN",
            "solverStatus": solver_status, "bestBound": best_bound,
            "attempts": attempts, "rejectedForSeasonBalance": rejected,
            "branches": branches, "conflicts": conflicts,
            "variables": len(variables), "solution": best}


if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        print(json.dumps(solve(request)), flush=True)
