import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { RsvpActions } from '../../components/RsvpActions';
import { Button, colors, formatWhen } from '../../components/ui';
import {
  approveTimeChange,
  getEvent,
  inviteLink,
  promoteNextBench,
  rejectTimeChange,
  saveSquad,
  useLive,
  type Event,
  type Invite,
} from '../../lib/social';

const GROUPS: { status: Invite['rsvp_status']; label: string }[] = [
  { status: 'accepted', label: 'Going' },
  { status: 'time_change_requested', label: 'Time change requested' },
  { status: 'invited', label: 'Waiting for reply' },
  { status: 'declined', label: 'Declined' },
  { status: 'bench', label: 'Bench' },
];

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => getEvent(id), [id]);
  const { data, error, refresh } = useLive(load, id);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => () =>
    void fn().then(
      () => (setMsg(null), refresh()),
      (e: Error) => setMsg(e.message),
    );

  if (error) return <Text style={[s.pad, { color: colors.danger }]}>{error}</Text>;
  if (!data) return <Text style={s.pad}>Loading…</Text>;
  const { event, invites, isOwner } = data;

  const header = (
    <View style={s.card}>
      <Text style={s.title}>{event.title}</Text>
      <Text style={s.sub}>{formatWhen(event.scheduled_at)}</Text>
      {!!event.location_text && <Text style={s.sub}>📍 {event.location_text}</Text>}
    </View>
  );

  if (!isOwner) {
    const mine = invites[0]; // RLS returns only the viewer's own invite
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <Stack.Screen options={{ title: 'Invite' }} />
        {header}
        {mine && (
          <RsvpActions
            token={mine.invite_token}
            status={mine.rsvp_status}
            proposed={mine.proposed_times}
            scheduledAt={event.scheduled_at}
            onDone={refresh}
          />
        )}
      </ScrollView>
    );
  }

  const accepted = invites.filter((i) => i.rsvp_status === 'accepted');
  const bench = invites.filter((i) => i.rsvp_status === 'bench');
  const openSpot =
    bench.length > 0 &&
    invites.some((i) => i.rsvp_status === 'declined') &&
    (event.max_spots == null ||
      invites.filter((i) => !['bench', 'declined'].includes(i.rsvp_status)).length <
        event.max_spots);

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Stack.Screen options={{ title: 'Hosting' }} />
      {header}
      <Text style={s.sub}>
        {accepted.length}
        {event.max_spots ? `/${event.max_spots}` : ''} going
        {event.min_accepted_quorum
          ? accepted.length >= event.min_accepted_quorum
            ? ' · quorum reached ✓'
            : ` · needs ${event.min_accepted_quorum} to go ahead`
          : ''}
      </Text>
      {msg && <Text style={{ color: colors.danger }}>{msg}</Text>}

      {openSpot && (
        <View style={[s.card, { backgroundColor: colors.warn }]}>
          <Text style={s.cardText}>
            Someone declined. Invite {bench[0].invitee_display_name} from the bench?
          </Text>
          <Button
            label="Invite Next Bench Member"
            kind="primary"
            onPress={run(() => promoteNextBench(event.id))}
          />
        </View>
      )}

      <SaveAsSquad event={event} accepted={accepted} />

      {GROUPS.map(({ status, label }) => {
        const group = invites.filter((i) => i.rsvp_status === status);
        if (!group.length) return null;
        return (
          <View key={status} style={{ gap: 8 }}>
            <Text style={s.h}>
              {label} ({group.length})
            </Text>
            {group.map((i) => (
              <View key={i.id} style={s.card}>
                <Text style={s.cardText}>{i.invitee_display_name}</Text>
                {status === 'time_change_requested' &&
                  i.proposed_times.map((t) => (
                    <Button
                      key={t}
                      label={`Approve ${formatWhen(t)}`}
                      kind="primary"
                      onPress={run(() => approveTimeChange(i.id, t))}
                    />
                  ))}
                {status === 'time_change_requested' && (
                  <Button label="Decline proposal" onPress={run(() => rejectTimeChange(i.id))} />
                )}
                {status !== 'bench' && (
                  <Button
                    label="Share invite link"
                    onPress={() =>
                      void Share.share({
                        message: `${event.title}, ${formatWhen(event.scheduled_at)}. Tap to reply: ${inviteLink(i.invite_token)}`,
                      })
                    }
                  />
                )}
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Journey 3: once the spots fill (or the event has passed), offer to keep these players as a squad. */
function SaveAsSquad({ event, accepted }: { event: Event; accepted: Invite[] }) {
  const [state, setState] = useState<'idle' | 'naming' | 'saved'>('idle');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = event.max_spots != null && accepted.length >= event.max_spots;
  const past = new Date(event.scheduled_at) < new Date();
  if (!accepted.length || !(full || past)) return null;
  if (state === 'saved') return <Text style={s.sub}>Saved to My Squads ✓</Text>;

  const save = async () => {
    try {
      await saveSquad(
        null,
        name,
        accepted.map((i, n) => ({
          member_user_id: i.invitee_user_id,
          display_name: i.invitee_display_name,
          contact_ref: i.invitee_contact_ref,
          default_tier: 'primary',
          sort_order: n,
        })),
      );
      setState('saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={s.card}>
      <Text style={s.cardText}>Save these {accepted.length} players as a Squad?</Text>
      {state === 'idle' ? (
        <Button label="Save" kind="primary" onPress={() => setState('naming')} />
      ) : (
        <>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Thursday Court Crew"
            accessibilityLabel="Squad name"
            autoFocus
            style={s.input}
          />
          <Button label="Save squad" kind="primary" onPress={() => void save()} />
        </>
      )}
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16, gap: 10 },
  card: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  sub: { fontSize: 16, color: colors.muted },
  h: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 12 },
  cardText: { fontSize: 16, fontWeight: '600', color: colors.text },
  input: {
    fontSize: 16,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
});
