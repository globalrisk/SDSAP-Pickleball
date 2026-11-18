import threading
import time
import unittest
import uuid
from collections import Counter
from itertools import combinations
from unittest.mock import patch

from server.duel_service import ApiError, generate, load_context, normal_cdf, split_id


class Reader:
    def __init__(self, size=4):
        self.size = size
        self.ids = [str(uuid.UUID(int=i + 1)) for i in range(size * 2)]
        self.league = str(uuid.UUID(int=101))
        self.season = str(uuid.UUID(int=201))
        self.admin, self.fixtures = True, False
        self.snapshot = {"revision": 1, "fingerprint": "fingerprint"}
        self.ratings = [1500] * len(self.ids)
        self.deviations = [90] * len(self.ids)

    def request(self, path, query=None, body=None):
        if path == "/auth/v1/user":
            return {"app_metadata": {"role": "admin" if self.admin else "player"}}
        if path == "/rest/v1/seasons":
            return [{"id": self.season, "league_id": self.league, "status": "active", "format": "team_duel"}]
        if path == "/rest/v1/season_roster":
            return [{"pool_player_id": p} for p in self.ids]
        if path == "/rest/v1/league_players":
            return [{"pool_player_id": p, "rating": r, "rating_deviation": rd, "status": "active"}
                    for p, r, rd in zip(self.ids, self.ratings, self.deviations)]
        if path == "/rest/v1/matches":
            return [{"id": "fixture"}] if self.fixtures else []
        raise AssertionError(path)

    def rpc(self, name, body):
        if name == "league_duel_rating_snapshot":
            return self.snapshot
        if name == "league_duel_partner_history":
            return {"leagueId": self.league, "seasonIds": [], "partnerships": []}
        raise AssertionError(name)

    def body(self, **overrides):
        return {"leagueId": self.league, "seasonId": self.season, **self.snapshot,
                "searchMode": "generate", "settings": {"maxPartnerMeetings": 2, "maxOpponentMeetings": 3},
                **overrides}

    def split_ids(self):
        ids = sorted(self.ids, key=lambda p: (-self.ratings[self.ids.index(p)], p))
        for tail in combinations(ids[1:], self.size - 1):
            home = [ids[0], *tail]
            yield split_id([home, [p for p in ids if p not in home]])


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.reader = Reader()

    def context(self, **overrides):
        return load_context(self.reader.body(**overrides), "token", self.reader)

    def run_search(self, context, seconds=3):
        return generate(context, threading.Event(), lambda _: None, deadline=time.perf_counter() + seconds)

    def test_authentication_and_authorization_precede_solving(self):
        with self.assertRaises(ApiError) as error:
            load_context(self.reader.body(), "", self.reader)
        self.assertEqual(error.exception.status, 401)
        self.reader.admin = False
        with self.assertRaises(ApiError) as error:
            load_context(self.reader.body(), "token", self.reader)
        self.assertEqual(error.exception.status, 403)

    def test_stale_snapshot_and_fixture_existence_are_rejected(self):
        with self.assertRaisesRegex(ApiError, "DUEL_STALE_DRAFT"):
            self.context(revision=0)
        self.reader.fixtures = True
        with self.assertRaisesRegex(ApiError, "SOLVER_SEASON_HAS_MATCHES"):
            self.context()

    def test_validation_rejects_old_requests_and_unknown_shuffle_splits(self):
        for overrides in ({"searchMode": "fixed"}, {"excludedIds": []}, {"squads": []}, {"searchMode": "shuffle"}):
            with self.assertRaisesRegex(ApiError, "SOLVER_INVALID_REQUEST"):
                self.context(**overrides)
        with self.assertRaisesRegex(ApiError, "SOLVER_INVALID_REQUEST"):
            self.run_search(self.context(searchMode="shuffle", currentSplitId="outside-roster"))

    def test_limits_are_validated(self):
        defaults = self.reader.body()["settings"]
        for key, invalid in (
            ("maxOpponentMeetings", [1]),
            ("maxMatchProbability", [None, True, "65", .49, 1.01, float("nan"), float("inf")]),
            ("maxRatingDifference", [-1, .5, True, "400", float("nan"), float("inf")]),
        ):
            for value in invalid:
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ApiError, "SOLVER_INVALID_LIMITS"):
                    self.context(settings={**defaults, key: value})

    def test_ranking_point_cap_prefilters_all_splits(self):
        self.reader.ratings[0] = 1900.01
        context = self.context(settings={**self.reader.body()["settings"], "maxRatingDifference": 400})
        with patch("server.duel_solver.solve") as solver:
            result = self.run_search(context)
        solver.assert_not_called()
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(len(result["provenInfeasibleSplitIds"]), 35)

    def test_generation_picks_the_split_with_more_pairs(self):
        self.reader.ratings = [1910, 1840, 1800, 1700, 1570, 1470, 1310, 1140]
        self.reader.deviations = [65, 160, 65, 160, 65, 90, 65, 120]
        context = self.context(settings={**self.reader.body()["settings"], "maxMatchProbability": .68})
        result = self.run_search(context, 8)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(result["squads"][0], [self.reader.ids[i] for i in (0, 3, 5, 6)])
        option, = result["options"]
        self.assertEqual(option["kind"], "variety")
        self.assertEqual(option["solver"]["coverageProof"], "roster")
        partners = {tuple(side) for g in option["games"] for side in (g["homePoolPlayerIds"], g["awayPoolPlayerIds"])}
        opponents = {(p, q) for g in option["games"] for p in g["homePoolPlayerIds"] for q in g["awayPoolPlayerIds"]}
        self.assertEqual((len(partners), len(opponents)), (12, 16))

    def test_single_preview_for_all_supported_rosters(self):
        from server.duel_solver import solve
        for size in range(4, 8):
            with self.subTest(size=size):
                reader = Reader(size)
                preferred, *other = reader.split_ids()
                context = load_context(reader.body(skipSplitIds=other), "token", reader)

                def checked(request, cancelled, *, initial):
                    self.assertEqual(request["maxWorst"], .65)
                    self.assertEqual(request["profile"], "variety")
                    return solve({**request, "seconds": min(request["seconds"], .5)}, cancelled, initial=initial)

                with patch("server.duel_solver.solve", side_effect=checked):
                    result = self.run_search(context)
                option, = result["options"]
                self.assertEqual(split_id(result["squads"]), preferred)
                self.assertEqual(len(option["games"]), size * (size - 1) // 2)
                self.assertEqual(len({tuple(sorted(g["homePoolPlayerIds"] + g["awayPoolPlayerIds"])) for g in option["games"]}), len(option["games"]))
                counts = Counter((p, q) for g in option["games"] for p in g["homePoolPlayerIds"] for q in g["awayPoolPlayerIds"])
                self.assertLessEqual(max(counts.values()), 3)

    def test_shuffle_excludes_current_and_prefers_unseen(self):
        current, seen, *_ = self.reader.split_ids()
        options = self.run_search(self.context(searchMode="shuffle", currentSplitId=current, seenSplitIds=[current, seen]))
        self.assertNotIn(split_id(options["squads"]), [current, seen])
        self.assertEqual(len(options["options"]), 1)
        self.assertEqual(options["options"][0]["solver"]["coverageProof"], "squads")

    def test_shuffle_reports_impossibility_only_after_proving_all_other_splits(self):
        current, *others = self.reader.split_ids()
        context = self.context(searchMode="shuffle", currentSplitId=current)
        with patch("server.duel_solver.solve", return_value={"solution": None, "status": "INFEASIBLE"}):
            result = self.run_search(context)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(set(result["provenInfeasibleSplitIds"]), set(others))

    def test_unknown_split_can_be_retried_and_is_never_recorded_as_a_proof(self):
        first, *others = self.reader.split_ids()
        context = self.context(skipSplitIds=others)
        with patch("server.duel_solver.solve", return_value={"solution": None, "status": "UNKNOWN"}) as solver:
            result = self.run_search(context)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["provenInfeasibleSplitIds"], [])
        self.assertEqual(solver.call_count, 2)
        context["attempt"] = 1
        result = self.run_search(context)
        self.assertEqual(split_id(result["squads"]), first)

    def test_search_honors_one_deadline_and_cancellation(self):
        event = threading.Event()
        event.set()
        self.assertIsNone(generate(self.context(), event, lambda _: None))
        with patch("server.duel_solver.solve") as solver:
            result = self.run_search(self.context(), 0)
        solver.assert_not_called()
        self.assertEqual(result["status"], "UNKNOWN")

    def test_rating_change_during_search_invalidates_proofs(self):
        def changed(request, cancelled, *, initial):
            self.reader.snapshot = {"revision": 2, "fingerprint": "changed"}
            return {"solution": None, "status": "INFEASIBLE"}

        context = self.context()
        with patch("server.duel_solver.solve", side_effect=changed):
            with self.assertRaisesRegex(ApiError, "DUEL_STALE_DRAFT"):
                self.run_search(context)

    def test_probability_approximation_agrees_with_known_values(self):
        self.assertAlmostEqual(normal_cdf(0), .500000015, places=12)
        self.assertAlmostEqual(normal_cdf(1), .8413447386, places=9)


if __name__ == "__main__":
    unittest.main()
