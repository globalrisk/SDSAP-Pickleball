# SDSAP Pickleball Leagues

A shared pickleball platform for multiple independent leagues. Players have one shared identity, while every league keeps its own seasons, teams, ratings, rankings, matches, awards, and live events.

**Stack:** Vite + React + TypeScript + Tailwind CSS + Supabase

## Features

- Stable league links at `/leagues/{slug}` and a league switcher
- League-specific name, logo, seasons, teams, ratings, results, and match-day data
- One shared player directory with league-specific membership and ratings
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

4. Start the local app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173). The root address redirects to SDSAP, which remains the default league.

## Create an administrator

There is no public signup or account-management screen.

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

The authorization check uses `app_metadata`, not user-editable metadata. Database RLS and RPC permissions enforce the same rule even if someone calls the API directly.

## League administration

- Use **Setup** to change the current league's name or logo. Its slug and shareable link stay unchanged.
- Use **Create league** for the guided first-season flow.
- Renaming a shared player updates that identity across every league and historical roster display.
- Removing or deactivating a player from one league does not remove them from another.
- Archiving a season preserves its history. Permanent league deletion is intentionally not supported.

## Verification

```bash
npm test
npm run lint
npm run build
```

Database integration checks live in `supabase/tests/database`. Run them against a disposable/local Supabase database after migrations are applied.

## Standings rules

- Win = 1 point
- Loss or forfeit = 0 points
- Teams tied on points are ranked by head-to-head wins, then scored point differential
- Teams that still cannot be separated share the same rank
