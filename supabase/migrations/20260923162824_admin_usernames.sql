-- A username is an optional login alias for one existing administrator.
-- Email stays with Supabase Auth for password recovery and is not duplicated here.
CREATE TABLE public.admin_usernames (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE
    CHECK (username ~ '^[a-z][a-z0-9_]{2,31}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_usernames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read their own username" ON public.admin_usernames
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

CREATE POLICY "Admins add their own username" ON public.admin_usernames
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

CREATE POLICY "Admins change their own username" ON public.admin_usernames
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

CREATE POLICY "Admins remove their own username" ON public.admin_usernames
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

REVOKE ALL ON public.admin_usernames FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_usernames TO authenticated;
