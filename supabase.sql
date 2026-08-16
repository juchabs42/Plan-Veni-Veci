-- Prépa Veni Vici — schéma Supabase
-- À exécuter une seule fois dans Supabase > SQL Editor.

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  original_date date not null,
  scheduled_date date not null,
  original_slot text not null check (original_slot in ('am','pm')),
  slot text not null check (slot in ('am','pm')),
  week smallint not null check (week between 1 and 12),
  day_name text not null default '',
  phase text not null default '',
  time_label text not null default '',
  title text not null,
  duration_min integer not null default 0 check (duration_min >= 0),
  rpe numeric(3,1) not null default 0 check (rpe >= 0 and rpe <= 10),
  elevation_m integer not null default 0 check (elevation_m >= 0),
  run_min integer not null default 0,
  bike_min integer not null default 0,
  strength_min integer not null default 0,
  heat_min integer not null default 0,
  intensity_min integer not null default 0,
  long_run_min integer not null default 0,
  nutrition text not null default '',
  instructions text not null default '',
  notes text not null default '',
  status text not null default 'planned' check (status in ('planned','done','skipped')),
  original_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create index if not exists training_sessions_user_date_idx
  on public.training_sessions (user_id, scheduled_date, slot);

alter table public.training_sessions enable row level security;

revoke all on public.training_sessions from anon;
grant select, insert, update, delete on public.training_sessions to authenticated;

-- Une politique distincte par opération.
drop policy if exists "training_select_own" on public.training_sessions;
create policy "training_select_own"
on public.training_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "training_insert_own" on public.training_sessions;
create policy "training_insert_own"
on public.training_sessions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "training_update_own" on public.training_sessions;
create policy "training_update_own"
on public.training_sessions
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "training_delete_own" on public.training_sessions;
create policy "training_delete_own"
on public.training_sessions
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_training_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists training_sessions_set_updated_at on public.training_sessions;
create trigger training_sessions_set_updated_at
before update on public.training_sessions
for each row execute function public.set_training_updated_at();
