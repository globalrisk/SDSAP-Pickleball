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

Partnership history covers the three immediately preceding seasons in the same league. Season order uses start date, then ID; empty seasons still occupy a place in the three-season window. Both round-robin and Team Duel matches count. Completed match snapshots identify the actual partners; older round-robin matches without snapshots use their two-player team. Scheduled games and forfeits are excluded. A partnership counts once per previous season, regardless of how many games that pair played together.

Every eligible squad split is considered, with the strongest selected player anchoring squad A. Exactly two named options are shown. Both obey the tier-specific opponent meeting limits below. **Balanced matches** first keeps splits within five percentage points of the globally best highest favorite probability. Within that quality range it favors equal outright season win chances, then highest favorite probability, total game imbalance, history, opponent spread, and stable IDs. **Opponent variety** first keeps the optimal encounter profile and the existing partnership-history quality range. It then ranks by equal season win chances, history, highest and total game imbalance, and stable IDs. History ranking minimizes distinct repeated partnerships, then prior-season occurrences, then repeats in the most recent seasons. Each card shows season win chances and expected game wins as well as its individual-game metrics.

Both priorities have a hard **55/45 season limit**, including all Refresh alternatives. The larger of `P(A wins) / (P(A wins) + P(B wins))` and its B equivalent must be at most 55%, using unrounded probabilities. Odd-length schedules have no tie outcome. For even schedules, this normalization excludes joint champions so a high tie probability cannot hide unequal A/B chances; the cards display the separate joint-champion probability and this conditional comparison. The game-quality and partnership-history baselines are computed before the season filter, so the 55/45 requirement never widens the existing quality ranges. A priority with no qualifying split stays visible but disabled with an explanation. The application rejects saving or generating an out-of-bound draft, including an older saved draft; already-generated fixtures are preserved.

Refresh reloads current inputs and offers different squads within fixed quality limits: balance stays within five percentage points of the globally best highest favorite probability; variety preserves the optimal opponent encounter profile and allows at most six extra distinct repeated partnerships. Unseen splits with the most changed teammates come first, with ranking breaking ties. Each priority tracks shown splits for the setup session; after exhaustion, the cycle restarts without immediately repeating the current split. Snapshot changes reset that history. Background refetches preserve the cards. A failed refresh retains them but disables saving until fresh data is available. Refresh preserves the selected priority and typed names, never saves squads, and explains when no other eligible split exists.

## Fixtures and frozen history

Every player partners with every squadmate exactly once. Each game matches the same unordered tier combination on both sides, such as top+middle against top+middle. The two partnerships can have different squad ranks.

The planner keeps the home squad's circle rounds and exhaustively searches every compatible away-round partnership assignment. Each away partnership is used exactly once, with no repeated participant in a round. Patterns are cached by squad size and match probabilities are precomputed per split. The saved priority controls schedule ranking: balance optimizes highest and total game imbalance, then season balance and encounter counts; variety optimizes encounter counts, then season balance, then highest and total game imbalance. Stable player IDs break final ties. The search does not change the home round structure.

The total opponent repeat score remains the sum of `count * (count - 1) / 2` for each cross-squad opponent pair. With opponent variety, seven-player squads have repeat score 61 and middle-tier encounter counts of 2, 3, and 3. Top- and bottom-tier players meet their two same-tier opponents 3 and 4 times. Both priorities enforce these maximum meetings per opponent for each player's tier; a cross-tier pair must satisfy the smaller of its two limits:

| Players per squad | Top limit | Middle limit | Bottom limit |
|---|---:|---:|---:|
| 4 | 3 | 3 | 3 |
| 5 | 4 | 3 | 4 |
| 6 | 3 | 3 | 3 |
| 7 | 4 | 3 | 4 |

A player has `size + tierSize - 2` encounters with opponents of their own tier, giving a lower bound of `ceil((size + tierSize - 2) / tierSize)`. For four- and five-player squads, a middle limit of two cannot preserve all partnerships and conflict-free rounds; exhaustive reference enumeration verifies that three is necessary. Balanced matches optimizes probabilities within the feasible limits, while variety further minimizes the entire encounter profile. Both cards disclose the highest favorite probability, maximum meetings, and previous partnerships. Existing fixtures and results are never regenerated automatically.

Rounds have no repeated participant. Seven-player squads generate 21 fixtures in seven rounds of three games. Every player plays six games with six unique partners and rests for one round. Live courts also independently enforce actual participant attendance and double-booking protections.

