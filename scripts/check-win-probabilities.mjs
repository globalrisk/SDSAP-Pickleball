import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

// Read-only offline audit. The input is a database export; no database client,
// credentials, network requests, rating writes, or parameter fitting.
const source = process.argv[2] || 'artifacts.local/rating-calibration/snapshot.json'
const target = process.argv[3] || 'artifacts.local/rating-calibration/report.json'
const snapshot = JSON.parse(await readFile(source, 'utf8'))
const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
function wilson(wins, count) {
  const z = 1.95996398454, p = wins / count, denominator = 1 + z * z / count
  const center = (p + z * z / (2 * count)) / denominator
  const margin = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}

function summarize(rows, probabilityKey = 'probability') {
  if (!rows.length) return null
  const brier = mean(rows.map(row => (row[probabilityKey] - row.homeWon) ** 2))
  const logLoss = mean(rows.map(row => {
    const p = Math.max(1e-15, Math.min(1 - 1e-15, row[probabilityKey]))
    return -(row.homeWon * Math.log(p) + (1 - row.homeWon) * Math.log(1 - p))
  }))
  const favorites = rows.filter(row => Math.abs(row[probabilityKey] - 0.5) > 1e-12)
    .map(row => ({ chance: Math.max(row[probabilityKey], 1 - row[probabilityKey]), won: row[probabilityKey] > 0.5 ? row.homeWon : 1 - row.homeWon }))
  const bins = Array.from({ length: 5 }, (_, index) => {
    const low = 0.5 + index * 0.1, high = index === 4 ? 1 + 1e-12 : 0.5 + (index + 1) * 0.1
    const selected = favorites.filter(row => row.chance >= low && row.chance < high)
    if (!selected.length) return null
    const wins = selected.reduce((sum, row) => sum + row.won, 0)
    return { range: `${Math.round(low * 100)}–${Math.round(Math.min(high, 1) * 100)}%`, count: selected.length,
      wins, predicted: mean(selected.map(row => row.chance)), observed: wins / selected.length,
      observedInterval: wilson(wins, selected.length) }
  }).filter(Boolean)
  return { count: rows.length, brier, logLoss, brierSkillVsCoinFlip: 1 - brier / 0.25,
    favoriteCount: favorites.length, equalChanceCount: rows.length - favorites.length,
    favoriteAccuracy: favorites.length ? mean(favorites.map(row => row.won)) : null,
    expectedFavoriteWins: favorites.reduce((sum, row) => sum + row.chance, 0),
    actualFavoriteWins: favorites.reduce((sum, row) => sum + row.won, 0),
    averageFavoriteChance: favorites.length ? mean(favorites.map(row => row.chance)) : null,
    bins }
}

// Season blocks retain correlations among games sharing the same players.
function blockBootstrap(rows, key = 'probability', iterations = 10000) {
  const blocks = [...new Set(rows.map(row => row.seasonId))].map(id => rows.filter(row => row.seasonId === id))
  let state = 601010
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 }
  const deltas = []
  for (let i = 0; i < iterations; i++) {
    let count = 0, total = 0
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[Math.floor(random() * blocks.length)]
      count += block.length
      for (const row of block) total += (row[key] - row.homeWon) ** 2 - 0.25
    }
    deltas.push(total / count)
  }
  deltas.sort((a, b) => a - b)
  return { seasonBlocks: blocks.length, iterations, seed: 601010,
    differenceVsCoinFlip: mean(rows.map(row => (row[key] - row.homeWon) ** 2 - 0.25)),
    approximate95Interval: [deltas[Math.floor(iterations * 0.025)], deltas[Math.floor(iterations * 0.975)]] }
}

