import itertools
import json
import random
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from server.duel_prefilter import enough_flow, impossible_split
from server.duel_service import generate, load_context
from server.duel_solver import solve
from server.test_duel_service import Reader


class PrefilterTests(unittest.TestCase):
    def test_shared_capacity_shortage_is_detected_even_with_local_choices(self):
        arcs = [(0, 0, 2), (1, 0, 2), (2, 1, 2), (2, 2, 2)]
        self.assertFalse(enough_flow([2, 2, 2], [2, 2, 2], arcs, 6))
        self.assertTrue(enough_flow([2, 2, 2], [2, 2, 2], arcs + [(1, 1, 2)], 6))

    def test_every_known_valid_schedule_survives_with_extra_random_allowed_games(self):
        skeletons = json.loads(Path('server/duel_skeletons.json').read_text())
        rng = random.Random(417)
        for size in range(4, 8):
            edges = list(itertools.combinations(range(size), 2))
            games = skeletons[str(size)]
            partners = [{}, {}]; opponents = {}
            for g in games:
                for side, key in enumerate(('home', 'away')):
                    pair = tuple(g[key]); partners[side][pair] = partners[side].get(pair, 0) + 1
                for h in g['home']:
                    for a in g['away']:
                        opponents[h, a] = opponents.get((h, a), 0) + 1
            for ceiling in (.5, .65, 1):
                settings = {'maxPartnerMeetings': max(max(row.values()) for row in partners),
                            'maxOpponentMeetings': max(opponents.values()), 'maxMatchProbability': ceiling}
                for _ in range(10):
                    p = [rng.random() for _ in range(len(edges) ** 2)]
                    for g in games:
                        p[edges.index(tuple(g['home'])) * len(edges) + edges.index(tuple(g['away']))] = .5
                    self.assertIsNone(impossible_split(size, settings, p), (size, ceiling))
                settings['maxPartnerMeetings'] = settings['maxOpponentMeetings'] = None
                self.assertIsNone(impossible_split(size, settings, p))

    def test_safe_rejections_agree_with_the_full_solver(self):
        fixtures = [
            [5, 6, 7, 8, 9, 10, 11, 15, 16, 20, 22, 30, 31, 33, 34],
            [6, 8, 15, 25, 26, 34, 35],
            [9, 23, 24, 30],
        ]
        settings = {'maxPartnerMeetings': 2, 'maxOpponentMeetings': 2, 'maxMatchProbability': .65}
        for indices in fixtures:
            probabilities = [.5 if i in indices else .9 for i in range(36)]
            self.assertIsNotNone(impossible_split(4, settings, probabilities))
            result = solve({'size': 4, 'settings': settings, 'probabilities': probabilities, 'seconds': 1,
                            'maxWorst': .65, 'presolve': False})
            self.assertEqual(result['status'], 'INFEASIBLE')

    def test_season_balance_bound_and_probability_boundary(self):
        settings = {'maxPartnerMeetings': 2, 'maxOpponentMeetings': 2, 'maxMatchProbability': .65}
        self.assertEqual(impossible_split(4, settings, [.6] * 36), 'season_balance')
        self.assertEqual(impossible_split(4, settings, [.4] * 36), 'season_balance')
        # Both inclusive match boundaries remain eligible; this set can balance.
        self.assertIsNone(impossible_split(4, settings, [.35, .65] * 18))

    def test_all_split_filter_failures_bypass_cp_sat(self):
        reader = Reader()
        body = reader.body(); body['searchMode'] = 'shuffle'
        context = load_context(body, 'token', reader)
        with patch('server.duel_service.normal_cdf', return_value=.99), patch('server.duel_solver.solve') as solver:
            result = generate(context, threading.Event(), lambda _: None)
        solver.assert_not_called()
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(len(result['provenInfeasibleSplitIds']), 35)

    def test_filtering_finishes_before_any_split_is_solved(self):
        reader = Reader()
        body = reader.body(); body['searchMode'] = 'shuffle'
        context = load_context(body, 'token', reader)
        checked = []
        def filter_split(*_):
            checked.append(1)
            return None
        def full_solve(*_):
            self.assertEqual(len(checked), 35)
            return {'status': 'UNKNOWN', 'solution': None}
        with patch('server.duel_prefilter.impossible_split', side_effect=filter_split), patch('server.duel_solver.solve', side_effect=full_solve):
            result = generate(context, threading.Event(), lambda _: None)
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertEqual(result['provenInfeasibleSplitIds'], [])


if __name__ == '__main__':
    unittest.main()
