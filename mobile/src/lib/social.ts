// Squads, events and invites. Unlike solo tasks these are online-only: they are shared state owned by the server.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ensureSession, supabase } from './sync';

export type InviteTier = 'primary' | 'bench';
export type RsvpStatus = 'bench' | 'invited' | 'accepted' | 'declined' | 'time_change_requested';

export type Squad = { id: string; name: string; squad_members: SquadMember[] };
export type SquadMember = {
  id?: string;
  member_user_id: string | null;
  display_name: string;
  contact_ref: string | null;
  default_tier: InviteTier;
  sort_order: number;
};
export type Event = {
  id: string;
  owner_id: string;
  title: string;
  location_text: string | null;
  scheduled_at: string;
  event_timezone: string;
  min_accepted_quorum: number | null;
  max_spots: number | null;
  status: 'active' | 'cancelled' | 'completed';
};
export type Invite = {
  id: string;
  event_id: string;
  invitee_user_id: string | null;
  invitee_display_name: string;
  invitee_contact_ref: string | null;
  invite_token: string;
  tier: InviteTier;
  rsvp_status: RsvpStatus;
  proposed_times: string[];
  sort_order: number;
};
export type InviteSummary = {
  title: string;
  scheduled_at: string;
  event_timezone: string;
  location_text: string | null;
  owner_display_name: string;
  event_status: Event['status'];
  rsvp_status: RsvpStatus;
  proposed_times: string[];
};

export const backendReady = !!supabase;
const db = () => {
  if (!supabase) throw new Error('Backend not configured');
  return supabase;
};
// .single() errors when no row matches, so non-null is safe wherever callers read data.
const unwrap = <T>({ data, error }: { data: T; error: { message: string } | null }) => {
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
};

/** Signs in (anonymously for now) and returns the user id. */
export async function me(): Promise<string> {
  await ensureSession();
  const { data } = await db().auth.getUser();
  return data.user!.id;
}

// ─── Profile ───
export async function getMyName(): Promise<string> {
  const id = await me();
  return unwrap(await db().from('users').select('display_name').eq('id', id).single()).display_name;
}
export async function setMyName(name: string) {
  const id = await me();
  unwrap(await db().from('users').update({ display_name: name.trim() }).eq('id', id));
}

// ─── Squads ───
export async function listSquads(): Promise<Squad[]> {
  await me();
  return unwrap(
    await db()
      .from('squads')
      .select(
        'id, name, squad_members(id, member_user_id, display_name, contact_ref, default_tier, sort_order)',
      )
      .order('created_at', { ascending: false }),
  ) as Squad[];
}

/** Creates or replaces a squad and its members in one go. */
export async function saveSquad(
  id: string | null,
  name: string,
  members: SquadMember[],
): Promise<string> {
  if (!name.trim()) throw new Error('Give the squad a name');
  await me();
  const squadId = id
    ? (unwrap(
        await db().from('squads').update({ name: name.trim() }).eq('id', id).select('id').single(),
      ).id as string)
    : (unwrap(await db().from('squads').insert({ name: name.trim() }).select('id').single())
        .id as string);
  // shortcut: delete-then-insert isn't atomic; move into an RPC if partial saves show up.
  if (id) unwrap(await db().from('squad_members').delete().eq('squad_id', id));
  if (members.length) {
    unwrap(
      await db()
        .from('squad_members')
        .insert(
          members.map(({ id: _drop, ...m }, i) => ({ ...m, squad_id: squadId, sort_order: i })),
        ),
    );
  }
  return squadId;
}

export async function deleteSquad(id: string) {
  await me();
  unwrap(await db().from('squads').delete().eq('id', id));
}

// ─── Events ───
export type Recipient = Omit<SquadMember, 'id' | 'sort_order'>;