try {
  const { createInitialRatingsMap, applyDoublesMatchToRatings, teamWinProbability } = await vite.ssrLoadModule('/src/lib/ratings.ts')
  const { RatingInactivityTracker, ratingActivityDate } = await vite.ssrLoadModule('/src/lib/ratingInactivity.ts')
  const { replayRatings, toDoublesMatchPlayers } = await vite.ssrLoadModule('/src/lib/ratingReplay.ts')
  const { buildPreMatchRatings } = await vite.ssrLoadModule('/src/lib/historicalRatings.ts')
  const seasons = new Map(snapshot.seasons.map(season => [season.id, season]))
  const names = new Map(snapshot.players.map(player => [player.id, player.name]))
  const matches = [...snapshot.matches].sort((a, b) => a.season_starts_at.localeCompare(b.season_starts_at)
    || (a.result_recorded_at ?? '').localeCompare(b.result_recorded_at ?? '') || a.id.localeCompare(b.id))
  const seedRatings = createInitialRatingsMap(snapshot.players)
  const ratings = createInitialRatingsMap(snapshot.players)
  const inactivity = new RatingInactivityTracker()
  const predictions = []
  const skipped = []
  let previousSeasonId = null, fixedSeasonRatings
  const partnerKey = ids => [...ids].sort().join(':')
  for (const match of matches) {
    const changedSeason = previousSeasonId !== match.season_id
    const result = toDoublesMatchPlayers(match)
    if (!result) { skipped.push({ matchId: match.id, reason: 'Missing doubles lineup or invalid winner' }); previousSeasonId = match.season_id; continue }
    const activityDate = ratingActivityDate(match)
    inactivity.apply(ratings, activityDate)
    if (changedSeason) fixedSeasonRatings = new Map([...ratings].map(([id, rating]) => [id, { ...rating }]))
    assert.equal(new Set([...result.winnerPoolIds, ...result.loserPoolIds]).size, 4, 'Lineups must contain four distinct players')
    const homeWon = Number(match.winner_team_id === match.home_team_id)
    const homeIds = homeWon ? result.winnerPoolIds : result.loserPoolIds
    const awayIds = homeWon ? result.loserPoolIds : result.winnerPoolIds
    assert.ok([...homeIds, ...awayIds].every(id => names.has(id)), 'Missing player seed')
    const before = [...homeIds, ...awayIds].map(id => ({ id, ...ratings.get(id) }))
    const probability = teamWinProbability(homeIds.map(id => ratings.get(id)), awayIds.map(id => ratings.get(id)))
    const seasonStartProbability = teamWinProbability(homeIds.map(id => fixedSeasonRatings.get(id)), awayIds.map(id => fixedSeasonRatings.get(id)))
    assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1)
    assert.ok(Number.isFinite(seasonStartProbability) && seasonStartProbability >= 0 && seasonStartProbability <= 1)
    predictions.push({ matchId: match.id, seasonId: match.season_id, season: seasons.get(match.season_id).name,
      format: seasons.get(match.season_id).format, date: match.season_starts_at, recordedAt: match.result_recorded_at,
      homeIds, awayIds, homePair: homeIds.map(id => names.get(id)).join(' + '), awayPair: awayIds.map(id => names.get(id)).join(' + '),
      homeWon, probability, seasonStartProbability, preMatchRatings: before,
      snapshotLineups: match.home_pool_player_ids?.length === 2 && match.away_pool_player_ids?.length === 2 })
    applyDoublesMatchToRatings(ratings, result)
    inactivity.recordPlayed([...result.winnerPoolIds, ...result.loserPoolIds], activityDate)
    previousSeasonId = match.season_id
  }
  // Cross-check the independent prediction loop against the actual application's
  // canonical replay and pre-match resolver before trusting any metrics.
  const canonical = replayRatings({ pool: snapshot.players, finishedMatches: matches,
    recordedAt: snapshot.extractedAt })
  const canonicalBefore = buildPreMatchRatings(canonical.historyRows, seedRatings)
  for (const row of predictions) for (const before of row.preMatchRatings) {
    const expected = canonicalBefore.get(`${row.matchId}:${before.id}`)
    assert.ok(Math.abs(expected.rating - before.rating) < 1e-10 && Math.abs(expected.rd - before.rd) < 1e-10, 'Prediction used a different historical rating')
  }
  let maxCanonicalDifference = 0, maxStoredRatingDifference = 0, maxStoredDeviationDifference = 0
  for (const player of canonical.playerRatings) {
    const actual = ratings.get(player.id), stored = snapshot.players.find(row => row.id === player.id)
    maxCanonicalDifference = Math.max(maxCanonicalDifference, Math.abs(actual.rating - player.rating), Math.abs(actual.rd - player.rating_deviation))
    maxStoredRatingDifference = Math.max(maxStoredRatingDifference, Math.abs(player.rating - stored.rating))
    maxStoredDeviationDifference = Math.max(maxStoredDeviationDifference, Math.abs(player.rating_deviation - stored.rating_deviation))
  }
  assert.ok(maxCanonicalDifference < 1e-10)
  const completedSeasons = snapshot.seasons.filter(season => predictions.some(row => row.seasonId === season.id))
  const recentIds = new Set(completedSeasons.slice(-3).map(season => season.id))
  const recent = predictions.filter(row => recentIds.has(row.seasonId))
  const pairGroups = new Map()
  for (const row of predictions) for (const home of [true, false]) {
    const ids = home ? row.homeIds : row.awayIds, opponents = home ? row.awayIds : row.homeIds
    const key = partnerKey(ids), group = pairGroups.get(key) ?? { names: ids.map(id => names.get(id)).sort().join(' + '), matches: [], seasons: new Set(), opponents: new Set() }
    group.matches.push({ won: home ? row.homeWon : 1 - row.homeWon, chance: home ? row.probability : 1 - row.probability })
    group.seasons.add(row.seasonId); group.opponents.add(partnerKey(opponents)); pairGroups.set(key, group)
  }
  const pairs = [...pairGroups.values()].map(group => {
    const count = group.matches.length, wins = group.matches.reduce((sum, row) => sum + row.won, 0)
    const expectedWins = group.matches.reduce((sum, row) => sum + row.chance, 0)
    const variance = group.matches.reduce((sum, row) => sum + row.chance * (1 - row.chance), 0)
    return { pair: group.names, count, seasons: group.seasons.size, opponentPairs: group.opponents.size,
      wins, expectedWins, predicted: expectedWins / count, observed: wins / count,
      difference: wins - expectedWins, descriptiveZ: variance ? (wins - expectedWins) / Math.sqrt(variance) : null }
  }).sort((a, b) => a.difference - b.difference)
  const report = {
    league: snapshot.league, extractedAt: snapshot.extractedAt,
    provenance: { revision: snapshot.ratingState.revision, inputMatches: matches.length, analyzedMatches: predictions.length,
      players: snapshot.players.length, completedSeasons: completedSeasons.length, skipped,
      matchesWithSnapshotLineups: predictions.filter(row => row.snapshotLineups).length,
      matchesWithLegacyTeamLineups: predictions.filter(row => !row.snapshotLineups).length,
      matchesWithoutResultTime: matches.filter(match => !match.result_recorded_at).length,
      canonicalReplayVerified: true, maxCanonicalDifference, maxStoredRatingDifference, maxStoredDeviationDifference,
      initialRatings: snapshot.players.map(player => ({ name: player.name, rating: player.initial_rating })) },
    all: summarize(predictions), frozenAtSeasonStart: summarize(predictions, 'seasonStartProbability'),
    recent: summarize(recent), recentFrozen: summarize(recent, 'seasonStartProbability'),
    bootstrap: blockBootstrap(predictions), frozenBootstrap: blockBootstrap(predictions, 'seasonStartProbability'),
    bySeason: completedSeasons.map(season => ({ name: season.name, date: season.starts_at, format: season.format,
      sequential: summarize(predictions.filter(row => row.seasonId === season.id)),
      frozen: summarize(predictions.filter(row => row.seasonId === season.id), 'seasonStartProbability') })),
    byFormat: ['round_robin', 'team_duel'].map(format => ({ format, sequential: summarize(predictions.filter(row => row.format === format)),
      frozen: summarize(predictions.filter(row => row.format === format), 'seasonStartProbability') })).filter(row => row.sequential),
    partnershipCoverage: { distinctPairs: pairs.length, pairsWithAtLeast5Games: pairs.filter(pair => pair.count >= 5).length,
      pairsWithAtLeast10Games: pairs.filter(pair => pair.count >= 10).length,
      pairsWithAtLeast10GamesAnd2Seasons: pairs.filter(pair => pair.count >= 10 && pair.seasons >= 2).length },
    pairs, predictions,
    methodology: ['Only completed rated games; no scheduled games or forfeits.',
      'Current TrueSkill configuration: 25-point weekly variance drift after seven days of grace, cap 500; no parameter fitting.',
      'Predictions are generated before revealing each result, verified against canonical application replay.',
      'Within-season order follows current result_recorded_at then match ID; original play times and historical edits are unavailable.',
      'Initial ratings and legacy team memberships use the records available today; original historical revisions cannot be independently reconstructed.',
      'Season-start predictions use only earlier seasons; completed outcomes are never used within that season.',
      'Latest three completed seasons are a recent slice, not an independently preregistered holdout.',
      'Calibration-bin Wilson intervals are approximate; season-block bootstrap accounts for within-season dependence with only 13 blocks.',
      'Pair residuals are descriptive; opponent effects, shared results, form, and multiple comparisons prevent claiming chemistry from them.',
      'Individual-game calibration does not validate the season forecast independence assumption.']
  }
  await writeFile(target, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ provenance: report.provenance, all: report.all, frozenAtSeasonStart: report.frozenAtSeasonStart,
    recent: report.recent, recentFrozen: report.recentFrozen, bootstrap: report.bootstrap,
    frozenBootstrap: report.frozenBootstrap, byFormat: report.byFormat, partnershipCoverage: report.partnershipCoverage,
    pairsWithRepeatedHistory: pairs.filter(pair => pair.count >= 10 && pair.seasons >= 2) }, null, 2))
} finally {
  await vite.close()
}
