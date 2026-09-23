-- Existing usernames remain valid; dots are now allowed after the first letter.
ALTER TABLE public.admin_usernames
  DROP CONSTRAINT admin_usernames_username_check,
  ADD CONSTRAINT admin_usernames_username_check
    CHECK (username ~ '^[a-z][a-z0-9._]{2,31}$');
