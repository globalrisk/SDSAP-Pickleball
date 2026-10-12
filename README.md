# SDSAP Pickleball Leagues

A shared pickleball platform for multiple independent leagues. Players have one shared identity, while every league keeps its own seasons, teams, ratings, rankings, matches, awards, and live events.

**Stack:** Vite + React + TypeScript + Tailwind CSS + Supabase

## Features

- Stable league links at `/leagues/{slug}` and a league switcher
- League-specific name, logo, seasons, teams, ratings, results, and match-day data
- One shared player directory with league-specific membership and ratings
- Administrators can add players from **Manage → Players** without assigning a league; these players are immediately available to Team Duel and can join a league later from that league's Setup page
- **League setup** opens the selected season's overview. Its Season workspace groups **Players → Teams & fixtures → Prizes → Finish season**; **League members**, **Player accounts**, and **League settings** are separate administration sections. Desktop uses a sidebar and phones use a section selector. League membership persists across seasons; choose each season's participants separately before building teams.
- Seasons support doubles round robin or **Team Duel**: two rated squads of 4–7, rotating partnerships, shared squad points, and individual rated games. See [setup and rollout notes](docs/league-team-duel.md).
- Multiple leagues can each have an active season at the same time
- Administrator-only setup and result entry; public pages are read-only
- Guided creation of a league, first season, roster, teams, and schedule
- Realtime match-day and rotation-planner updates
- Existing SDSAP data is migrated into the default `sdsap` league

## Prerequisites

- Node.js 18+
- A Supabase project
- Supabase CLI for managed migrations, or access to the Supabase SQL Editor

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local`, then add the project URL and anon key from **Supabase Dashboard → Settings → API**:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Apply every migration in `supabase/migrations` in filename order. For an existing SDSAP database, create a database backup first, then apply only migrations that have not already run. The multi-league transition is in `20260919033053_multi_league_auth.sql`.

   With a linked Supabase CLI project:

   ```bash
   npx supabase db dump --linked -f before-multi-league.sql
   npx supabase db push
   ```

   You can also use the SQL Editor after downloading a backup from the Supabase Dashboard. Do not enable the new frontend against production until the migration completes successfully.

4. Deploy the username sign-in function. Its JWT check is disabled in `supabase/config.toml` because the function verifies the submitted password with Supabase Auth before returning a session:

   ```bash
   npx supabase functions deploy admin-username-login
   ```

5. Start the local app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173). The root address redirects to SDSAP, which remains the default league.

## Create an administrator

There is no public signup. Administrators can link a username to their own existing account from **Manage → Account** after signing in.

1. In **Supabase Dashboard → Authentication → Users**, create the user manually.
2. In the SQL Editor, assign the protected app-metadata role:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
     || '{"role":"admin"}'::jsonb
   where email = 'admin@example.com';
   ```

3. In Authentication settings, keep public user signup disabled.
4. Sign in from the app's **Admin** link. Every administrator can manage every league.
5. Open **Manage → Account** to set a unique username. Future sign-ins can use the username or email with the same password. Email stays in Supabase Auth for recovery.

The authorization check uses `app_metadata`, not user-editable metadata. Database RLS and RPC permissions enforce the same rule even if someone calls the API directly.

## League administration

- Use **Manage → League setup → League settings** to change the current league's name or logo. Its slug and shareable link stay unchanged. League archive/restore controls are under **Advanced league actions**.
- Use **Manage → Create league** for the guided first-season flow.
- Renaming a shared player updates that identity across every league and historical roster display.
- Removing or deactivating a player from one league does not remove them from another.
- Leave someone out of a season in **League setup → Season → Players**. Use **Inactive** under **League members** only when their league membership is unavailable longer term. Round-robin players already on a team must be removed from that team first. Changing an unstarted Team Duel roster clears its draft squads; generated duel rosters are frozen.
- Archiving a season preserves its history. Permanent league deletion is intentionally not supported.

## Player tournament view

On Home or a tournament recap, players can select their name to see
their fixtures, rated win–loss record, and rating change for that tournament.
Remaining matchups include rivalry records and have no fixed playing order;
only actual court and queue assignments receive Playing now or Up next labels.
The optional **Remember on this device** setting stores the choice separately
for each league in the current browser. **Clear selection** removes it; no
account or extra permissions are created. Completed personal recaps can be
copied into a group chat.

## Rating maintenance

The app and maintenance script use the same league-scoped TrueSkill replay. Seeded
players start with 275 points of uncertainty; decisive matches use zero draw probability.

