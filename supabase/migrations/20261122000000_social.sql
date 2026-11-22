-- Phase 3: invite claiming, capacity, time negotiation, bench promotion, push triggers, realtime.

alter table public.event_invites add column sort_order int not null default 0; -- bench order: lowest goes first
alter table public.squad_members add column sort_order int not null default 0;

-- ─── Claim: the first signed-in app user to open a link becomes that invitee ───
create function public.claim_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  update public.event_invites i
     set invitee_user_id = auth.uid()
    from public.events e
   where i.invite_token = p_token and e.id = i.event_id and i.rsvp_status <> 'bench'
     and (i.invitee_user_id is null or i.invitee_user_id = auth.uid())
     and e.owner_id <> auth.uid()
  returning i.event_id into v_event;
  if v_event is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  return v_event;
end $$;

-- ─── RSVP, now with a spot cap (event row locked so two last-spot accepts can't both win) ───
create or replace function public.respond_to_invite(p_token text, p_status public.rsvp_status, p_proposed_times timestamptz[] default '{}')
  returns public.rsvp_status
  language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.event_invites;
  v_event public.events;
begin
  if p_status not in ('accepted', 'declined', 'time_change_requested') then
    raise exception 'invalid rsvp status %', p_status using errcode = '22023';
  end if;
  if (p_status = 'time_change_requested') <> (cardinality(coalesce(p_proposed_times, '{}')) between 1 and 2) then
    raise exception 'time change needs 1-2 proposed times' using errcode = '22023';
  end if;

  select * into v_invite from public.event_invites where invite_token = p_token and rsvp_status <> 'bench';
  if v_invite.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  select * into v_event from public.events where id = v_invite.event_id and status = 'active' for update;
  if v_event.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if p_status = 'accepted' and v_invite.rsvp_status <> 'accepted' and v_event.max_spots is not null
     and (select count(*) from public.event_invites where event_id = v_event.id and rsvp_status = 'accepted') >= v_event.max_spots then
    raise exception 'event is full' using errcode = 'P0001';
  end if;

  update public.event_invites
     set rsvp_status = p_status,
         proposed_times = case when p_status = 'time_change_requested' then p_proposed_times else '{}' end,
         responded_at = now()
   where id = v_invite.id;
  return p_status;
end $$;

-- ─── Owner: approve a proposed slot. Moves the event, asks everyone else to re-confirm. ───
create function public.approve_time_change(p_invite_id uuid, p_time timestamptz) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.event_invites;
begin
  select * into v_invite from public.event_invites where id = p_invite_id;
  if v_invite.id is null or not public.is_event_owner(v_invite.event_id) then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if v_invite.rsvp_status <> 'time_change_requested' or not (p_time = any (v_invite.proposed_times)) then
    raise exception 'that time was not proposed' using errcode = '22023';
  end if;

  update public.events set scheduled_at = p_time where id = v_invite.event_id;
  update public.event_invites
     set rsvp_status = 'invited', proposed_times = '{}'
   where event_id = v_invite.event_id and id <> p_invite_id
     and rsvp_status in ('accepted', 'time_change_requested');
  update public.event_invites
     set rsvp_status = 'accepted', proposed_times = '{}', responded_at = now()
   where id = p_invite_id;
end $$;

-- ─── Owner: release the next bench spot ───
create function public.promote_next_bench(p_event_id uuid) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_event_owner(p_event_id) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  update public.event_invites
     set rsvp_status = 'invited', tier = 'primary'
   where id = (
     select id from public.event_invites
      where event_id = p_event_id and rsvp_status = 'bench'
      order by sort_order, id
      limit 1
      for update skip locked)
  returning id into v_id;
  if v_id is null then
    raise exception 'no one left on the bench' using errcode = 'P0002';
  end if;
  return v_id;
end $$;

revoke execute on function public.claim_invite(text), public.approve_time_change(uuid, timestamptz), public.promote_next_bench(uuid) from public;
grant execute on function public.claim_invite(text), public.approve_time_change(uuid, timestamptz), public.promote_next_bench(uuid) to authenticated;

-- ─── Push via Expo's push API, sent from the database with pg_net ───
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable; pushes will be skipped';
end $$;

create function public.push(p_user_ids uuid[], p_title text, p_body text, p_data jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', d.push_token, 'title', p_title, 'body', p_body, 'data', p_data))
    into v_messages
    from public.user_devices d
   where d.user_id = any (p_user_ids) and d.notifications_granted;
  if v_messages is null or to_regnamespace('net') is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := v_messages,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
end $$;
revoke execute on function public.push(uuid[], text, text, jsonb) from public, anon, authenticated;

create function public.on_invite_change() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_verb text;
  v_bench boolean;
begin
  select * into v_event from public.events where id = new.event_id;

  -- Invitee answered → tell the owner.
  if tg_op = 'UPDATE' and new.rsvp_status is distinct from old.rsvp_status
     and new.rsvp_status in ('accepted', 'declined', 'time_change_requested')
     and auth.uid() is distinct from v_event.owner_id then -- owner's own changes (approve) don't ping the owner
    v_verb := case new.rsvp_status when 'accepted' then 'is in' when 'declined' then 'can''t make it'
              else 'asked for a different time' end;
    v_bench := new.rsvp_status = 'declined'
      and exists (select 1 from public.event_invites where event_id = new.event_id and rsvp_status = 'bench');
    perform public.push(array[v_event.owner_id], v_event.title,
      new.invitee_display_name || ' ' || v_verb || case when v_bench then '. Invite the next bench player?' else '' end,
      jsonb_build_object('eventId', new.event_id));
  end if;

  -- Newly active invite for a known app user → tell them.
  if new.invitee_user_id is not null and new.rsvp_status = 'invited'
     and (tg_op = 'INSERT' or old.rsvp_status = 'bench') then
    perform public.push(array[new.invitee_user_id], 'You''re invited: ' || v_event.title,
      'Tap to respond', jsonb_build_object('eventId', new.event_id));
  end if;
  return null;
end $$;
create trigger event_invites_notify after insert or update on public.event_invites
  for each row execute function public.on_invite_change();

create function public.on_event_time_change() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform public.push(
    (select array_agg(invitee_user_id) from public.event_invites
      where event_id = new.id and invitee_user_id is not null and rsvp_status not in ('bench', 'declined')),
    new.title || ' moved',
    'New time: ' || to_char(new.scheduled_at at time zone new.event_timezone, 'Dy Mon DD, HH12:MI AM') || '. Please re-confirm.',
    jsonb_build_object('eventId', new.id));
  return null;
end $$;
create trigger events_time_notify after update of scheduled_at on public.events
  for each row when (new.scheduled_at is distinct from old.scheduled_at)
  execute function public.on_event_time_change();

-- ─── Realtime roster updates (RLS still applies to what each subscriber receives) ───
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.event_invites, public.events;
  end if;
end $$;
