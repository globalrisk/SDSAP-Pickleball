# League Team Duel

Team Duel is a season format within a league. The standalone `/team-duel`
feature remains separate and unrated, with its existing 4–6-player squad limit.
League duels support 8, 10, 12, or 14 selected players.

## Rollout

1. Apply `supabase/migrations/20261001195556_league_team_duel_format.sql`
   on a fresh database. This migration is already applied to production through
   Supabase MCP; the local filename matches its recorded production version.
2. Deploy the frontend only after that migration succeeds.
3. In Setup → Season players, explicitly choose Team Duel for an active season
   with no fixtures, select the roster, and open Teams to preview drafts.
4. Choose an option, name the squads, save them, then generate games. Each game
   freezes the same pair of ranks on both sides. A stale rating snapshot requires
   refreshing and saving a draft again.

Existing seasons default to doubles round robin. Nothing converts Season 13
automatically. Its 14-player roster can generate 21 games after an admin switches
the format. Format changes preserve the selected roster and clear draft teams.
Roster changes before generation clear saved duel squads. After generation,
membership, ranks, and fixtures cannot be replaced or deleted. Attendance and
forfeits handle unavailable players.

## Results and ratings

Each game win awards one squad point. Standard results require at least 11 points
and a two-point margin. Forfeits award a point without changing ratings. Games
continue after a squad clinches victory; completion requires every fixture to be
resolved. Equal final game wins mean joint champions, without a deciding game or
point-differential tiebreak.

The existing atomic save/replay pipeline rates only the four frozen participants.
Corrections and undo retain the lineups. There is no overall squad rating bonus.
Rankings, profiles, partner/opponent records, and personal recaps use this same
match history. Team Duel season awards omit the fixed-partnership award.

## Validation

Run `npm test`, `npm run test:database`, `npm run lint`, and `npm run build`.
Database tests apply every repository migration to disposable PostgreSQL through
PGlite and run all SQL assertions. Supabase's auth/storage plumbing is stubbed;
application SQL, RLS, constraints, and RPCs execute unchanged. API integration
tests include concurrent result requests and compare all persisted ratings and
history rows with canonical replay.

For a local browser walkthrough, run `node scripts/test-support/local-supabase.mjs`
and start Vite with `VITE_SUPABASE_URL=http://127.0.0.1:54329` and
`VITE_SUPABASE_ANON_KEY=local-anon-key`. Open `/leagues/duel-verification`, then
sign in as `admin@example.test` with any test password. The loopback-only transport
uses an in-memory database and never contacts the live project. It implements
only the PostgREST operations used by these tests and does not emulate Realtime;
the browser can show the reconnecting indicator during this walkthrough.

Browser verification covered EN/VI setup, roster-preserving format switching,
draft selection/naming, 21-game generation, concurrent courts, attendance,
score validation, result correction/clearing, forfeits, and public league views.
The full 21-game walkthrough checked that a clinch retained the remaining games,
then verified completed squad awards and personal recaps. Mobile layout and the
standalone public page were also reviewed. Tests independently cover tied
finishes with joint champions and differing point margins.
The production migration has been applied through Supabase MCP. Verification
confirmed unchanged record counts, match results, and ratings. All existing
seasons retain round-robin format; Season 13 still has 14 selected players and
zero fixtures. Frontend deployment remains the next rollout step.
