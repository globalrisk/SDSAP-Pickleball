import itertools
import json
import math
import unittest
from unittest.mock import patch

from solver import balanced, forecast, solve


class SolverTests(unittest.TestCase):
    def request(self, **overrides):
        return {"size": 4, "settings": {"maxPartnerMeetings": 2, "maxOpponentMeetings": 2},
                "probabilities": [.500000015] * 36, "seconds": 2, "workers": 1, **overrides}

    def test_ranking_point_limit_is_inclusive_and_uses_unrounded_ratings(self):
        from server.duel_solver import rating_difference_mask
        settings = {"maxPartnerMeetings": 2, "maxOpponentMeetings": 2, "maxRatingDifference": 400}
        for size in (4, 5, 6, 7):
            ratings = [[1500.25 + (400 if i % 2 else 0) for i in range(size)]] * 2
            self.assertTrue(all(rating_difference_mask(size, settings, ratings)))
        ratings = [[1500.25, 1900.25, 1500.25, 1900.25]] * 2
        result = solve(self.request(settings=settings, ratings=ratings, warmMs=10))
        self.assertIsNotNone(result["solution"])
        ratings[0] = [1500.25, 1900.26, 1500.25, 1900.25]
        result = solve(self.request(settings=settings, ratings=ratings, warmMs=10))
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertIsNone(result["solution"])
        settings["maxRatingDifference"] = None
        self.assertIsNotNone(solve(self.request(settings=settings, ratings=ratings))["solution"])
        settings["maxRatingDifference"] = 0
        self.assertIsNotNone(solve(self.request(settings=settings, ratings=[[1500.25] * 4] * 2))["solution"])

    def test_over_limit_warm_start_cannot_escape_an_expired_solver_budget(self):
        settings = {"maxPartnerMeetings": 2, "maxOpponentMeetings": 2, "maxRatingDifference": 0}
        ratings = [[1500, 1501, 1502, 1503], [1504, 1505, 1506, 1507]]
        result = solve(self.request(settings=settings, ratings=ratings, seconds=.05, warmMs=1000))
        self.assertIsNone(result["solution"])

    def test_point_limit_requires_valid_settings_and_authoritative_ratings(self):
        for maximum in (-1, 1.5, True, "400", float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                solve(self.request(settings={"maxPartnerMeetings": 2, "maxOpponentMeetings": 2, "maxRatingDifference": maximum}))
        with self.assertRaises(ValueError):
            solve(self.request(settings={"maxPartnerMeetings": 2, "maxOpponentMeetings": 2, "maxRatingDifference": 400}))

    def test_ties_do_not_hide_a_one_sided_season(self):
        result = forecast([1, 1, 1, 0, 0, .1])
        self.assertAlmostEqual(result["home"], .1)
        self.assertAlmostEqual(result["tie"], .9)
        self.assertAlmostEqual(result["decisiveHome"], 1)
        self.assertFalse(balanced(result))

    def test_symmetric_forecast_is_balanced(self):
        result = forecast([.5] * 6)
        self.assertAlmostEqual(result["decisiveHome"], .5)
        self.assertTrue(balanced(result))

    def test_equal_ratings_have_proven_optimal_solution(self):
        result = solve(self.request())
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertTrue(result["optimal"])
        self.assertEqual(len(result["solution"]["games"]), 6)
        self.assertEqual(len({tuple(sorted(g["home"])) + tuple(p + 4 for p in sorted(g["away"])) for g in result["solution"]["games"]}), 6)
        self.assertTrue(balanced(result["solution"]["forecast"]))

    def test_exact_matchups_cannot_repeat_even_with_permissive_meeting_caps(self):
        probabilities = [.9] * 36
        probabilities[0] = probabilities[35] = .5
        # Previously, repeating these two games in all three rounds was feasible.
        result = solve(self.request(probabilities=probabilities, maxWorst=.65,
                                    settings={"maxPartnerMeetings": 3, "maxOpponentMeetings": 3}))
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertIsNone(result["solution"])

    def test_duplicate_structural_seed_is_never_returned_after_time_limit(self):
        games = [{"round": r, "home": pair, "away": pair} for r in (1, 2, 3)
                 for pair in ([0, 1], [2, 3])]
        with patch("server.duel_solver.Path.read_text", return_value=json.dumps({"4": games})):
            result = solve(self.request(seconds=.1, warmMs=1000,
                                        settings={"maxPartnerMeetings": 3, "maxOpponentMeetings": 3}))
        self.assertIsNone(result["solution"])
        self.assertEqual(result["status"], "UNKNOWN")

    def test_impossible_cap_is_proven_infeasible(self):
        result = solve(self.request(settings={"maxPartnerMeetings": 2, "maxOpponentMeetings": 1}))
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertIsNone(result["solution"])

    def test_interactive_mixed_roster_finishes_inside_stream_budget(self):
        ratings = [1900, 1800, 1650, 1500, 1350, 1200, 900]
        edges = list(itertools.combinations(ratings, 2))
        probabilities = [.5 * (1 + math.erf((sum(h) - sum(a)) / math.sqrt(2 * 290000)))
                         for h in edges for a in edges]
        result = solve(self.request(size=7, probabilities=probabilities, seconds=.5,
                                    warmMs=50, presolve=False, profile="balance"))
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["solution"]["games"]), 21)
        self.assertTrue(balanced(result["solution"]["forecast"]))
        self.assertLess(result["elapsedMs"], 2000)

    def test_rejected_optimum_is_never_reported_as_valid_or_optimal(self):
        result = solve(self.request(probabilities=[.9] * 36, seconds=.3))
        self.assertIn(result["status"], ("UNKNOWN", "INFEASIBLE"))
        self.assertFalse(result["optimal"])
        self.assertIsNone(result["solution"])
        self.assertGreater(result["rejectedForSeasonBalance"], 0)

    def test_invalid_inputs_fail_instead_of_relaxing_limits(self):
        with self.assertRaises(ValueError):
            solve(self.request(settings={"maxPartnerMeetings": 1.5, "maxOpponentMeetings": 2}))
        with self.assertRaises(ValueError):
            solve(self.request(probabilities=[.5]))


if __name__ == "__main__":
    unittest.main()
