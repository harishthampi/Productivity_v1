-- PulsePlan v1 schema + RLS. All timestamps are UTC timestamptz; IANA zone strings sit alongside.

-- ─── Enums ──────────────────────────────────────────────────────────────
create type public.priority_tier as enum ('focus', 'standard');
create type public.task_status as enum ('scheduled', 'reminded', 'checkin_pending', 'completed', 'retried', 'failed', 'cancelled');
create type public.attempt_outcome as enum ('completed_on_time', 'completed_late', 'retried', 'failed_missed');
create type public.invite_tier as enum ('primary', 'bench');
create type public.rsvp_status as enum ('bench', 'invited', 'accepted', 'declined', 'time_change_requested');
create type public.event_status as enum ('active', 'cancelled', 'completed');
create type public.device_platform as enum ('ios', 'android', 'web');

-- ─── Tables ─────────────────────────────────────────────────────────────
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  timezone text not null default 'UTC',
  default_checkin_delay_mins int not null default 30 check (default_checkin_delay_mins between 1 and 1440),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  notes text,
  priority_tier public.priority_tier not null default 'standard',
  scheduled_at timestamptz not null,
  checkin_delay_mins int default 30 check (checkin_delay_mins between 1 and 1440), -- null = check-in Off
  checkin_due_at timestamptz, -- maintained by trigger below
  status public.task_status not null default 'scheduled',
  attempt_number int not null default 1 check (attempt_number >= 1),
  parent_task_id uuid references public.tasks (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_user_scheduled_idx on public.tasks (user_id, scheduled_at);
create index tasks_user_checkin_idx on public.tasks (user_id, status, checkin_due_at);

create table public.task_attempt_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  attempt_number int not null check (attempt_number >= 1),
  scheduled_at timestamptz not null,
  checkin_prompted_at timestamptz,
  resolved_at timestamptz not null default now(),
  outcome public.attempt_outcome not null,
  retry_target_at timestamptz,
  idempotency_key uuid not null unique, -- client-generated; replays of the offline queue hit this
  check ((outcome = 'retried') = (retry_target_at is not null))
);
create index task_attempt_logs_task_idx on public.task_attempt_logs (task_id);
create index task_attempt_logs_user_resolved_idx on public.task_attempt_logs (user_id, resolved_at);

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);
create index squads_owner_idx on public.squads (owner_id);

create table public.squad_members (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads (id) on delete cascade,
  member_user_id uuid references public.users (id) on delete set null,
  display_name text not null,
  contact_ref text, -- phone/email for non-app friends; owner-only visibility
  default_tier public.invite_tier not null default 'primary'
);
create index squad_members_squad_idx on public.squad_members (squad_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  description text,
  location_text text,
  scheduled_at timestamptz not null,
  event_timezone text not null,
  min_accepted_quorum int check (min_accepted_quorum >= 1),
  max_spots int check (max_spots >= 1),
  status public.event_status not null default 'active',
  created_at timestamptz not null default now()
);
create index events_owner_scheduled_idx on public.events (owner_id, scheduled_at);

create table public.event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  invitee_user_id uuid references public.users (id) on delete set null,
  invitee_display_name text not null,
  invitee_contact_ref text,
  -- two v4 UUIDs = 244 random bits, unguessable
  invite_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  tier public.invite_tier not null default 'primary',
  rsvp_status public.rsvp_status not null default 'invited',
  proposed_times timestamptz[] not null default '{}' check (cardinality(proposed_times) <= 2),
  responded_at timestamptz,
  check ((rsvp_status = 'time_change_requested') = (cardinality(proposed_times) > 0))
);
create index event_invites_event_idx on public.event_invites (event_id);
create index event_invites_invitee_idx on public.event_invites (invitee_user_id);

create table public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  platform public.device_platform not null,
  push_token text not null,
  notifications_granted boolean not null default false,
  last_seen_at timestamptz not null default now(),
  unique (user_id, push_token)
);

-- ─── Triggers ───────────────────────────────────────────────────────────
create function public.set_checkin_due_at() returns trigger language plpgsql as $$
begin
  new.checkin_due_at := new.scheduled_at + make_interval(mins => new.checkin_delay_mins); -- null delay → null due
  return new;
