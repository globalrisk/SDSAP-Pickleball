# League Team Duel

Team Duel is a rated season format within a league, supporting 8, 10, 12, or 14 selected players. The standalone `/team-duel` feature retains its separate, unrated scheduling rules and 4–6-player squad limit.

## Drafts, partners, and tiers

The selected roster is sorted by current league rating, descending, with player ID breaking ties. Both squads receive the same top/middle/bottom composition:

| Players per squad | Top | Middle | Bottom |
|---|---:|---:|---:|
| 4 | 1 | 2 | 1 |
| 5 | 1 | 3 | 1 |
| 6 | 2 | 2 | 2 |
| 7 | 2 | 3 | 2 |

Draft options prioritize avoiding previously played partnerships from the three immediately preceding seasons in the same league. Season order uses start date, then ID; empty seasons still occupy a place in the three-season window. Both round-robin and Team Duel matches count. Completed match snapshots identify the actual partners; older round-robin matches without snapshots use their two-player team. Scheduled games and forfeits are excluded. A partnership counts once per previous season, regardless of how many games that pair played together.

Every eligible squad split is considered. Options minimize distinct repeated partnerships, then prior-season occurrences, then repeats in the most recent seasons. Balance and opponent variety break ties. The strongest selected player anchors squad A. The three highest-ranked distinct options are shown.

Fresh partners take priority over the 65% predicted favorite target. The target is advisory; a less balanced draft with fewer past partners remains eligible and shows a warning. History-loading failures block saving a new preview.

## Fixtures and frozen history

Every player partners with every squadmate exactly once. Each game matches the same unordered tier combination on both sides, such as top+middle against top+middle. The two partnerships can have different squad ranks.

The planner enumerates tier-preserving away-player permutations, compatible circle-round assignments, and same-tier partnership permutations. Among fixture candidates meeting the 65% target, it minimizes repeated opponent encounters, then worst and total imbalance. Otherwise it minimizes worst imbalance first. Opponent repetition is the sum of `count * (count - 1) / 2` for each cross-squad opponent pair. Final ties use player IDs. This optimization never changes the draft's partner-history score.

Rounds have no repeated participant. Seven-player squads generate 21 fixtures in seven rounds of three games. Every player plays six games with six unique partners and rests for one round. Live courts also independently enforce actual participant attendance and double-booking protections.

New drafts freeze each player's `duel_tier` and set the season's `duel_schedule_mode` to `tier_matched`. Existing seasons retain NULL metadata and their historical mirror validation. Their stored fixtures and ratings are not rewritten. Membership, ranks, tiers, mode, and lineups freeze after generation; attendance, result correction, undo, and forfeits retain their existing behavior.

## Setup and rollout

1. Apply the original league Team Duel migration if it is not already installed, then apply `supabase/migrations/20261002170215_league_duel_tier_partnerships.sql`.
2. Deploy the frontend after the tier migration succeeds. Fresh generation now supplies the complete plan and expected rating revision/fingerprint to the atomic RPC; the old single-argument generation signature is retired.
3. For an active Team Duel season with an empty fixture list, refresh draft options, choose and name the squads, save, then generate games. An old draft must be saved again to acquire validated tiers. Rebuilding preserves the season record and selected roster.
4. A changed rating snapshot or saved squad requires refreshing and saving again. The database checks fixture emptiness after taking the rating, advisory, and season locks. Existing fixtures block generation; there is no replacement flow.

Season 13 already uses Team Duel and has 14 selected players. An administrator can use **Clear unplayed fixtures** in Setup → Teams to remove its old schedule before using fresh generation. The action requires confirmation, an active season, the exact fixture IDs shown, no recorded results or forfeits, no game currently on court, and no linked rating history. It clears the whole schedule atomically and invalidates the saved draft snapshot, preserving the season, selected roster, squads, ratings, and other seasons. Refresh and save a fresh draft before generating again. Apply the `clear_unplayed_league_duel_fixtures` forward migration before using this action. The generator itself never replaces fixtures.

## Results and verification

Each game win awards one squad point. Standard results require at least 11 points and a two-point margin. Forfeits award a point without changing ratings. Games continue after a squad clinches victory. Equal final game wins mean joint champions, without a deciding game or point-differential tiebreak.

The existing atomic rating replay uses exactly the four frozen participants. Profiles, rankings, partnership records, and recaps use the same match history.

Run `npm test`, `npm run test:database`, `npm run lint`, and `npm run build`. Tests cover an anonymous Season 13 rating snapshot, all roster sizes, tier and partnership coverage, conflict-free rounds, partner-first ranking, the exact history window, snapshots and legacy fallback, atomic rollback, stale requests, permissions, duplicate generation, and migration over populated mirror history. Migration tests compare all original stored records before and after the schema change, then exercise result correction and rebuilding an empty legacy draft.

Tests use disposable PGlite PostgreSQL and a loopback-only PostgREST transport; they never connect to production. Two competing generation requests produce one commit and one rejection. The transport serializes SQL and does not prove real PostgreSQL lock contention; the existing database lock order is preserved.

For a browser walkthrough, run `node scripts/test-support/local-supabase.mjs` and Vite with `VITE_SUPABASE_URL=http://127.0.0.1:54329` and `VITE_SUPABASE_ANON_KEY=local-anon-key`. Open `/leagues/duel-verification` and sign in as `admin@example.test` with any test password. Realtime is not emulated.
