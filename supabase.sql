-- Prépa Veni Vici — Supabase + partage lecture seule
-- Version 6
-- À exécuter dans Supabase > SQL Editor.
-- Ce script est idempotent : tu peux l'exécuter sur la base déjà utilisée par l'application.

-- ============================================================
-- 1. SÉANCES
-- ============================================================
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

-- ============================================================
-- 2. PARTAGES EN LECTURE SEULE
-- ============================================================
create table if not exists public.training_shares (
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewer_email text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  constraint training_shares_not_self check (owner_id <> viewer_id)
);

create index if not exists training_shares_viewer_idx
  on public.training_shares (viewer_id, owner_id);

alter table public.training_shares enable row level security;
revoke all on public.training_shares from anon;
-- Pas d'INSERT/UPDATE direct depuis le navigateur : l'ajout passe par la fonction sécurisée ci-dessous.
revoke all on public.training_shares from authenticated;
grant select, delete on public.training_shares to authenticated;

-- Le propriétaire voit les partages qu'il a créés.
-- Le lecteur voit uniquement le partage qui lui donne accès au plan.
drop policy if exists "training_shares_select" on public.training_shares;
create policy "training_shares_select"
on public.training_shares
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or (select auth.uid()) = viewer_id
);

-- Seul le propriétaire peut retirer un partage.
drop policy if exists "training_shares_delete_owner" on public.training_shares;
create policy "training_shares_delete_owner"
on public.training_shares
for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- ============================================================
-- 3. RLS DES SÉANCES
-- ============================================================
-- Lecture : propriétaire OU lecteur explicitement autorisé.
drop policy if exists "training_select_own" on public.training_sessions;
drop policy if exists "training_select_owner_or_shared" on public.training_sessions;
create policy "training_select_owner_or_shared"
on public.training_sessions
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.training_shares s
    where s.owner_id = training_sessions.user_id
      and s.viewer_id = (select auth.uid())
  )
);

-- Écriture : STRICTEMENT le propriétaire de la séance.
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

-- ============================================================
-- 4. AJOUT D'UN LECTEUR PAR EMAIL
-- ============================================================
-- auth.users n'est pas exposée par l'API. Cette fonction recherche donc
-- l'utilisateur côté base et n'autorise l'ajout que pour le compte connecté.
create or replace function public.share_training_with_email(p_viewer_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_viewer uuid;
  v_email text := lower(trim(coalesce(p_viewer_email, '')));
begin
  if v_owner is null then
    raise exception 'Utilisateur non authentifié';
  end if;

  if v_email = '' then
    raise exception 'Adresse email requise';
  end if;

  -- On ne peut partager que si le compte appelant possède déjà son propre plan.
  if not exists (
    select 1 from public.training_sessions ts where ts.user_id = v_owner
  ) then
    raise exception 'Ce compte ne possède pas de plan à partager';
  end if;

  select u.id
    into v_viewer
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_viewer is null then
    raise exception 'Compte introuvable. Ton ami doit d''abord créer son compte dans l''application avec cette adresse email.';
  end if;

  if v_viewer = v_owner then
    raise exception 'Tu ne peux pas partager ton plan avec ton propre compte';
  end if;

  insert into public.training_shares (owner_id, viewer_id, viewer_email)
  values (v_owner, v_viewer, v_email)
  on conflict (owner_id, viewer_id)
  do update set viewer_email = excluded.viewer_email;

  return jsonb_build_object(
    'owner_id', v_owner,
    'viewer_id', v_viewer,
    'viewer_email', v_email,
    'access', 'read_only'
  );
end;
$$;

revoke all on function public.share_training_with_email(text) from public;
revoke all on function public.share_training_with_email(text) from anon;
grant execute on function public.share_training_with_email(text) to authenticated;

-- ============================================================
-- 5. DATE DE MISE À JOUR
-- ============================================================
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
