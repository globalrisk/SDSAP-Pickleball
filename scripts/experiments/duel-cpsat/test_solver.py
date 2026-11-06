import itertools
import math
import unittest

from solver import balanced, forecast, solve


class SolverTests(unittest.TestCase):
    def request(self, **overrides):
        return {"size": 4, "settings": {"maxPartnerMeetings": 2, "maxOpponentMeetings": 2},
                "probabilities": [.500000015] * 36, "seconds": 2, "workers": 1, **overrides}

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
        self.assertTrue(balanced(result["solution"]["forecast"]))

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
