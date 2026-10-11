-- Nexus Pulse Autopilot — Supabase schema (multi-user)
-- Run in Supabase → SQL Editor. The app uses the service-role key on the server only.
-- Row Level Security is enabled with NO policies, so the anon/public key cannot read anything.
-- Each row belongs to an owner (a user id, or '_global'); `id` is "<owner>::<row id>".

do $$
declare t text;
begin
  foreach t in array array[
    'posts','replies','comments','logs','credentials','kv','rate_events',
    'media','stories','reports','users','sessions','billing_events'
  ] loop
    execute format('create table if not exists public.%I (
      id text primary key,
      owner text not null,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )', t);
    execute format('create index if not exists %I on public.%I (owner, updated_at desc)', t || '_owner_idx', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Uploaded media (images/videos). Private bucket; the app serves files through signed links.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;