export async function createEvent(
  e: Pick<Event, 'title' | 'location_text' | 'scheduled_at' | 'max_spots' | 'min_accepted_quorum'>,
  recipients: Recipient[],
): Promise<string> {
  if (!e.title.trim()) throw new Error('Title is required');
  const primary = recipients.filter((r) => r.default_tier === 'primary');
  if (primary.length === 0) throw new Error('Invite at least one person');
  if (e.max_spots != null && primary.length > e.max_spots)
    throw new Error(`Only ${e.max_spots} spots: move ${primary.length - e.max_spots} to the bench`);
  await me();
  const event = unwrap(
    await db()
      .from('events')
      .insert({
        ...e,
        title: e.title.trim(),
        event_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      .select('id')
      .single(),
  );
  const bench = recipients.filter((r) => r.default_tier === 'bench');
  unwrap(
    await db()
      .from('event_invites')
      .insert(
        [...primary, ...bench].map((r, i) => ({
          event_id: event.id,
          invitee_user_id: r.member_user_id,
          invitee_display_name: r.display_name,
          invitee_contact_ref: r.contact_ref,
          tier: r.default_tier,
          rsvp_status: r.default_tier === 'bench' ? 'bench' : 'invited',
          sort_order: r.default_tier === 'bench' ? i - primary.length : 0,
        })),
      ),
  );
  return event.id;
}

export async function listEvents(): Promise<{
  hosting: Event[];
  invited: (Event & { myInvite: Invite })[];
}> {
  const uid = await me();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const events = unwrap(
    await db()
      .from('events')
      .select('*')
      .gte('scheduled_at', since)
      .neq('status', 'cancelled')
      .order('scheduled_at'),
  ) as Event[];
  const mine = unwrap(
    await db().from('event_invites').select('*').eq('invitee_user_id', uid),
  ) as Invite[];
  return {
    hosting: events.filter((e) => e.owner_id === uid),
    invited: events.flatMap((e) => {
      const myInvite = mine.find((i) => i.event_id === e.id);
      return e.owner_id !== uid && myInvite ? [{ ...e, myInvite }] : [];
    }),
  };
}

export async function getEvent(id: string) {
  const uid = await me();
  const event = unwrap(await db().from('events').select('*').eq('id', id).single()) as Event;
  // RLS: owners get the whole roster, invitees only their own row.
  const invites = unwrap(
    await db()
      .from('event_invites')
      .select('*')
      .eq('event_id', id)
      .order('tier')
      .order('sort_order'),
  ) as Invite[];
  return { event, invites, isOwner: event.owner_id === uid };
}

export const approveTimeChange = async (inviteId: string, time: string) =>
  unwrap(await db().rpc('approve_time_change', { p_invite_id: inviteId, p_time: time }));

export const rejectTimeChange = async (inviteId: string) =>
  unwrap(
    await db()
      .from('event_invites')
      .update({ rsvp_status: 'invited', proposed_times: [] })
      .eq('id', inviteId),
  );

export const promoteNextBench = async (eventId: string) =>
  unwrap(await db().rpc('promote_next_bench', { p_event_id: eventId })) as string;

// ─── Token-scoped (works logged out, e.g. the web RSVP page) ───
export async function getInviteByToken(token: string): Promise<InviteSummary | null> {
  const rows = unwrap(await db().rpc('get_invite_by_token', { p_token: token })) as InviteSummary[];
  return rows[0] ?? null;
}

export const respond = async (
  token: string,
  status: 'accepted' | 'declined' | 'time_change_requested',
  times: Date[] = [],
) =>
  unwrap(
    await db().rpc('respond_to_invite', {
      p_token: token,
      p_status: status,
      p_proposed_times: times.map((t) => t.toISOString()),
    }),
  );

export async function claimInvite(token: string): Promise<string> {
  await me();
  return unwrap(await db().rpc('claim_invite', { p_token: token })) as string;
}

export const inviteLink = (token: string) => {
  const web = process.env.EXPO_PUBLIC_WEB_URL;
  return web ? `${web.replace(/\/$/, '')}/e/${token}` : `pulseplan://e/${token}`;
};

let myPushToken: string | null = null;

/** Removes this phone's push token from the current account (on sign-out). */
export async function forgetThisDevice() {
  if (!supabase || !myPushToken) return;
  await db().from('user_devices').delete().eq('push_token', myPushToken);
  myPushToken = null;
}

/** Saves this device's Expo push token so the database triggers can reach it. Needs a dev build + EAS project id. */
export async function registerPushToken() {
  if (!supabase || Platform.OS === 'web') return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return; // run `npx eas-cli init` to get one
  try {
    const perm = await Notifications.getPermissionsAsync();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    myPushToken = token;
    const user_id = await me();
    unwrap(
      await db().from('user_devices').upsert(
        {
          user_id,
          platform: Platform.OS,
          push_token: token,
          notifications_granted: perm.granted,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,push_token' },
      ),
    );
  } catch (e) {
    console.warn('Push registration skipped', e); // e.g. Expo Go on Android
  }
}

/** Calls the event's loader again whenever an invite or the event row changes (Supabase Realtime). */
export function useLive<T>(load: () => Promise<T>, eventId?: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    load()
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [load]);

  useEffect(() => {
    refresh();
    if (!supabase || !eventId) return;
    const ch = supabase
      .channel(`event:${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_invites', filter: `event_id=eq.${eventId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        refresh,
      )
      .subscribe();
    return () => void supabase!.removeChannel(ch);
  }, [refresh, eventId]);

  return { data, error, refresh };
}