New drafts save `duel_draft_priority` atomically with the squads and rating snapshot. Legacy NULL priority means opponent variety. Generation validates the expected priority under the existing locks, then reproduces the saved preview. Priority freezes with the generated lineups and clears when roster/format changes or clearing unplayed fixtures invalidates the snapshot. Existing fixtures and ratings are not rewritten.

Administrators can rename either squad in **Setup → Teams → Rename team** during the active season, including after fixture generation or recorded results. The update changes only the team name; team IDs, membership, lineups, fixtures, results, and ratings remain intact. Archived seasons keep their read-only setup view. Renaming uses the existing admin write policy and roster guards, so no database migration is required.

## Setup and rollout

1. Apply the original league Team Duel migration if it is not already installed, then apply `supabase/migrations/20261002170215_league_duel_tier_partnerships.sql`.
2. Apply `supabase/migrations/20261009132125_league_duel_draft_priorities.sql` before deploying this frontend. Save and generation RPCs accept optional priority arguments, defaulting to opponent variety for older clients.
3. For an active Team Duel season with an empty fixture list, refresh draft options, choose and name the squads, save, then generate games. An old draft must be saved again to acquire validated tiers. Rebuilding preserves the season record and selected roster.
4. A changed rating snapshot or saved squad requires refreshing and saving again. The database checks fixture emptiness after taking the rating, advisory, and season locks. Existing fixtures block generation; there is no replacement flow.

An administrator can use **Clear unplayed fixtures** in Setup → Teams to rebuild an active season before play starts. The action requires confirmation, the exact fixture IDs shown, no recorded results or forfeits, no game currently on court, and no linked rating history. It clears the whole schedule atomically and invalidates the saved draft snapshot and priority, preserving the season, selected roster, squads, ratings, and other seasons. Refresh and save a fresh draft before generating again. The generator itself never replaces fixtures.

## Results and verification

Each game win awards one squad point. Standard results require at least 11 points and a two-point margin. Forfeits award a point without changing ratings. Games continue after a squad clinches victory. Equal final game wins mean joint champions, without a deciding game or point-differential tiebreak.

The existing atomic rating replay uses exactly the four frozen participants. Profiles, rankings, partnership records, and recaps use the same match history.

The Team Duel overview on Dashboard and Matches forecasts the final season outcome from every game, replacing the dashboard's closest-game highlight for this format. Each remaining game's TrueSkill probability uses its two frozen doubles lineups and current league ratings. Completed wins and forfeits count as fixed wins. An exact outcome distribution gives each squad's chance of finishing with more game wins, a separate joint-champion probability for even schedules, and expected final game wins. Missing ratings or incomplete lineups make the forecast unavailable; games are never silently omitted. Draft ranking uses the same calculation with no completed results and minimizes the difference between the two squads' chances conditional on an outright winner. The forecast is conditional on current ratings and assumes independent game outcomes; it does not model correlated form or partnership chemistry. After play begins, the forecast reflects results and may exceed 55/45; the limit applies when choosing and generating the draft.

Run `npm test`, `npm run test:database`, `npm run lint`, and `npm run build`. Tests cover anonymous Season 13 and Season 14 snapshots, exhaustive reference rankings for both priorities across all roster sizes and rating uncertainties, tier and partnership coverage, conflict-free rounds, refresh quality bounds and cycles, the exact history window, snapshots and legacy fallback, atomic rollback, stale priorities, permissions, duplicate generation, and migration over populated mirror history. Migration tests compare all original stored records before and after the schema change, then exercise result correction and rebuilding an empty legacy draft.

Tests use disposable PGlite PostgreSQL and a loopback-only PostgREST transport; they never connect to production. Two competing generation requests produce one commit and one rejection. The transport serializes SQL and does not prove real PostgreSQL lock contention; the existing database lock order is preserved.

For a browser walkthrough, run `node scripts/test-support/local-supabase.mjs` and Vite with `VITE_SUPABASE_URL=http://127.0.0.1:54329` and `VITE_SUPABASE_ANON_KEY=local-anon-key`. Open `/leagues/duel-verification` and sign in as `admin@example.test` with any test password. Realtime is not emulated.

The automated walkthrough is `node scripts/test-support/duel-draft-browser-check.mjs`. It needs Playwright and installed Chrome, starts its own disposable database and Vite on port 5174, and checks background refetch, refresh failure, preserved names and selection, and save/reload/generate. Set `DUEL_DRAFT_PRIORITY=balance` to exercise Balanced matches; the default is Opponent variety. `DUEL_BROWSER_CHANNEL` can select another installed Playwright browser channel, and `CODEX_BROWSER_PACKAGES` can point to a desktop bundle's Node packages.
