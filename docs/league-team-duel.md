# League Team Duel

Team Duel is a rated league season format for 8, 10, 12, or 14 selected players. Two equal squads earn one squad point per game win; individual ratings use the four actual participants. The standalone `/team-duel` tool retains its separate, unrated scheduling rules.

## Flexible drafts

New fixture-free drafts default to **Fast — CP-SAT**. It randomly selects unseen squads with similar total ratings, then calls the authenticated Python API for up to three schedules. **Exhaustive — best balance** retains the browser search and its global quality guarantees. Switching modes preserves names and limits while invalidating previews. Fast mode does not claim globally optimal squad selection; its variety and experience schedules stay within five percentage points of the closest-games result found for those squads. Cards distinguish solver-proved objectives from valid results whose optimality was not proved within the budget.

Fast shuffles stay within five rating points per squad member of the closest total-rating split. Interactive solves use structural hints with presolve disabled so native preprocessing cannot consume the response window; offline benchmarks retain presolve by default. The hard meeting caps and 55/45 season check still apply to every preview.

Fast mode uses one solver thread, a shared 24-second search budget, exact season-probability rejection, and distinct lexicographic balance/variety/experience objectives. Integer scaling to one-millionth precision applies only to mean imbalance and accumulated-disadvantage ranking; match-probability ceilings and the 55/45 check use unrounded probabilities. Previous actual partnerships remain a tie breaker. A time-limited missing result is reported as unfinished, never as proof of impossibility. Cancellation aborts the request; streaming disconnect detection stops the solver, with its time budget as a final bound.

