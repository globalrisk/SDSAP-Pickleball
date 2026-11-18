"""Authenticated, read-only scheduling API. Supabase remains the save authority."""
import json
import math
import os
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import cache
from itertools import combinations
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SEARCH_SECONDS = 240
SCREEN_SECONDS = 60
FINAL_CHECK_SECONDS = 20
STREAM_TIMEOUT_SECONDS = 280


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
    mode = body.get("searchMode", "generate")
    if mode not in ("generate", "shuffle") or "squads" in body or "excludedIds" in body:
        raise ApiError("SOLVER_INVALID_REQUEST")
    current = body.get("currentSplitId")
    if mode == "shuffle" and (not isinstance(current, str) or len(current) > 1024) or mode == "generate" and current is not None:
        raise ApiError("SOLVER_INVALID_REQUEST")
    size = len(ids) // 2
    settings = body.get("settings")
    if not isinstance(settings, dict) or not {"maxPartnerMeetings", "maxOpponentMeetings"} <= set(settings) or set(settings) - {"maxPartnerMeetings", "maxOpponentMeetings", "maxMatchProbability", "maxRatingDifference"}:
        raise ApiError("SOLVER_INVALID_LIMITS")
    max_probability = settings.get("maxMatchProbability", .65)
    if type(max_probability) not in (float, int) or not math.isfinite(max_probability) or not .5 <= max_probability <= 1:
        raise ApiError("SOLVER_INVALID_LIMITS")
    gap = settings.get("maxRatingDifference")
    if gap is not None and (type(gap) not in (float, int) or not math.isfinite(gap) or gap < 0 or gap != math.floor(gap)):
        raise ApiError("SOLVER_INVALID_LIMITS")
    for cap in (settings["maxPartnerMeetings"], settings["maxOpponentMeetings"]):
        if cap is not None and (type(cap) is not int or not 1 <= cap < size):
            raise ApiError("SOLVER_INVALID_LIMITS")
    if settings["maxOpponentMeetings"] is not None and size * settings["maxOpponentMeetings"] < 2 * (size - 1):
        raise ApiError("SOLVER_INVALID_LIMITS")
    search_lists = {}
    for field in ("seenSplitIds", "skipSplitIds"):
        values = body.get(field, [])
        if not isinstance(values, list) or len(values) > 1716 or any(not isinstance(value, str) or len(value) > 1024 for value in values):
            raise ApiError("SOLVER_INVALID_REQUEST")
        search_lists[field] = values
    attempt = body.get("attempt", 0)
    if type(attempt) is not int or not 0 <= attempt <= 6:
        raise ApiError("SOLVER_INVALID_REQUEST")
    after = reader.rpc("league_duel_rating_snapshot", {"p_league_id": league_id})
    if after != snapshot:
        raise ApiError("DUEL_STALE_DRAFT", 409)
    return {"reader": reader, "seasonId": season_id, "leagueId": league_id, "snapshot": snapshot, "roster": ids, "pool": by_id,
            "settings": settings, "history": history, "seed": int.from_bytes(os.urandom(4), "little"),
            "searchMode": mode, "currentSplitId": current, "attempt": attempt, **search_lists}


def normal_cdf(z):
    # Same complementary-error approximation used by ts-gaussian and SQL.
    x = -z / math.sqrt(2)
    a = abs(x)
    t = 1 / (1 + a / 2)
    r = t * math.exp(-a*a - 1.26551223 + t*(1.00002368 + t*(.37409196 + t*(.09678418 + t*(-.18628806 + t*(.27886807 + t*(-1.13520398 + t*(1.48851587 + t*(-.82215223 + t*.17087277)))))))))
    return .5 * (r if x >= 0 else 2-r)



def split_id(squads):
    return "|".join(":".join(sorted(side)) for side in squads)


@dataclass
class Candidate:
    id: str
    squads: list
    gap: float
    pair_bound: int
    probabilities: list | None = None
    filtered: bool = False
    result: dict | None = None


