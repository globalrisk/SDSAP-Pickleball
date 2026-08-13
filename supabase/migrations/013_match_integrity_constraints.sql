-- Keep match results internally consistent even when written outside the UI.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_winner_is_participant'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_winner_is_participant
      CHECK (
        winner_team_id IS NULL
        OR winner_team_id IN (home_team_id, away_team_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_scores_are_paired_and_nonnegative'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_scores_are_paired_and_nonnegative
      CHECK (
        (home_score IS NULL AND away_score IS NULL)
        OR (
          home_score IS NOT NULL
          AND away_score IS NOT NULL
          AND home_score >= 0
          AND away_score >= 0
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_result_state_is_consistent'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_result_state_is_consistent
      CHECK (
        (
          status = 'scheduled'
          AND winner_team_id IS NULL
          AND home_score IS NULL
          AND away_score IS NULL
        )
        OR (
          status = 'forfeit'
          AND winner_team_id IS NOT NULL
          AND home_score IS NULL
          AND away_score IS NULL
        )
        OR (
          status = 'completed'
          AND winner_team_id IS NOT NULL
          AND (
            (home_score IS NULL AND away_score IS NULL)
            OR (
              home_score IS NOT NULL
              AND away_score IS NOT NULL
              AND home_score <> away_score
              AND (
                (winner_team_id = home_team_id AND home_score > away_score)
                OR (winner_team_id = away_team_id AND away_score > home_score)
              )
            )
          )
        )
      );
  END IF;
END
$$;

-- This league uses a single round robin: each pair may meet once per season.
-- LEAST/GREATEST also treats A-v-B and B-v-A as the same fixture.
CREATE UNIQUE INDEX IF NOT EXISTS matches_one_fixture_per_pair_per_season
  ON public.matches (
    season_id,
    LEAST(home_team_id, away_team_id),
    GREATEST(home_team_id, away_team_id)
  );
