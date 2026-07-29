-- Supabase environment shim (M12.0 RLS harness). Recreates JUST ENOUGH of
-- a Supabase project on a bare Postgres so the real drizzle migrations
-- apply verbatim: the three PostgREST roles, auth.uid()/auth.users, the
-- storage schema, and Supabase's default table grants (grants make RLS
-- policies meaningful — without them every query is a permission error
-- and the policies are never exercised).
--
-- Test-only. Never applied to a real environment.

create extension if not exists pgcrypto;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

-- auth: uid() reads the impersonation GUC the harness sets per-transaction.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

-- storage: the objects/buckets surface our storage policies attach to.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

-- Supabase's default privileges: tables/functions created later (by the
-- migrations) are automatically granted to the API roles; RLS + explicit
-- REVOKEs (e.g. create_organization from anon) then do the real gating.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
