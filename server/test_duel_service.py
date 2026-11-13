import threading
import unittest
import uuid
from unittest.mock import patch

from server.duel_service import ApiError, generate, load_context, normal_cdf


class Reader:
    def __init__(self, size=4):
        self.size = size
        self.ids = [str(uuid.UUID(int=i + 1)) for i in range(size * 2)]
        self.league = str(uuid.UUID(int=101))
        self.season = str(uuid.UUID(int=201))
        self.admin, self.fixtures = True, False
        self.snapshot = {"revision": 1, "fingerprint": "fingerprint"}

    def request(self, path, query=None, body=None):
        if path == "/auth/v1/user":
            return {"app_metadata": {"role": "admin" if self.admin else "player"}}
        if path == "/rest/v1/seasons":
            return [{"id": self.season, "league_id": self.league, "status": "active", "format": "team_duel"}]
        if path == "/rest/v1/season_roster":
            return [{"pool_player_id": p} for p in self.ids]
        if path == "/rest/v1/league_players":
            return [{"pool_player_id": p, "rating": 1500, "rating_deviation": 90, "status": "active"} for p in self.ids]
        if path == "/rest/v1/matches":
            return [{"id": "fixture"}] if self.fixtures else []
        raise AssertionError(path)

    def rpc(self, name, body):
        if name == "league_duel_rating_snapshot":
            return self.snapshot
        if name == "league_duel_partner_history":
            return {"leagueId": self.league, "seasonIds": [], "partnerships": []}
        raise AssertionError(name)

    def body(self):
        return {"leagueId": self.league, "seasonId": self.season, **self.snapshot,
                "squads": [self.ids[:self.size], self.ids[self.size:]], "settings": {"maxPartnerMeetings": 2, "maxOpponentMeetings": 2}}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.reader = Reader()

    def test_authentication_and_authorization_precede_solving(self):
        with self.assertRaises(ApiError) as error:
            load_context(self.reader.body(), "", self.reader)
        self.assertEqual(error.exception.status, 401)
        self.reader.admin = False
        with self.assertRaises(ApiError) as error:
            load_context(self.reader.body(), "token", self.reader)
        self.assertEqual(error.exception.status, 403)

    def test_stale_snapshot_and_fixture_existence_are_rejected(self):
        body = self.reader.body(); body["revision"] = 0
        with self.assertRaisesRegex(ApiError, "DUEL_STALE_DRAFT"):
            load_context(body, "token", self.reader)
        self.reader.fixtures = True
        with self.assertRaisesRegex(ApiError, "SOLVER_SEASON_HAS_MATCHES"):
            load_context(self.reader.body(), "token", self.reader)

    def test_caps_and_exact_roster_are_checked(self):
        body = self.reader.body(); body["settings"]["maxOpponentMeetings"] = 1
        with self.assertRaisesRegex(ApiError, "SOLVER_INVALID_LIMITS"):
            load_context(body, "token", self.reader)
        body = self.reader.body(); body["squads"][0][0] = body["squads"][1][0]
        with self.assertRaisesRegex(ApiError, "DUEL_STALE_DRAFT"):
            load_context(body, "token", self.reader)

    def test_two_profiles_are_distinct_and_refresh_excludes_them(self):
        context = load_context(self.reader.body(), "token", self.reader)
        result = generate(context, threading.Event(), lambda _: None)
        self.assertEqual([o["kind"] for o in result["options"]], ["balance", "variety"])
        identities = [o["id"] for o in result["options"]]
        self.assertEqual(len(set(identities)), 2)
        context["excluded"] = identities
        refreshed = generate(context, threading.Event(), lambda _: None)
        self.assertTrue(all(o["id"] not in identities for o in refreshed["options"]))
        self.assertEqual(len(refreshed["options"]), 2)

    def test_match_probability_is_validated_and_never_relaxed_for_other_profiles(self):
        for value in (None, True, "65", .49, 1.01, float("nan"), float("inf")):
            body = self.reader.body(); body["settings"]["maxMatchProbability"] = value
            with self.assertRaisesRegex(ApiError, "SOLVER_INVALID_LIMITS"):
                load_context(body, "token", self.reader)
        for limit in (.6, .65, .7):
            body = self.reader.body(); body["settings"]["maxMatchProbability"] = limit
            context = load_context(body, "token", self.reader)
            from server.duel_solver import solve
            seen = []
            def checked(request, cancelled):
                seen.append(request["maxWorst"])
                self.assertLessEqual(request["maxWorst"], limit)
                return solve(request, cancelled)
            with patch("server.duel_solver.solve", side_effect=checked):
                result = generate(context, threading.Event(), lambda _: None)
            self.assertEqual(len(result["options"]), 2)
            self.assertEqual(len(seen), 2)

    def test_ranking_point_limit_validation_and_authoritative_squad_search(self):
        for value in (-1, .5, True, "400", float("nan"), float("inf")):
            body = self.reader.body(); body["settings"]["maxRatingDifference"] = value
            with self.assertRaisesRegex(ApiError, "SOLVER_INVALID_LIMITS"):
                load_context(body, "token", self.reader)
        for value in (None, 0, 400):
            body = self.reader.body(); body["settings"]["maxRatingDifference"] = value
            context = load_context(body, "token", self.reader)
            result = generate(context, threading.Event(), lambda _: None)
            self.assertEqual(len(result["options"]), 2)
        context["searchMode"] = "shuffle"
        context["settings"]["maxRatingDifference"] = 400
        # One player cannot participate in any four-player group within the cap.
        context["pool"][self.reader.ids[0]]["rating"] = 1900.01
        with patch("server.duel_solver.solve") as solver:
            result = generate(context, threading.Event(), lambda _: None)
        solver.assert_not_called()
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(len(result["provenInfeasibleSplitIds"]), 35)
        context["searchMode"] = "fixed"
        self.assertEqual(generate(context, threading.Event(), lambda _: None)["status"], "INFEASIBLE")

    def test_cancelled_search_returns_no_preview(self):
        event = threading.Event(); event.set()
        result = generate(load_context(self.reader.body(), "token", self.reader), event, lambda _: None)
        self.assertIsNone(result)

    def test_long_variety_budget_reaches_fixed_and_shuffle_solves(self):
        from server.duel_solver import solve
        for context in (load_context(self.reader.body(), "token", self.reader), self.shuffle_context()):
            with self.subTest(mode=context["searchMode"]):
                budgets = {}
                def check(request, cancelled):
                    budgets[request["profile"]] = request["seconds"]
                    return solve({**request, "seconds": min(request["seconds"], 3)}, cancelled)
                with patch("server.duel_solver.solve", side_effect=check):
                    result = generate(context, threading.Event(), lambda _: None)
                self.assertEqual([option["kind"] for option in result["options"]], ["balance", "variety"])
                self.assertGreater(budgets["variety"], 239)
                self.assertLessEqual(budgets["variety"], 240)

    def test_fourteen_player_default_limits_return_valid_previews(self):
        reader = Reader(7)
        result = generate(load_context(reader.body(), "token", reader), threading.Event(), lambda _: None)
        self.assertEqual(len(result["options"]), 2)
        for option in result["options"]:
            self.assertEqual(len(option["games"]), 21)
            self.assertEqual(len({tuple(sorted(g["homePoolPlayerIds"] + g["awayPoolPlayerIds"])) for g in option["games"]}), 21)
            counts = {}
            for game in option["games"]:
                for h in game["homePoolPlayerIds"]:
                    for a in game["awayPoolPlayerIds"]:
                        counts[h, a] = counts.get((h, a), 0) + 1
            self.assertLessEqual(max(counts.values()), 2)

    def shuffle_context(self):
        body = self.reader.body(); body["searchMode"] = "shuffle"; body.pop("squads")
        return load_context(body, "token", self.reader)

    def test_shuffle_returns_only_squads_with_a_valid_schedule(self):
        context = self.shuffle_context()
        result = generate(context, threading.Event(), lambda _: None)
        self.assertEqual(result["scope"], "roster")
        self.assertEqual(result["totalSplits"], 35)
        self.assertEqual(len(result["options"]), 2)
        self.assertEqual(set(sum(result["squads"], [])), set(self.reader.ids))
        for option in result["options"]:
            self.assertTrue(all(set(g["homePoolPlayerIds"]) <= set(result["squads"][0]) and set(g["awayPoolPlayerIds"]) <= set(result["squads"][1]) for g in option["games"]))

    def test_shuffle_skips_an_infeasible_split_and_finds_another(self):
        from server.duel_solver import solve
        first = True
        def checked(request, cancelled):
            nonlocal first
            if first:
                first = False
                return {"solution": None, "status": "INFEASIBLE"}
            return solve(request, cancelled)
        with patch("server.duel_solver.solve", side_effect=checked):
            result = generate(self.shuffle_context(), threading.Event(), lambda _: None)
        self.assertEqual(len(result["provenInfeasibleSplitIds"]), 1)
        self.assertTrue(result["options"])

    def test_shuffle_requires_proof_for_every_possible_split(self):
        context = self.shuffle_context()
        with patch("server.duel_solver.solve", return_value={"solution": None, "status": "INFEASIBLE"}):
            result = generate(context, threading.Event(), lambda _: None)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(len(set(result["provenInfeasibleSplitIds"])), 35)
        self.assertNotIn("squads", result)

    def test_unknown_split_is_not_skipped_when_a_batch_is_resumed(self):
        first = True
        def unfinished(request, cancelled):
            nonlocal first
            status = "UNKNOWN" if first else "INFEASIBLE"
            first = False
            return {"solution": None, "status": status}
        context = self.shuffle_context()
        with patch("server.duel_solver.solve", side_effect=unfinished):
            result = generate(context, threading.Event(), lambda _: None)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(len(result["provenInfeasibleSplitIds"]), 34)
        context["skipSplitIds"] = result["provenInfeasibleSplitIds"]
        context["attempt"] = 2
        resumed = generate(context, threading.Event(), lambda _: None)
        self.assertTrue(resumed["options"])
        self.assertEqual(resumed["provenInfeasibleSplitIds"], [])

    def test_shuffle_rejects_stale_proofs_if_ratings_change_during_search(self):
        context = self.shuffle_context()
        def changed(request, cancelled):
            self.reader.snapshot = {"revision": 2, "fingerprint": "changed"}
            return {"solution": None, "status": "INFEASIBLE"}
        with patch("server.duel_solver.solve", side_effect=changed):
            with self.assertRaisesRegex(ApiError, "DUEL_STALE_DRAFT"):
                generate(context, threading.Event(), lambda _: None)

    def test_probability_approximation_agrees_with_known_values(self):
        self.assertAlmostEqual(normal_cdf(0), .500000015, places=12)
        self.assertAlmostEqual(normal_cdf(1), .8413447386, places=9)


if __name__ == "__main__":
    unittest.main()
