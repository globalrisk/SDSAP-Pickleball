-- Keep Up Next as a recommendation; starting a match must require an explicit Play action.

DROP TRIGGER IF EXISTS matches_promote_live_queue_after_result ON public.matches;
DROP FUNCTION IF EXISTS public.promote_live_queue_after_match();
