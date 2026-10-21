-- SLOWTCG cloud mirror + read-only sharing.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. Safe to run more than once.

-- ---------------------------------------------------------------- data tables
create table if not exists public.collections (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.cards (
  owner_id      uuid not null references auth.users(id) on delete cascade,
  id            text not null,
  collection_id text not null,
  data          jsonb not null,
  updated_at    timestamptz not null default now(),
  primary key (owner_id, id)
);

-- One row per owner: the value-history chart and the price-refresh time.
create table if not exists public.vault_meta (
  owner_id          uuid primary key references auth.users(id) on delete cascade,
  history           jsonb,
  prices_updated_at bigint,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- sharing
create table if not exists public.shares (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  owner_email  text,                          -- filled in by a trigger, shown to the viewer
  viewer_email text,                          -- set for "invite by email"
  viewer_id    uuid references auth.users(id) on delete cascade, -- set once the viewer signs in / accepts
  token        text not null unique,          -- secret for "invite by link"
  role         text not null default 'viewer' check (role = 'viewer'),
  created_at   timestamptz not null default now()
);

create or replace function public.shares_fill_owner_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.owner_email := (select email from auth.users where id = new.owner_id);
  new.viewer_email := lower(new.viewer_email);
  new.role := 'viewer';
  return new;
end $$;

drop trigger if exists shares_fill on public.shares;
create trigger shares_fill before insert on public.shares
  for each row execute function public.shares_fill_owner_email();

-- True when the signed-in person has been given view access to this owner's vault.
create or replace function public.can_view(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shares s
    where s.owner_id = owner
      and (s.viewer_id = auth.uid()
           or (s.viewer_email is not null and s.viewer_email = lower(auth.jwt() ->> 'email')))
  );
$$;

-- ---------------------------------------------------------------- row-level security
alter table public.collections enable row level security;
alter table public.cards       enable row level security;
alter table public.vault_meta  enable row level security;
alter table public.shares      enable row level security;

-- Data tables: the owner can do everything; people with a share can only SELECT.
-- There is deliberately NO insert/update/delete policy for viewers.
do $$
declare t text;
begin
  foreach t in array array['collections', 'cards', 'vault_meta'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('drop policy if exists viewer_read on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                      using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy viewer_read on public.%I for select to authenticated
                      using (public.can_view(owner_id))', t);
  end loop;
end $$;

-- Shares: the owner manages them; a viewer can only see (not change) shares addressed to them.
drop policy if exists owner_all on public.shares;
drop policy if exists viewer_read on public.shares;
create policy owner_all on public.shares for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy viewer_read on public.shares for select to authenticated
  using (viewer_id = auth.uid() or viewer_email = lower(auth.jwt() ->> 'email'));

-- ---------------------------------------------------------------- functions the app calls
-- Redeem an invite link. Single use: once someone has accepted, the link stops working for others.
create or replace function public.accept_invite(invite_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.shares
     set viewer_id = auth.uid()
   where token = invite_token and (viewer_id is null or viewer_id = auth.uid())
   returning owner_id into owner;
  if owner is null then raise exception 'This invite is not valid any more'; end if;
  return owner;
end $$;

-- Permanently delete the signed-in person's account and everything in the cloud (App Store requirement).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from auth.users where id = auth.uid(); -- cascades to every table above
end $$;

revoke all on function public.accept_invite(text), public.delete_my_account() from public, anon;
grant execute on function public.accept_invite(text), public.delete_my_account() to authenticated;
revoke all on function public.can_view(uuid) from public, anon;
grant execute on function public.can_view(uuid) to authenticated;