Absence increases uncertainty through variance growth rather than a flat season
penalty: `RD = sqrt(previous RD² + 25² × additional idle weeks)`, capped at 500.
The first seven days after a rated game are a grace period for regular weekly
play. Elapsed UTC dates come from the original result timestamp (preserved on
correction); legacy results without one use the season start date. Result entry
is a proxy for playing time, so imported or late-entered results may be less exact.
Roster membership, season count, and forfeits do not count as rated activity.
Players without a rated game keep their initial uncertainty. The 25-point setting
is an initial choice, not a parameter validated by the earlier prediction audit.

Every result save and maintenance rebuild recalculates the complete history,
applying absence growth before returning players' results and through the rebuild
date. Rebuilding twice on the same UTC date gives the same ratings. Stored ratings
do not change merely because a page is opened; rebuild before drafting after a
long league-wide break. Historical match probabilities include the pre-game
uncertainty, without learning from later results.

With Node.js 22.18+ (or 24+), preview a rebuild without changing the database:

```bash
npm run ratings:recompute -- --league sdsap
```

Use a league slug or UUID. Add `--output <path>` to save the replacement payload for
inspection. To apply it, provide `SUPABASE_ADMIN_EMAIL` and `SUPABASE_ADMIN_PASSWORD`
in the shell environment, then add `--apply`. A server-only `SUPABASE_SERVICE_ROLE_KEY`
can be used instead. Never prefix these secrets with `VITE_` or commit them.
Concurrent rating changes trigger a fresh read and retry rather than overwriting
results from an older snapshot.

## Pickle point prizes

Administrators configure the selected season's prizes under **League setup → Season → Prizes**. Defaults for future seasons are under **League setup → League settings**.
League defaults are copied into new seasons. Save each Team Duel season’s amounts
explicitly, including zero prizes, then review its distribution before **Archive season**.
Archiving awards points and locks the season’s results, roster and prize settings.

Each squad earns `match wins × match prize + champion bonus`, including wins by
forfeit. Joint champions split one bonus. The combined squad prize is shared equally
among its frozen roster, stored to six decimal places and displayed to two with
Vietnamese number separators. **Rankings → 🥒 Pickle points** shows members of the
selected league, ranked by points earned in that league, with expandable season
contributions from that league only. Each league has independent balances. Players start at
zero; Pickle points are separate from skill ratings and competition points.

Deploy `20261012125633_pickle_points.sql` and then
`20261012134209_pickle_points_per_league.sql` before using the new frontend. Existing
awards keep their source league and amounts; no redistribution is required. It adds no
automatic historical awards. The only historical exception is the one-time SDSAP
Season 13 script, which requires Node.js 22.18+ or 24+, explicit amounts, and
`SUPABASE_ADMIN_EMAIL` / `SUPABASE_ADMIN_PASSWORD` in the environment:

```bash
# Example amounts only; choose the real prizes before applying.
npm run pickle:season13 -- --match-prize 10000 --champion-prize 100000
npm run pickle:season13 -- --match-prize 10000 --champion-prize 100000 --apply
```

The first command only previews. Applying uses the reviewed fingerprint and is
idempotent for the same amounts. Different amounts cannot overwrite a final award.
Never prefix administrator credentials with `VITE_` or commit them.

The archive and Season 13 RPCs intentionally use `SECURITY DEFINER` to write
immutable award tables whose write privileges are revoked from API clients.
Both require a signed-in user with the protected `app_metadata.role = admin`
claim; grants to `authenticated` alone do not authorize an award. The private
award writer is not executable by API clients. Security-advisor notices about
these two privileged RPCs are expected; administrator checks are covered by
database and API integration tests.

For disposable browser verification, run
`node scripts/test-support/pickle-browser-server.mjs` and open its printed localhost
URL. Its synthetic login, games and awards exist only in temporary PostgreSQL;
closing the process discards them.

## Match bets with Pickle points

Deploy `20261012160242_pickle_match_bets.sql` before the betting frontend. It credits
existing prize allocations into league wallets once and preserves final award receipts.
It also removes automatic administrator assignment for new Supabase Auth accounts;
existing administrators retain their roles. Any future
administrator must receive an explicit protected `app_metadata.role = admin` claim.

Players can use **Sign in → Sign up** (or **Bets → Sign up**) to create an email/password
account. In Supabase **Authentication → Sign In / Providers**, enable **Allow new users
to sign up** and the Email provider. For immediate signup, disable **Confirm email**:
the app uses the returned session and opens Bets automatically. Administrators should
verify the player's identity before linking an account, since its email is unverified.
Custom SMTP is needed for password-recovery emails, or if email confirmation is
enabled later; Supabase's default sender is restricted to project-team addresses.
For email flows, add the app's exact production and localhost login URLs to the Auth
redirect allow list, such as
`http://localhost:5173/leagues/sdsap/login` and
`http://127.0.0.1:5173/leagues/sdsap/login`.

