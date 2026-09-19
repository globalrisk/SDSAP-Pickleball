-- Public self-signup must remain disabled for this project. With account
-- creation restricted to administrators, every Auth account is an app admin.
create or replace function public.assign_admin_role_to_new_user()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'admin');

  return new;
end;
$$;

revoke all on function public.assign_admin_role_to_new_user()
  from public, anon, authenticated;

drop trigger if exists assign_admin_role_to_new_user on auth.users;

create trigger assign_admin_role_to_new_user
before insert on auth.users
for each row
execute function public.assign_admin_role_to_new_user();