def generate(context, cancelled, progress, *, deadline=None):
    """Compare verified schedules, or optimize another split on a shuffle."""
    from server.duel_prefilter import impossible_split
    from server.duel_solver import EPS, rating_difference_mask, solve

    started = time.perf_counter()
    deadline = min(deadline, started + SEARCH_SECONDS) if deadline is not None else started + SEARCH_SECONDS
    screen_deadline = min(deadline, started + SCREEN_SECONDS)
    pool, settings = context["pool"], context["settings"]
    ids = sorted(context["roster"], key=lambda p: (-pool[p]["rating"], p))
    size = len(ids) // 2
    edges = list(combinations(range(size), 2))
    edge_count = len(edges)
    max_pairs = size * (2 * size - 1)
    match_ceiling = settings.get("maxMatchProbability", .65)
    total_rating = sum(pool[p]["rating"] for p in ids)
    seen = set(context.get("seenSplitIds", []))
    skipped = set(context.get("skipSplitIds", []))
    current = context["currentSplitId"]
    shuffle = context["searchMode"] == "shuffle"
    attempt = context["attempt"]
    rng = random.Random(context["seed"])
    candidates = []
    for tail in combinations(ids[1:], size - 1):
        home = [ids[0], *tail]
        squads = [home, [p for p in ids if p not in home]]
        identity = split_id(squads)
        gap = abs(2 * sum(pool[p]["rating"] for p in home) - total_rating)
        candidates.append(Candidate(identity, squads, gap, max_pairs))
    total = len(candidates)
    identities = {c.id for c in candidates}
    if not skipped <= identities or not seen <= identities or (shuffle and current not in identities) or skipped & (seen | {current}):
        raise ApiError("SOLVER_INVALID_REQUEST")
    candidates = [c for c in candidates if c.id not in skipped and c.id != current]

    # The union of pairs in legal matchups is an upper bound on the coverage
    # any complete schedule can attain. Each matchup contributes six pairs.
    pair_masks = [
        (1 << h) | (1 << (edge_count + a)) |
        sum(1 << (2 * edge_count + p * size + q) for p in home for q in away)
        for h, home in enumerate(edges) for a, away in enumerate(edges)
    ]
    season_ids = set(context["history"]["seasonIds"])
    history = {frozenset(pair["poolPlayerIds"]): len(season_ids.intersection(pair["seasonIds"]))
               for pair in context["history"]["partnerships"]}
    player_index = {p: i + 1 for i, p in enumerate(ids)}

    @cache
    def probability(home, away):
        hp, ap = [pool[p] for p in home], [pool[p] for p in away]
        delta = sum(p["rating"] for p in hp) - sum(p["rating"] for p in ap)
        variance = 250000 + sum(p["rating_deviation"] ** 2 for p in hp + ap)
        return normal_cdf(delta / math.sqrt(variance))

    proved = set()
    phase = "screening"
    last_update = -math.inf

    def update(force=False):
        nonlocal last_update
        now = time.perf_counter()
        if force or now - last_update > .15:
            progress({"phase": phase, "checked": len(skipped) + len(proved), "total": total})
            last_update = now

    def ratings_for(squads):
        return [[pool[p]["rating"] for p in side] for side in squads]

    def prepare(c):
        home, away = [[tuple(side[i] for i in edge) for edge in edges] for side in c.squads]
        c.probabilities = [probability(h, a) for h in home for a in away]
        eligible = rating_difference_mask(size, settings, ratings_for(c.squads))
        pairs = 0
        for allowed, chance, mask in zip(eligible, c.probabilities, pair_masks):
            if allowed and max(chance, 1 - chance) <= match_ceiling + EPS:
                pairs |= mask
        c.pair_bound = pairs.bit_count()

    def prefilter(c, ratings):
        c.filtered = True
        if impossible_split(size, settings, c.probabilities, ratings):
            proved.add(c.id)

    update(True)
    prefilter_deadline = min(screen_deadline, started + 5)
    for c in candidates:
        if cancelled.is_set():
            return None
        if time.perf_counter() >= screen_deadline:
            break
        prepare(c)
        if time.perf_counter() < prefilter_deadline:
            prefilter(c, ratings_for(c.squads))
            update()
    candidates = [c for c in candidates if c.id not in proved]

    if shuffle:
        current_home = set(current.split("|")[0].split(":"))
        def moved(c):
            difference = len(set(c.squads[0]) - current_home)
            return min(difference, size - difference)
        candidates.sort(key=lambda c: (c.id in seen, int(c.gap / (size * 5)), -moved(c), rng.random()))
    else:
        candidates.sort(key=lambda c: (-c.pair_bound, c.gap, c.id))

    def try_split(c, until, max_seconds, warm_ms):
        if cancelled.is_set() or time.perf_counter() >= until:
            return
        if c.probabilities is None:
            prepare(c)
        ratings = ratings_for(c.squads)
        if not c.filtered:
            prefilter(c, ratings)
        seconds = min(max_seconds, until - time.perf_counter())
        if c.id in proved or seconds <= .01:
            return
        prior = c.result["solution"] if c.result else None
        # A stable ordering and seed make the first search repeatable for the same inputs.
        seed = (rng.randrange(2_147_483_647) if shuffle else
                218 + attempt + sum(i * player_index[p] for i, p in enumerate(c.squads[0], 1)) + bool(prior))
        result = solve({
            "size": size, "settings": settings, "ratings": ratings, "probabilities": c.probabilities,
            "seconds": seconds, "workers": 1, "seed": seed, "profile": "variety", "warmMs": warm_ms,
            "maxWorst": match_ceiling, "presolve": False,
            "partnerHistory": [[history.get(frozenset(side[i] for i in edge), 0) for edge in edges] for side in c.squads],
        }, cancelled, initial=prior)
        if result["solution"]:
            c.result = result
            if result.get("pairUpperBound") is not None:
                c.pair_bound = min(c.pair_bound, result["pairUpperBound"])
        elif result["status"] == "INFEASIBLE":
            proved.add(c.id)
        update()

    def candidate_rank(c):
        return (c.result["rank"], c.id)

    probe_seconds = min(.5 * 2 ** attempt, 5)
    best = None
    for c in candidates:
        if cancelled.is_set() or time.perf_counter() >= screen_deadline:
            break
        if best and c.pair_bound < -best.result["rank"][0]:
            continue
        try_split(c, screen_deadline, probe_seconds, 50)
        if c.result and (best is None or candidate_rank(c) < candidate_rank(best)):
            best = c
            if shuffle:
                break

    phase = "optimizing"
    update(True)
    if best is None:
        for c in candidates:
            if cancelled.is_set() or time.perf_counter() >= deadline:
                break
            if c.id not in proved:
                try_split(c, deadline, 5, 100)
                if c.result:
                    best = c
                    break

    if best and shuffle:
        if not best.result["optimal"]:
            try_split(best, deadline, SEARCH_SECONDS, 0)
    elif best:
        verified = sorted((c for c in candidates if c.result), key=candidate_rank)
        shortlist = [c for c in verified[:3] if not c.result["optimal"]]
        unresolved = next((c for c in candidates if c.result is None and c.id not in proved
                           and c.pair_bound >= -best.result["rank"][0]), None)
        if unresolved:
            shortlist.append(unresolved)
        for i, c in enumerate(shortlist):
            share = (deadline - time.perf_counter()) / (len(shortlist) - i)
            try_split(c, deadline, share, 0 if c.result else 100)
        best = min((c for c in candidates if c.result), key=candidate_rank)

    if cancelled.is_set():
        return None
    if context["reader"].rpc("league_duel_rating_snapshot", {"p_league_id": context["leagueId"]}) != context["snapshot"]:
        raise ApiError("DUEL_STALE_DRAFT", 409)
    roster = context["reader"].request("/rest/v1/season_roster", {"season_id": "eq." + context["seasonId"], "select": "pool_player_id"})
    if {row["pool_player_id"] for row in roster} != set(ids):
        raise ApiError("DUEL_STALE_DRAFT", 409)
    if cancelled.is_set():
        return None
    update(True)

    result = {"options": [], "status": "UNKNOWN", "scope": "roster",
              "totalSplits": total, "provenInfeasibleSplitIds": sorted(proved)}
    if best is None:
        if len(skipped) + len(proved) == total - int(shuffle):
            result["status"] = "INFEASIBLE"
        return result

    score = -best.result["rank"][0]
    solver = {"status": best.result["status"], "elapsedMs": (time.perf_counter() - started) * 1000}
    if shuffle and score >= best.pair_bound:
        solver["coverageProof"] = "squads"
    elif not shuffle and all(c.id in proved or c.pair_bound <= score for c in candidates):
        solver["coverageProof"] = "roster"
    games = [{"roundNumber": g["round"], "sequenceNumber": i + 1,
              "homePoolPlayerIds": [best.squads[0][p] for p in g["home"]],
              "awayPoolPlayerIds": [best.squads[1][p] for p in g["away"]]}
             for i, g in enumerate(best.result["solution"]["games"])]
    return {**result, "options": [{"kind": "variety", "games": games, "solver": solver}],
            "status": "FEASIBLE", "squads": best.squads}
