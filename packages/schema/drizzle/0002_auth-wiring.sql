-- M2.3: bind profiles to Supabase Auth.
--
-- profiles.id == auth.users.id (deferred from M2.1 because auth.users lives
-- outside drizzle's managed schema). Deleting an auth user cascades to their
-- profile; tenant data they created is preserved (created_by columns carry
-- plain uuids, deliberately not FK'd to auth).
--
-- Profile creation is administrative for now: a new signup has no tenant
-- until an admin (or invite flow, later milestone) assigns one. Signed-in
-- users without a profile get nothing — every RLS policy resolves
-- current_tenant_id() to NULL for them, which matches no rows.

alter table public.profiles
  add constraint profiles_id_auth_users_fk
  foreign key (id) references auth.users (id) on delete cascade;
