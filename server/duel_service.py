"""Authenticated, read-only scheduling API. Supabase remains the save authority."""
import json
import math
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ApiError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


class SupabaseReader:
    def __init__(self, token):
        self.url = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").rstrip("/")
        self.key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
        if not self.url or not self.key:
            raise ApiError("SOLVER_NOT_CONFIGURED", 503)
        self.token = token

    def request(self, path, query=None, body=None):
        url = self.url + path + ("?" + urlencode(query) if query else "")
        data = json.dumps(body).encode() if body is not None else None
        request = Request(url, data=data, headers={"apikey": self.key, "Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=8) as response:
                return json.load(response)
        except HTTPError as error:
            raise ApiError("SOLVER_UNAUTHORIZED" if error.code in (401, 403) else "SOLVER_DATA_UNAVAILABLE", 401 if error.code in (401, 403) else 502) from None
        except (URLError, TimeoutError, ValueError):
            raise ApiError("SOLVER_DATA_UNAVAILABLE", 502) from None

    def rpc(self, name, body):
        return self.request("/rest/v1/rpc/" + name, body=body)


def identifier(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ApiError("SOLVER_INVALID_REQUEST") from None


def load_context(body, token, reader=None):
    if not isinstance(body, dict) or not isinstance(token, str) or not token:
        raise ApiError("SOLVER_UNAUTHORIZED", 401)
    reader = reader or SupabaseReader(token)
    user = reader.request("/auth/v1/user")
    if user.get("app_metadata", {}).get("role") != "admin":
        raise ApiError("SOLVER_FORBIDDEN", 403)
    season_id = identifier(body.get("seasonId"))
    seasons = reader.request("/rest/v1/seasons", {"id": "eq." + season_id, "select": "id,league_id,status,format"})
    if len(seasons) != 1:
        raise ApiError("SOLVER_SEASON_UNAVAILABLE", 404)
    season = seasons[0]
    if season["status"] != "active" or season["format"] != "team_duel":
        raise ApiError("SOLVER_SEASON_UNAVAILABLE", 409)
    league_id = season["league_id"]
    if identifier(body.get("leagueId")) != league_id:
        raise ApiError("SOLVER_INVALID_REQUEST")
    snapshot = reader.rpc("league_duel_rating_snapshot", {"p_league_id": league_id})
    if snapshot != {"revision": body.get("revision"), "fingerprint": body.get("fingerprint")}:
        raise ApiError("DUEL_STALE_DRAFT", 409)
    with ThreadPoolExecutor(max_workers=4) as executor:
        roster_future = executor.submit(reader.request, "/rest/v1/season_roster", {"season_id": "eq." + season_id, "select": "pool_player_id"})
        pool_future = executor.submit(reader.request, "/rest/v1/league_players", {"league_id": "eq." + league_id, "select": "pool_player_id,rating,rating_deviation,status"})
        fixtures_future = executor.submit(reader.request, "/rest/v1/matches", {"season_id": "eq." + season_id, "select": "id", "limit": "1"})
        history_future = executor.submit(reader.rpc, "league_duel_partner_history", {"p_season_id": season_id})
        roster, pool, fixtures, history = roster_future.result(), pool_future.result(), fixtures_future.result(), history_future.result()
    if fixtures:
        raise ApiError("SOLVER_SEASON_HAS_MATCHES", 409)
    ids = [row["pool_player_id"] for row in roster]
    if len(ids) not in (8, 10, 12, 14):
        raise ApiError("SOLVER_INVALID_ROSTER")
    by_id = {row["pool_player_id"]: row for row in pool}
    for player in ids:
        row = by_id.get(player)
        if not row or row["status"] != "active" or any(type(row.get(key)) not in (float, int) or not math.isfinite(row[key]) for key in ("rating", "rating_deviation")) or row["rating_deviation"] < 0:
            raise ApiError("SOLVER_INVALID_ROSTER")
    order = lambda p: (-by_id[p]["rating"], p)
    mode = body.get("searchMode", "fixed")
    if mode not in ("fixed", "shuffle"):
        raise ApiError("SOLVER_INVALID_REQUEST")
    if mode == "shuffle":
        ordered = sorted(ids, key=order)
        squads = [ordered[:len(ids) // 2], ordered[len(ids) // 2:]]
    else:
        squads = body.get("squads")
        if not isinstance(squads, list) or len(squads) != 2 or any(not isinstance(side, list) or len(side) != len(ids) // 2 for side in squads):
            raise ApiError("SOLVER_INVALID_ROSTER")
        squads = [[identifier(p) for p in side] for side in squads]
        if len(set(squads[0] + squads[1])) != len(ids) or set(squads[0] + squads[1]) != set(ids):
            raise ApiError("DUEL_STALE_DRAFT", 409)
        if any(side != sorted(side, key=order) for side in squads) or min(ids, key=order) not in squads[0]:
            raise ApiError("DUEL_STALE_DRAFT", 409)
    size = len(ids) // 2
    settings = body.get("settings")
    if not isinstance(settings, dict) or not {"maxPartnerMeetings", "maxOpponentMeetings"} <= set(settings) or set(settings) - {"maxPartnerMeetings", "maxOpponentMeetings", "maxMatchProbability"}:
        raise ApiError("SOLVER_INVALID_LIMITS")
    max_probability = settings.get("maxMatchProbability", .65)
    if type(max_probability) not in (float, int) or not math.isfinite(max_probability) or not .5 <= max_probability <= 1:
        raise ApiError("SOLVER_INVALID_LIMITS")
    for cap in (settings["maxPartnerMeetings"], settings["maxOpponentMeetings"]):
        if cap is not None and (type(cap) is not int or not 1 <= cap < size):
            raise ApiError("SOLVER_INVALID_LIMITS")
    if settings["maxOpponentMeetings"] is not None and size * settings["maxOpponentMeetings"] < 2 * (size - 1):
        raise ApiError("SOLVER_INVALID_LIMITS")
    excluded = body.get("excludedIds", [])
    if not isinstance(excluded, list) or len(excluded) > 512 or any(not isinstance(s, str) or len(s) > 5000 for s in excluded):
        raise ApiError("SOLVER_INVALID_REQUEST")
    search_lists = {}
    for field in ("seenSplitIds", "skipSplitIds"):
        values = body.get(field, [])
        if not isinstance(values, list) or len(values) > 1716 or any(not isinstance(value, str) or len(value) > 1024 for value in values):
            raise ApiError("SOLVER_INVALID_REQUEST")
        search_lists[field] = values
    attempt = body.get("attempt", 0)
    if type(attempt) is not int or not 0 <= attempt <= 6 or mode == "shuffle" and excluded:
        raise ApiError("SOLVER_INVALID_REQUEST")
    after = reader.rpc("league_duel_rating_snapshot", {"p_league_id": league_id})
    if after != snapshot:
        raise ApiError("DUEL_STALE_DRAFT", 409)
    return {"reader": reader, "seasonId": season_id, "leagueId": league_id, "snapshot": snapshot, "squads": squads, "pool": by_id,
            "settings": settings, "excluded": excluded, "history": history, "seed": int.from_bytes(os.urandom(4), "little"),
            "searchMode": mode, "attempt": attempt, **search_lists}


def normal_cdf(z):
    # Same complementary-error approximation used by ts-gaussian and SQL.
    x = -z / math.sqrt(2)
    a = abs(x)
    t = 1 / (1 + a / 2)
    r = t * math.exp(-a*a - 1.26551223 + t*(1.00002368 + t*(.37409196 + t*(.09678418 + t*(-.18628806 + t*(.27886807 + t*(-1.13520398 + t*(1.48851587 + t*(-.82215223 + t*.17087277)))))))))
    return .5 * (r if x >= 0 else 2-r)


def generate(context, cancelled, progress, *, initial=None, deadline=None):
    if context.get("searchMode") == "shuffle":
        return search_squads(context, cancelled, progress)
    from itertools import combinations
    from server.duel_solver import solve
    squads, pool, settings = context["squads"], context["pool"], context["settings"]
    size = len(squads[0])
    edges = list(combinations(range(size), 2))
    probabilities = []
    for home in edges:
        for away in edges:
            h, a = [pool[squads[0][i]] for i in home], [pool[squads[1][i]] for i in away]
            delta = sum(p["rating"] for p in h) - sum(p["rating"] for p in a)
            variance = 250000 + sum(p["rating_deviation"] ** 2 for p in h + a)
            probabilities.append(normal_cdf(delta / math.sqrt(variance)))
    def schedule_id(games):
        return "|".join(sorted(":".join(sorted(g["homePoolPlayerIds"])) + "/" + ":".join(sorted(g["awayPoolPlayerIds"])) for g in games))
    def excluded_vector(value):
        vector = [0] * len(probabilities)
        try:
            for match in value.split("|"):
                home, away = match.split("/")
                h = tuple(sorted(squads[0].index(p) for p in home.split(":")))
                a = tuple(sorted(squads[1].index(p) for p in away.split(":")))
                vector[edges.index(h) * len(edges) + edges.index(a)] += 1
        except (ValueError, TypeError):
            raise ApiError("SOLVER_INVALID_REQUEST") from None
        if sum(vector) != size * (size - 1) // 2:
            raise ApiError("SOLVER_INVALID_REQUEST")
        return vector
    excluded = [excluded_vector(value) for value in context["excluded"]]
    previous = context["history"]
    history_weights = [[sum(1 for season in previous["seasonIds"] if any(set(pair["poolPlayerIds"]) == {side[a], side[b]} and season in pair["seasonIds"] for pair in previous["partnerships"])) for a, b in edges] for side in squads]
    results = []
    deadline = deadline or time.perf_counter() + 24
    maximum = settings.get("maxMatchProbability", .65)
    upper = maximum
    for index, profile in enumerate(("balance", "variety", "experience")):
        if cancelled.is_set():
            return None
        seconds = min((10, 7, 7)[index], deadline - time.perf_counter())
        if seconds < .2:
            break
        progress(profile)
        result = initial if index == 0 and initial is not None else solve({"size": size, "settings": settings, "probabilities": probabilities, "seconds": seconds, "workers": 1,
                        "seed": context["seed"] + index, "profile": profile, "warmMs": 350, "maxWorst": upper, "presolve": False,
                        "excluded": excluded, "partnerHistory": history_weights}, cancelled)
        if not result["solution"]:
            if not results:
                return {"options": [], "status": result["status"]}
            continue
        games = [{"roundNumber": g["round"], "sequenceNumber": i + 1,
                  "homePoolPlayerIds": [squads[0][p] for p in g["home"]], "awayPoolPlayerIds": [squads[1][p] for p in g["away"]]}
                 for i, g in enumerate(result["solution"]["games"])]
        identity = schedule_id(games)
        if identity in context["excluded"] or any(r["id"] == identity for r in results):
            raise ApiError("SOLVER_INVALID_RESULT", 500)
        results.append({"id": identity, "kind": profile, "games": games, "solver": {"status": result["status"], "elapsedMs": result["elapsedMs"]}})
        excluded.append(excluded_vector(identity))
        if profile == "balance":
            upper = min(maximum, result["solution"]["worstFavorite"] + .05)
    if cancelled.is_set():
        return None
    if context["reader"].rpc("league_duel_rating_snapshot", {"p_league_id": context["leagueId"]}) != context["snapshot"]:
        raise ApiError("DUEL_STALE_DRAFT", 409)
    roster = context["reader"].request("/rest/v1/season_roster", {"season_id": "eq." + context["seasonId"], "select": "pool_player_id"})
    if {row["pool_player_id"] for row in roster} != set(squads[0] + squads[1]):
        raise ApiError("DUEL_STALE_DRAFT", 409)
    return {"options": results, "status": "FEASIBLE" if results else "UNKNOWN"}


def split_id(squads):
    return "|".join(":".join(sorted(side)) for side in squads)


def search_squads(context, cancelled, progress):
    """Search the whole roster in bounded batches; skip only prior proved splits."""
    import itertools
    import random
    from server.duel_solver import solve
    started = time.perf_counter()
    search_deadline, overall_deadline = started + 20, started + 40
    pool, settings = context["pool"], context["settings"]
    ids = sorted(context["squads"][0] + context["squads"][1], key=lambda p: (-pool[p]["rating"], p))
    size = len(ids) // 2
    edges = list(itertools.combinations(range(size), 2))
    seen, skipped = set(context.get("seenSplitIds", [])), set(context.get("skipSplitIds", []))
    rng = random.Random(context["seed"])
    candidates = []
    for tail in itertools.combinations(ids[1:], size - 1):
        home = [ids[0], *tail]
        squads = [home, [p for p in ids if p not in home]]
        identity = split_id(squads)
        gap = abs(sum(pool[p]["rating"] for p in home) - sum(pool[p]["rating"] for p in squads[1]))
        candidates.append((identity, squads, gap, rng.random()))
    total = len(candidates)
    identities = {c[0] for c in candidates}
    if not skipped <= identities or not seen <= identities:
        raise ApiError("SOLVER_INVALID_REQUEST")
    minimum = min(c[2] for c in candidates)
    # Prefer new, similarly rated squads. Larger gaps remain in the search:
    # total ratings are a heuristic, never a condition-feasibility proof.
    current = set(context["seenSplitIds"][-1].split("|")[0].split(":")) if context.get("seenSplitIds") else set()
    def moved(candidate):
        changed = len(set(candidate[1][0]) - current)
        return min(changed, size - changed) if current else 0
    candidates.sort(key=lambda c: (c[0] in seen, int((c[2] - minimum) / (size * 5)), -moved(c), c[3]))
    probability_cache = {}
    history = {frozenset(pair["poolPlayerIds"]): len(set(pair["seasonIds"]) & set(context["history"]["seasonIds"])) for pair in context["history"]["partnerships"]}
    proved = []
    last_progress = 0
    def update(force=False):
        nonlocal last_progress
        now = time.perf_counter()
        if force or now - last_progress > .15:
            progress({"phase": "squads", "checked": len(skipped) + len(proved), "total": total})
            last_progress = now
    def finish(result):
        if cancelled.is_set():
            return None
        if context["reader"].rpc("league_duel_rating_snapshot", {"p_league_id": context["leagueId"]}) != context["snapshot"]:
            raise ApiError("DUEL_STALE_DRAFT", 409)
        roster = context["reader"].request("/rest/v1/season_roster", {"season_id": "eq." + context["seasonId"], "select": "pool_player_id"})
        if {row["pool_player_id"] for row in roster} != set(ids):
            raise ApiError("DUEL_STALE_DRAFT", 409)
        update(True)
        return {**result, "scope": "roster", "provenInfeasibleSplitIds": proved, "totalSplits": total}
    update(True)
    for identity, squads, _, _ in candidates:
        if cancelled.is_set():
            return None
        if identity in skipped:
            continue
        if time.perf_counter() >= search_deadline:
            break
        probabilities = []
        partners = [[set() for _ in range(size)] for _ in range(2)]
        opponents = [[set() for _ in range(size)] for _ in range(2)]
        for h in edges:
            for a in edges:
                home, away = tuple(squads[0][i] for i in h), tuple(squads[1][i] for i in a)
                key = (home, away)
                if key not in probability_cache:
                    hp, ap = [pool[p] for p in home], [pool[p] for p in away]
                    delta = sum(p["rating"] for p in hp) - sum(p["rating"] for p in ap)
                    variance = 250000 + sum(p["rating_deviation"] ** 2 for p in hp + ap)
                    probability_cache[key] = normal_cdf(delta / math.sqrt(variance))
                probability = probability_cache[key]
                probabilities.append(probability)
                if max(probability, 1 - probability) > settings.get("maxMatchProbability", .65) + 1e-12:
                    continue
                for side, pair, other in ((0, h, a), (1, a, h)):
                    for player in pair:
                        partners[side][player].update(set(pair) - {player})
                        opponents[side][player].update(other)
        required_partners = math.ceil((size - 1) / (settings["maxPartnerMeetings"] or size - 1))
        required_opponents = math.ceil(2 * (size - 1) / (settings["maxOpponentMeetings"] or size - 1))
        if any(len(choices) < required_partners for side in partners for choices in side) or any(len(choices) < required_opponents for side in opponents for choices in side):
            proved.append(identity); update(); continue
        seconds = min(.5 * 2 ** context.get("attempt", 0), 5, search_deadline - time.perf_counter())
        if seconds <= .01:
            break
        result = solve({"size": size, "settings": settings, "probabilities": probabilities, "seconds": seconds, "workers": 1,
                        "seed": context["seed"], "profile": "primary", "warmMs": 0, "maxWorst": settings.get("maxMatchProbability", .65),
                        "presolve": False, "partnerHistory": [[history.get(frozenset(side[i] for i in edge), 0) for edge in edges] for side in squads]}, cancelled)
        if result["solution"]:
            fixed = {**context, "squads": squads, "searchMode": "fixed", "excluded": []}
            schedules = generate(fixed, cancelled, progress, initial={**result, "status": "FEASIBLE", "optimal": False}, deadline=overall_deadline)
            if schedules is None:
                return None
            return finish({**schedules, "squads": squads})
        if result["status"] == "INFEASIBLE":
            proved.append(identity)
        update()
    # Skipped proof records belong to the client's current snapshot. The client
    # checks full, unique roster coverage before reporting a combined proof.
    all_here = len(proved) == total
    return finish({"options": [], "status": "INFEASIBLE" if all_here else "UNKNOWN"})
