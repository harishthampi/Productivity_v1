import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { RsvpActions } from '../../components/RsvpActions';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Field,
  formatTime,
  formatWhen,
  Label,
  Progress,
  type Tone,
} from '../../components/ui';
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
import { makeStyles, tabular } from '../../theme';

const STATUS: Record<Invite['rsvp_status'], [string, Tone]> = {
  accepted: ['Accepted', 'success'],
  time_change_requested: ['Needs a new time', 'retry'],
  invited: ['Waiting for reply', 'primary'],
  declined: ['Declined', 'missed'],
  bench: ['Bench', 'missed'],
};

const diffLabel = (from: string, to: string) => {
  const mins = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  if (mins === 0) return 'same time';
  const abs = Math.abs(mins);
  const amount =
    abs % 60 === 0
      ? `${abs / 60} h`
      : abs > 60
        ? `${Math.floor(abs / 60)} h ${abs % 60} min`
        : `${abs} min`;
  return `${mins > 0 ? '+' : '−'}${amount}`;
};

export default function EventDetail() {
  const s = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => getEvent(id), [id]);
  const { data, error, refresh } = useLive(load, id);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => () =>
    void fn().then(
      () => (setMsg(null), refresh()),
      (e: Error) => setMsg(e.message),
    );

  if (error) return <Text style={[s.pad, s.error]}>{error}</Text>;
  if (!data) return <Text style={[s.pad, s.muted]}>Loading…</Text>;
  const { event, invites, isOwner } = data;

  const header = (
    <Card>
      <Text style={s.title}>{event.title}</Text>
      <Text style={s.when}>{formatWhen(event.scheduled_at)}</Text>
      {!!event.location_text && <Text style={s.muted}>📍 {event.location_text}</Text>}
    </Card>
  );

  if (!isOwner) {
    const mine = invites[0]; // RLS returns only the viewer's own invite
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <Stack.Screen options={{ title: 'Invite' }} />
        {header}
        {mine && (
          <Card>
            <RsvpActions
              token={mine.invite_token}
              status={mine.rsvp_status}
              proposed={mine.proposed_times}
              scheduledAt={event.scheduled_at}
              onDone={refresh}
            />
          </Card>
        )}
      </ScrollView>
    );
  }

  const accepted = invites.filter((i) => i.rsvp_status === 'accepted');
  const bench = invites.filter((i) => i.rsvp_status === 'bench');
  const changes = invites.filter((i) => i.rsvp_status === 'time_change_requested');
  const roster = invites.filter((i) => i.rsvp_status !== 'bench');
  const target = event.max_spots ?? event.min_accepted_quorum ?? roster.length;
  const needed = Math.max(0, target - accepted.length);
  const openSpot =
    bench.length > 0 &&
    invites.some((i) => i.rsvp_status === 'declined') &&
    (event.max_spots == null ||
      invites.filter((i) => !['bench', 'declined'].includes(i.rsvp_status)).length <
        event.max_spots);
  const share = (i: Invite) =>
    void Share.share({
      message: `${event.title}, ${formatWhen(event.scheduled_at)}. Tap to reply: ${inviteLink(i.invite_token)}`,
    });

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Stack.Screen options={{ title: 'Plan' }} />
      {header}
      {msg && <Text style={s.error}>{msg}</Text>}

      {changes.map((i) => (
        <Card key={i.id} style={s.alert}>
          <Chip label="Time change requested" tone="retry" />
          <Text style={s.alertTitle}>{i.invitee_display_name} asked to move it</Text>
          {i.proposed_times.map((p) => (
            <View key={p} style={{ gap: 8 }}>
              <Text style={[s.alertBody, tabular]}>
                {formatWhen(p)} · {diffLabel(event.scheduled_at, p)}
              </Text>
              <Button
                label={`✓ Approve ${formatTime(p)} (updates everyone)`}
                kind="primary"
                onPress={run(() => approveTimeChange(i.id, p))}
              />
            </View>
          ))}
          <Button
            label={`Keep ${formatTime(event.scheduled_at)}`}
            onPress={run(() => rejectTimeChange(i.id))}
          />
        </Card>
      ))}

      <Card>
        <Label>Quorum</Label>
        <Text style={s.quorum}>
          {accepted.length} / {target} confirmed
          <Text style={s.muted}>{needed ? ` · need ${needed} more` : ' · locked in ✓'}</Text>
        </Text>
        <Progress
          value={target ? accepted.length / target : 0}
          tone={needed ? 'primary' : 'success'}
        />
      </Card>

      {openSpot && (
        <Card style={s.alert}>
          <Text style={s.alertTitle}>A spot opened up</Text>
          <Text style={s.alertBody}>
            Invite {bench[0].invitee_display_name}, first on the bench?
          </Text>
          <Button
            label="Invite Bench #1"
            kind="primary"
            onPress={run(() => promoteNextBench(event.id))}
          />
        </Card>
      )}

      <SaveAsSquad event={event} accepted={accepted} />

      <Card>
        <Label>Attendees</Label>
        <View style={s.person}>
          <Avatar name="You" />
          <Text style={s.name}>You</Text>
          <Chip label="Host" tone="primary" />
        </View>
        {roster.map((i) => {
          const [label, tone] = STATUS[i.rsvp_status];
          return (
            <View key={i.id} style={s.person}>
              <Avatar name={i.invitee_display_name} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.name}>{i.invitee_display_name}</Text>
                <Chip label={label} tone={tone} />
              </View>
              <Button
                label="Share link"
                kind="ghost"
                onPress={() => share(i)}
                accessibilityLabel={`Share invite link with ${i.invitee_display_name}`}
              />
            </View>
          );
        })}
      </Card>

      {bench.length > 0 && (
        <Card>
          <Label>Bench standbys</Label>
          {bench.map((i, n) => (
            <View key={i.id} style={s.person}>
              <Text style={s.rank}>#{n + 1}</Text>
              <Avatar name={i.invitee_display_name} />
              <Text style={[s.name, { flex: 1 }]}>{i.invitee_display_name}</Text>
              {n === 0 && <Button label="Invite" onPress={run(() => promoteNextBench(event.id))} />}
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

/** Journey 3: once the spots fill (or the event has passed), offer to keep these players as a squad. */
function SaveAsSquad({ event, accepted }: { event: Event; accepted: Invite[] }) {
  const s = useStyles();
  const [state, setState] = useState<'idle' | 'naming' | 'saved'>('idle');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = event.max_spots != null && accepted.length >= event.max_spots;
  const past = new Date(event.scheduled_at) < new Date();
  if (!accepted.length || !(full || past)) return null;
  if (state === 'saved') return <Text style={s.muted}>Saved to My Squads ✓</Text>;

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
    <Card>
      <Text style={s.alertTitle}>Save these {accepted.length} players as a Squad?</Text>
      {state === 'idle' ? (
        <Button label="Save" kind="primary" onPress={() => setState('naming')} />
      ) : (
        <>
          <Field
            value={name}
            onChangeText={setName}
            placeholder="e.g. Thursday Court Crew"
            accessibilityLabel="Squad name"
            autoFocus
          />
          <Button label="Save squad" kind="primary" onPress={() => void save()} />
        </>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: t.text },
  when: { fontSize: 15, color: t.muted, ...tabular },
  muted: { fontSize: 14, color: t.muted },
  error: { fontSize: 14, color: t.danger },
  alert: { borderColor: t.retry, backgroundColor: t.retrySoft },
  alertBody: { fontSize: 14, color: t.text },
  alertTitle: { fontSize: 17, fontWeight: '700', color: t.text },
  quorum: { fontSize: 18, fontWeight: '700', color: t.text, ...tabular },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  name: { fontSize: 16, fontWeight: '600', color: t.text },
  rank: { width: 28, fontSize: 15, fontWeight: '700', color: t.muted, ...tabular },
}));
