create table if not exists public.installs (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  app_version text not null,
  os text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null,
  primary key (user_id, device_id)
);

alter table public.installs enable row level security;
revoke all on public.installs from anon;
grant select, insert, update on public.installs to authenticated;
create policy "users insert their own rows" on public.installs for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users update their own rows" on public.installs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users select their own rows" on public.installs for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace view public.installs_total as
  select count(*)::bigint as count from public.installs;
create or replace view public.daily_active as
  select count(distinct user_id)::bigint as count from public.installs
  where last_seen > now() - interval '1 day';
create or replace view public.weekly_active as
  select count(distinct user_id)::bigint as count from public.installs
  where last_seen > now() - interval '7 days';

-- Counts are for the service key only, never the client anon key.
revoke all on public.installs_total, public.daily_active, public.weekly_active from anon, authenticated;
grant select on public.installs_total, public.daily_active, public.weekly_active to service_role;
