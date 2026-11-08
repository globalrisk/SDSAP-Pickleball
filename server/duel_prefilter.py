"""Necessary capacity checks. Passing is inconclusive; failing proves impossible."""
from itertools import combinations

from ortools.graph.python import max_flow

from server.duel_solver import forecast, rating_difference_mask


def enough_flow(left, right, capacities, required):
    """Relax discrete matches into a small capacitated bipartite network."""
    graph = max_flow.SimpleMaxFlow()
    sink = len(left) + len(right) + 1
    for i, capacity in enumerate(left):
        graph.add_arc_with_capacity(0, i + 1, capacity)
    for j, capacity in enumerate(right):
        graph.add_arc_with_capacity(len(left) + j + 1, sink, capacity)
    for i, j, capacity in capacities:
        if capacity:
            graph.add_arc_with_capacity(i + 1, len(left) + j + 1, capacity)
    status = graph.solve(0, sink)
    # An unexpected graph status cannot establish infeasibility.
    return status != graph.OPTIMAL or graph.optimal_flow() >= required


def impossible_split(size, settings, probabilities, ratings=None):
    """Reject only if a relaxation of the real scheduling rules is infeasible.

    Every real schedule maps to each network below, so insufficient capacity
    proves impossibility. Networks intentionally ignore round ordering and may
    admit combinations that still need CP-SAT to disprove.
    """
    edges = list(combinations(range(size), 2))
    width = len(edges)
    games_per_player = size - 1
    total = size * games_per_player // 2
    partner_cap = settings['maxPartnerMeetings'] or games_per_player
    opponent_cap = settings['maxOpponentMeetings'] or games_per_player
    maximum = settings.get('maxMatchProbability', .65)
    rating_allowed = rating_difference_mask(size, settings, ratings)
    allowed = [(g // width, g % width) for g, p in enumerate(probabilities)
               if rating_allowed[g] and max(p, 1 - p) <= maximum + 1e-12]
    if len(allowed) < total:
        return 'distinct_matches'
    chances = sorted(probabilities[h * width + a] for h, a in allowed)
    # Season win probability is monotone in every match probability, including
    # the decisive-game normalization. Even the most favorable distinct games
    # must reach the 45..55 range. Ignore participation here to keep a safe bound.
    lower = forecast(chances[:total])['decisiveHome']
    upper = forecast(chances[-total:])['decisiveHome']
    if (lower is not None and lower > .55 + 1e-12) or (upper is not None and upper < .45 - 1e-12):
        return 'season_balance'
    pair_games = [[0] * width for _ in range(2)]
    opponents = [[0] * size for _ in range(size)]
    # For each player, record the opponent pairs available with each partner.
    local = [[[] for _ in range(size)] for _ in range(2 * size)]
    for h, a in allowed:
        pair_games[0][h] += 1
        pair_games[1][a] += 1
        for p in edges[h]:
            partner = edges[h][0] if p == edges[h][1] else edges[h][1]
            local[p][partner].append(edges[a])
            for q in edges[a]:
                opponents[p][q] += 1
        for q in edges[a]:
            partner = edges[a][0] if q == edges[a][1] else edges[a][1]
            local[size + q][partner].append(edges[h])
    for choices in local:
        capacities = [min(partner_cap, len(pairs)) for pairs in choices]
        if sum(capacities) < games_per_player:
            return 'partner_capacity'
        counts = [0] * size
        arcs = []
        for partner, pairs in enumerate(choices):
            appearances = [0] * size
            for pair in pairs:
                for q in pair:
                    appearances[q] += 1
                    counts[q] += 1
            arcs.extend((partner, q, min(opponent_cap, n)) for q, n in enumerate(appearances) if n)
        if sum(min(opponent_cap, n) for n in counts) < 2 * games_per_player:
            return 'opponent_capacity'
        # A player's selected match contributes two opponent appearances and
        # consumes one of the partner's limited match slots.
        if not enough_flow([2 * c for c in capacities], [opponent_cap] * size, arcs, 2 * games_per_player):
            return 'player_capacity'
    # Each allowed four-player match is usable once; partner pairs each have
    # their own cap. This detects shared bottlenecks missed by player counts.
    if not enough_flow([min(partner_cap, n) for n in pair_games[0]],
                       [min(partner_cap, n) for n in pair_games[1]],
                       [(h, a, 1) for h, a in allowed], total):
        return 'match_capacity'
    # A real schedule has exactly 2*(size-1) encounters for every player and
    # four encounters per match. Hall-type shortages violate this relaxation.
    if not enough_flow([2 * games_per_player] * size, [2 * games_per_player] * size,
                       [(p, q, min(opponent_cap, opponents[p][q])) for p in range(size) for q in range(size)], 4 * total):
        return 'shared_opponents'
    return None
