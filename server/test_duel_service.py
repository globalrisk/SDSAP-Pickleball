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

    def test_three_profiles_are_distinct_and_refresh_excludes_them(self):
        context = load_context(self.reader.body(), "token", self.reader)
        result = generate(context, threading.Event(), lambda _: None)
        self.assertEqual([o["kind"] for o in result["options"]], ["balance", "variety", "experience"])
        identities = [o["id"] for o in result["options"]]
        self.assertEqual(len(set(identities)), 3)
        context["excluded"] = identities
        refreshed = generate(context, threading.Event(), lambda _: None)
        self.assertTrue(all(o["id"] not in identities for o in refreshed["options"]))
        self.assertEqual(len(refreshed["options"]), 3)

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
            self.assertEqual(len(result["options"]), 3)
            self.assertEqual(len(seen), 3)

    def test_cancelled_search_returns_no_preview(self):
        event = threading.Event(); event.set()
        result = generate(load_context(self.reader.body(), "token", self.reader), event, lambda _: None)
        self.assertIsNone(result)

    def test_fourteen_player_default_limits_return_valid_previews(self):
        reader = Reader(7)
        result = generate(load_context(reader.body(), "token", reader), threading.Event(), lambda _: None)
        self.assertEqual(len(result["options"]), 3)
        for option in result["options"]:
            self.assertEqual(len(option["games"]), 21)
            counts = {}
            for game in option["games"]:
                for h in game["homePoolPlayerIds"]:
                    for a in game["awayPoolPlayerIds"]:
                        counts[h, a] = counts.get((h, a), 0) + 1
            self.assertLessEqual(max(counts.values()), 2)

    def test_probability_approximation_agrees_with_known_values(self):
        self.assertAlmostEqual(normal_cdf(0), .500000015, places=12)
        self.assertAlmostEqual(normal_cdf(1), .8413447386, places=9)


if __name__ == "__main__":
    unittest.main()