After signup, administrators open **League setup → Player accounts** and link each exact email to its permanent player identity. Manual
account creation in Supabase still works. Links
are one-to-one and follow permanent player IDs. Email/password sign-in works for players; existing admin
username sign-in and setup access still work.

The expandable **Registered accounts** list under **League setup → Player accounts**
shows registered emails, including unlinked accounts across all leagues. Search,
refresh and pagination are available; **Use email** fills the linking form without
creating a link. The directory is protected by a server-side administrator check
and returns only email and linked player details. Anonymous and regular player
accounts cannot read it.
The directory's [privileged RPC advisor notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
is expected: signed-in callers can request it, but the function verifies the protected
administrator role before reading any emails. Database tests cover that distinction.

Administrators can use **Unlink account** after reviewing its confirmation. The
operation removes ownership across all leagues and keeps the Auth account, player,
balances, debts and history. It is blocked while that player has any open, accepted
or awaiting-review bets in any league. Cancel open offers and settle accepted bets
first. Each unlink has an immutable private audit receipt and retry identifier;
direct link updates/deletes are forbidden. Administrators can link another account
afterward. Bet mutations lock account ownership before league/result/wallet locks,
preventing an unlink from racing a new reservation. Player screens refresh ownership
on focus and every 30 seconds; the server revokes access immediately.
The private unlink context and receipt tables deliberately use RLS with no API
policies or grants, so access is denied by default. The
[RLS-without-policy advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is informational for these private tables. The protected unlink RPC checks the
administrator role; its privileged-RPC notice is expected as described above.

**Matches** is the entry point for creating offers: compare the pairs and estimated
win chances, then choose **🥒 Bet on this match**. The inline panel defaults to equal
stakes, supports a different opposing stake, previews the pot and profits, and lets
spectators accept existing offers for that match. **Only matches I can bet on** filters
out the player's own matches and closed matches. **Bets** remains the wallet, offer,
history, and administrator review dashboard in desktop navigation and mobile **More**.
Its **Create an offer** button opens Matches with the eligibility filter enabled.
Active league spectators can offer positive stakes in increments of 1,000. Creating an offer reserves
the creator's stake; acceptance reserves the opponent's stake. Accepted contracts cannot
be withdrawn. Match start or a recorded result closes unaccepted offers permanently;
changed players or sides void pending contracts. Renaming players preserves contracts.

Recorded results hold accepted stakes for administrator review in **Bets**. Confirming
pays the winning bettor the combined pot without fees; forfeits refund both stakes.
Corrections require a reason and reviewed revision, update results and ratings atomically,
and append reversals plus new settlements. A correction can leave points owed if previous
winnings were spent; future prizes and winnings repay the debt. New unfunded offers
are rejected, and unfunded open offers are cancelled. Accepted contracts stay valid.

Rankings show current league balances, including net settled bets. Reservations reduce
available points without changing rank. Wallet and transaction details are private to
their owner and administrators; open contracts are readable by league members. RPCs
calculate all financial changes server-side and serialize them with the league rating
lock. Direct wallet, contract, and ledger writes are revoked from API roles.

Security-advisor notices for these protected `SECURITY DEFINER` RPCs are expected:
authorization is checked inside each operation. The public leaderboard RPC returns
aggregate balances only, without granting access to private wallet rows. The existing
[leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
setting remains disabled; this migration does not change Auth password settings.

Archive requires every accepted contract to be settled or refunded. Archived results,
prizes, and bet settlements are final. V1 has no purchases, withdrawals, transfers,
redemption, cash payouts, or manual point adjustments.

For disposable browser verification, run `node scripts/test-support/bets-browser-server.mjs`.
It prints synthetic accounts and a localhost URL, and discards all data when stopped.

## Verification

```bash
npm test
npm run test:database
npm run lint
npm run build
```

Database integration checks live in `supabase/tests/database`. `test:database` applies all migrations to disposable PostgreSQL through PGlite and runs the SQL assertions. Application API tests also exercise the real SQL through a local test transport; Supabase auth/storage plumbing and Realtime are not emulated fully.

## Standings rules

- Win = 1 point
- Loss or forfeit = 0 points
- Round-robin teams tied on points are ranked by head-to-head wins, then scored point differential
- Teams that still cannot be separated share the same rank
- Team Duel squads with equal final game wins are joint champions; point differential does not break the tie. All scheduled games must finish, even after a squad clinches victory.
