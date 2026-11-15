-- GoodToGrow farmer profiles: run once in the Supabase dashboard → SQL Editor → New query → Run.
--
-- DEMO SECURITY MODEL (read before real use)
-- Farmers sign in with a username only: no password, no Supabase Auth. The browser talks to the
-- database with the public anon key, so the policies below let the anon role read and write these
-- three tables. Anyone who knows a username can see and change that farmer's saved plans and
-- memory. That is fine for a hackathon demo; before real farmers use it, switch to Supabase Auth
-- (email magic link or phone OTP), add `auth_user_id uuid references auth.users` to profiles and
-- replace each policy's `true` with `profile_id in (select id from profiles where auth_user_id = auth.uid())`.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One saved strategy = a snapshot of the plan and everything needed to explain or reopen it.
create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  plan_key text not null,
  field_name text,
  lat double precision not null,
  lon double precision not null,
  -- SavedStrategy payload (src/profile/types.ts): field, crops, priorities, scenario, plan,
  -- metrics, card text, soil and climate summary. Versioned with payload->>'version'.
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists strategies_profile_idx on public.strategies (profile_id, created_at desc);

-- Facts the planning helper remembers about a farmer. Saved only after the farmer taps Allow.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  fact text not null check (char_length(fact) between 1 and 300),
  source text not null default 'helper' check (source in ('helper', 'farmer')),
  created_at timestamptz not null default now()
);
create index if not exists memories_profile_idx on public.memories (profile_id, created_at);

alter table public.profiles enable row level security;
alter table public.strategies enable row level security;
alter table public.memories enable row level security;

-- Demo policies (see the note at the top). Profiles cannot be deleted from the app.
drop policy if exists "demo profiles read" on public.profiles;
drop policy if exists "demo profiles insert" on public.profiles;
drop policy if exists "demo profiles update" on public.profiles;
create policy "demo profiles read" on public.profiles for select to anon using (true);
create policy "demo profiles insert" on public.profiles for insert to anon with check (true);
create policy "demo profiles update" on public.profiles for update to anon using (true) with check (true);

drop policy if exists "demo strategies all" on public.strategies;
create policy "demo strategies all" on public.strategies for all to anon using (true) with check (true);

drop policy if exists "demo memories all" on public.memories;
create policy "demo memories all" on public.memories for all to anon using (true) with check (true);