`api/duel-solve.py` runs alongside Vite on Vercel, using `server/duel_service.py` and `server/duel_solver.py`. It verifies Supabase authentication and administrator access, loads authoritative roster/ratings/history, rejects generated seasons and stale snapshots, and never writes fixtures. Existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` also configure Python; server-only `SUPABASE_URL`/`SUPABASE_ANON_KEY` can override them. No service-role key is required. Python dependencies are pinned by `.python-version`, `pyproject.toml`, and `requirements.txt`. Real files/functions resolve before the SPA fallback; unknown API routes remain 404. Fast mode needs no database migration.

For local development, create the Python environment as described in `scripts/experiments/duel-cpsat/README.md`, set `DUEL_CPSAT_PYTHON` to its interpreter, run `npm run dev:solver`, then `npm run dev` in another terminal. Vite proxies the API to loopback port 8001. Run Python checks with `python -m unittest server.test_duel_service` and `python -m unittest discover -s scripts/experiments/duel-cpsat -p test_solver.py`. Run the browser check below with `DUEL_SEARCH_ENGINE=cp-sat` and `DUEL_CPSAT_PYTHON` to exercise the real API and disposable database; the default check exercises exhaustive mode.

The following exhaustive-search quality guarantees apply to **Exhaustive** mode; the participation, meeting limits, season guardrail, save protections, and results rules apply to both modes.

In **Setup → Teams & fixtures**, choose maximum total games with the same partner and maximum total games against the same individual opponent. Both default to **2**. Limits count all meetings, rather than additional repeats, within this season. Each accepts an integer from one through games per player, or **No limit**. Opponent limit one is disabled because equal participation requires more encounters. Impossible combinations produce an explanation without relaxing limits.

New drafts have no tiers and no compulsory partner or opponent coverage. Squads of `n` give everyone `n − 1` games, with `n(n − 1)/2` fixtures total. Rounds never double-book players. Even squads have `n − 1` rounds; odd squads have `n` rounds and one bye per player.

**Search squads and schedules** exhaustively checks every unique squad split and permitted complete-round schedule. The strongest player anchors A; ratings descending, then player IDs, determine squad ranks. Search runs in a browser worker with progress and no time cutoff. Cancel or leaving the page terminates unfinished work. Large rosters and permissive limits can take a long time. Partial results cannot be saved.

Every candidate satisfies the hard **55/45 season limit**: neither squad exceeds a 55% chance of an outright season win, conditional on an outright winner. Joint champions are excluded from this comparison and shown separately. The existing TrueSkill prediction includes rating uncertainty. Season forecasts assume independent game outcomes. **40/60 is a match-quality target**, not a hard limit; cards disclose games outside it.

Search establishes the globally lowest possible worst-match favorite probability. Eligible squad splits stay within five percentage points of that optimum. **Shuffle squads** chooses an unseen eligible split, preferring changed teammates, restarting its cycle after exhaustion. **Refresh schedules** keeps squads and offers unseen schedules. Both preserve filters and typed names. Identical background refetches preserve previews; changed roster, ratings, history, or settings invalidate them.

The exact search caches rating-independent round templates, eliminates incompatible rounds with bitsets as meeting limits are reached, skips provably impossible probability thresholds, and reuses split optima already proved during the global pass. These optimizations retain the same complete search space and ranking rules. Progress includes preparation of round constraints; large or permissive searches can still take time.

For the selected squads, up to three distinct schedules appear, each within five percentage points of that split's optimum:

- **Closest games** minimizes worst favorite probability, then games outside 40/60, then mean imbalance.
- **More variety** maximizes individual opponent coverage, then used partnerships, then minimizes opponent repetitions.
- **Player experience** minimizes the largest below-40% game count assigned to any player, then the largest accumulated disadvantage. If it does not improve these measures over Closest games, it is labeled **Alternative schedule**.

Stable IDs break final ties. Only actual matchup differences count as distinct. Fewer available options are explained. Refresh excludes previously shown schedules until its cycle is exhausted. Partnership history is a final tie breaker and counts only pairs actually used in the proposed schedule.

History covers the three immediately preceding league seasons, ordered by start date and ID; empty seasons still occupy a place. Completed round-robin and duel match snapshots identify actual partners; older round-robin matches use their two-player team. Scheduled games and forfeits are excluded. Each pair counts once per previous season.

Cards show worst and mean favorite probability, games within 40/60, coverage, meeting maxima, hardest player's workload, season chances, and expected squad wins. Details show every lineup/probability, per-player games/expected wins/difficulty, partner/opponent count matrices, missing opponents, and rest. A separate ordering pass minimizes back-to-back appearances on one court without changing matchups.

## Saving and rollout

**Save selected squads** persists settings, squads, and the exact selected plan. Reload restores the preview when inputs match. **Generate selected matches** saves and generates that exact plan atomically; a separate save is optional. The generic generation API also reproduces saved flexible plans.

Apply `supabase/migrations/20261103060704_flexible_league_duel_plans.sql` after preceding migrations and **before deploying the frontend**. It adds nullable plan/hash columns and flexible mode without rewriting existing data. Server validation independently checks roster, equal participation, rounds, caps, authoritative TrueSkill season chances, rating snapshot, and expected plan hash under existing locks. Failures roll back the transaction.

Generated seasons retain their schedule mode and frozen lineups. Legacy tier-matched and mirror schedules remain valid, including result corrections and rating replay. The former tier planner remains in compatibility paths; new editable fixture-free drafts use flexible planning. Existing fixtures are never automatically replaced and the current season is never rebuilt automatically.

Active-season administrators can rename squads without changing membership, fixtures, results, or ratings. Archived seasons remain read-only. **Clear unplayed fixtures** requires confirmation, exact reviewed fixture IDs, no recorded results or forfeits, no game on court, and no linked rating history. It atomically clears fixtures and invalidates the plan, preserving season, roster, squads, ratings, and other seasons. Search/save a fresh plan before regeneration. Advanced fixture deletion also invalidates plans through existing snapshot guards.

## Results and forecasts

Standard results require at least 11 points and a two-point margin. Forfeits award a squad point without changing ratings. All games continue after a squad clinches victory. Equal final game wins mean joint champions without a deciding game or point-differential tiebreak.

Dashboard and Matches forecast all frozen games using current ratings. Recorded wins and forfeits become fixed outcomes. Missing ratings or incomplete lineups make the forecast unavailable; games are never silently omitted. It assumes independent outcomes and does not model correlated form or partnership chemistry. After play starts, forecasts can exceed 55/45; the guardrail applies when selecting and generating drafts.

## Verification

Run `npm test`, `npm run test:database`, `npm run lint`, and `npm run build`. Flexible tests cover all roster sizes, an independent exhaustive reference for eight players, caps, distinct options/refresh, exact save/reload/generation, permissions, stale rollback, authoritative probability agreement, frozen plans, and populated legacy migration. Existing tests retain historical fixture/result-correction coverage.

Run `npm run benchmark:duel` for a reproducible, offline twelve-player performance check. It verifies the complete eligible-split catalog and three ranked schedules against the original exhaustive search on anonymous ratings, then reports catalog and schedule timings. Timings depend on hardware; exact output equality is checked without a wall-clock test threshold.

Run `node scripts/test-support/flexible-duel-browser-check.mjs` with Playwright and Chrome installed. Set `CODEX_BROWSER_PACKAGES` to a separate runtime's node_modules directory if necessary. It starts a disposable local database and Vite, uses the actual worker, and exercises previews, save/reload/generation, stale rejection, English/Vietnamese, and mobile layout. Screenshots go beneath ignored `artifacts.local/flexible-duel/`. It never contacts production.