end $$;
create trigger tasks_checkin_due_at before insert or update of scheduled_at, checkin_delay_mins on public.tasks
  for each row execute function public.set_checkin_due_at();

create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ─── RLS helpers (security definer breaks events ↔ event_invites policy recursion) ───
create function public.is_event_owner(p_event_id uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events where id = p_event_id and owner_id = auth.uid())
$$;

create function public.is_active_invitee(p_event_id uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_invites
    where event_id = p_event_id and invitee_user_id = auth.uid() and rsvp_status <> 'bench'
  )
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────
alter table public.users enable row level security;
alter table public.tasks enable row level security;
alter table public.task_attempt_logs enable row level security;
alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.events enable row level security;
alter table public.event_invites enable row level security;
alter table public.user_devices enable row level security;

create policy users_self_select on public.users for select to authenticated using (id = auth.uid());
create policy users_self_update on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Solo data: owner-only, never visible to friends.
create policy tasks_owner on public.tasks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy logs_owner on public.task_attempt_logs for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()));
create policy devices_owner on public.user_devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy squads_owner on public.squads for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy squad_members_owner on public.squad_members for all to authenticated
  using (exists (select 1 from public.squads s where s.id = squad_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.squads s where s.id = squad_id and s.owner_id = auth.uid()));

create policy events_owner on public.events for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy events_invitee_select on public.events for select to authenticated
  using (public.is_active_invitee(id));

-- Owner manages invites; invitees only read their own (non-bench) row. RSVP writes go through respond_to_invite().
create policy invites_owner on public.event_invites for all to authenticated
  using (public.is_event_owner(event_id)) with check (public.is_event_owner(event_id));
create policy invites_self_select on public.event_invites for select to authenticated
  using (invitee_user_id = auth.uid() and rsvp_status <> 'bench');

-- ─── Token-scoped RPCs (web fallback + app share one path) ─────────────────
-- Returns only the safe summary; bench/unknown tokens return no row (→ 404).
create function public.get_invite_by_token(p_token text)
  returns table (
    title text, scheduled_at timestamptz, event_timezone text, location_text text, owner_display_name text,
    event_status public.event_status, rsvp_status public.rsvp_status, proposed_times timestamptz[]
  )
  language sql stable security definer set search_path = '' as $$
  select e.title, e.scheduled_at, e.event_timezone, e.location_text, u.display_name,
         e.status, i.rsvp_status, i.proposed_times
  from public.event_invites i
  join public.events e on e.id = i.event_id
  join public.users u on u.id = e.owner_id
  where i.invite_token = p_token and i.rsvp_status <> 'bench'
$$;

create function public.respond_to_invite(p_token text, p_status public.rsvp_status, p_proposed_times timestamptz[] default '{}')
  returns public.rsvp_status
  language plpgsql security definer set search_path = '' as $$
declare
  v_status public.rsvp_status;
begin
  if p_status not in ('accepted', 'declined', 'time_change_requested') then
    raise exception 'invalid rsvp status %', p_status using errcode = '22023';
  end if;
  if (p_status = 'time_change_requested') <> (cardinality(coalesce(p_proposed_times, '{}')) between 1 and 2) then
    raise exception 'time change needs 1-2 proposed times' using errcode = '22023';
  end if;

  update public.event_invites i
     set rsvp_status = p_status,
         proposed_times = case when p_status = 'time_change_requested' then p_proposed_times else '{}' end,
         responded_at = now()
    from public.events e
   where i.invite_token = p_token and e.id = i.event_id
     and i.rsvp_status <> 'bench' and e.status = 'active'
  returning i.rsvp_status into v_status;

  if v_status is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  return v_status;
end $$;

revoke execute on function public.get_invite_by_token(text), public.respond_to_invite(text, public.rsvp_status, timestamptz[]) from public;
grant execute on function public.get_invite_by_token(text), public.respond_to_invite(text, public.rsvp_status, timestamptz[]) to anon, authenticated;
