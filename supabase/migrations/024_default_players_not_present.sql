-- Tournament attendance starts empty. Organizers explicitly mark each player
-- present when they arrive.

ALTER TABLE public.players
  ALTER COLUMN is_present SET DEFAULT false;

UPDATE public.players AS player
SET is_present = false
FROM public.seasons AS season
WHERE season.id = player.season_id
  AND season.status = 'active';

UPDATE public.matches AS match
SET live_status = 'available'
FROM public.seasons AS season
WHERE season.id = match.season_id
  AND season.status = 'active'
  AND match.status = 'scheduled'
  AND match.live_status = 'up_next';
