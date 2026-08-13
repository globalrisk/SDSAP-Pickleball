# SDSAP Pickleball League

A local web app to manage your team pickleball league: 6 doubles teams, match scheduling, result entry, and live standings.

**Stack:** Vite + React + TypeScript + Tailwind CSS + Supabase

## Features

- **Dashboard** — standings snapshot, upcoming matches, recent results
- **Standings** — full league table (1 point per win)
- **Matches** — filter by upcoming/completed, record results or forfeits
- **Teams** — view all 6 teams and 12 players
- **Setup** — edit team and player names
- **Realtime** — standings update automatically when results are saved

## Prerequisites

- Node.js 18+
- An existing Supabase project (empty/dedicated)

## Setup

### 1. Install dependencies

```bash
cd "d:\Work\SDSAP Leauge"
npm install
```

### 2. Configure Supabase credentials

Copy the example env file and add your project credentials from **Supabase Dashboard → Settings → API**:

```bash
copy .env.example .env.local
```

Edit `.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run the database migration

1. Open your Supabase Dashboard → **SQL Editor**
2. Create a new query
3. Paste the contents of [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql)
4. Click **Run**

This creates `teams`, `players`, and `matches` tables, sets open RLS policies, and seeds:
- 6 teams (Team Alpha through Team Foxtrot)
- 12 players (2 per team)
- 15 round-robin matches across 5 rounds

### 4. Enable Realtime (optional but recommended)

In Supabase Dashboard → **Database → Publications**, ensure the `matches` table is included in the `supabase_realtime` publication so live updates work.

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Customizing names

Go to **Setup** in the app to rename teams and players, or edit them directly in the Supabase Table Editor.

## Standings rules

- **Win** = 1 point
- **Loss or forfeit** = 0 points
- Ranked by total points
- Teams tied on points are ranked by wins in matches played among the tied teams
- If those wins are equal, point differential from scored matches among the tied teams is used
- If part of the tied group remains level, the same rule is reapplied to that subgroup
- Teams that still cannot be separated share the same rank

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |

## Project structure

```
src/
  pages/        Dashboard, Standings, Matches, Teams, Setup
  components/   MatchCard, StandingsTable, RecordResultForm, etc.
  hooks/        useTeams, useMatches, useStandings
  lib/          supabase client, API helpers, standings logic
supabase/
  migrations/   SQL schema + seed data
```
