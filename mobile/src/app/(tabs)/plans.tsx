import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Chip, formatTime, formatWhen, type Tone } from '../../components/ui';
import {
  backendReady,
  listEvents,
  listSquads,
  useLive,
  type Event,
  type Invite,
  type RsvpStatus,
  type Squad,
} from '../../lib/social';
import { makeStyles, tabular } from '../../theme';

const MY_RSVP: Record<RsvpStatus, [string, Tone]> = {
  bench: ['Bench', 'missed'],
  invited: ['Awaiting your reply', 'retry'],
  accepted: ['Going', 'success'],
  declined: ['Declined', 'missed'],
  time_change_requested: ['You asked for a new time', 'retry'],
};

const openEvent = (id: string) => router.push({ pathname: '/event/[id]', params: { id } });

export default function Plans() {
  const s = useStyles();
  const [tab, setTab] = useState<'plans' | 'squads'>('plans');
  const events = useLive(listEvents);
  const squads = useLive(listSquads);
  const { refresh: refreshEvents } = events;
  const { refresh: refreshSquads } = squads;
  useFocusEffect(
    useCallback(() => {
      if (!backendReady) return;
      refreshEvents();
      refreshSquads();
    }, [refreshEvents, refreshSquads]),
  );

  if (!backendReady) {
    return (
      <SafeAreaView edges={['top']} style={s.screen}>
        <View style={s.content}>
          <Text style={s.h1}>Plans</Text>
          <Card>
            <Text style={s.cardTitle}>Plans need a backend</Text>
            <Text style={s.muted}>
              Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env, then
              restart the app.
            </Text>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const hosting = events.data?.hosting ?? [];
  const invited = events.data?.invited ?? [];
  const planCount = hosting.length + invited.length;
  const error = events.error ?? squads.error;

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.headerRow}>
          <Text style={s.h1}>Plans</Text>
          <Button
            label="New plan"
            kind="primary"
            onPress={() => router.push('/event/new')}
            style={s.headerBtn}
          />
        </View>

        <View style={s.segment} accessibilityRole="tablist">
          {(
            [
              ['plans', 'Upcoming', planCount],
              ['squads', 'Squads', squads.data?.length ?? 0],
            ] as const
          ).map(([key, label, count]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityLabel={`${label}, ${count}`}
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[s.segBtn, tab === key && s.segBtnOn]}
            >
              <Text style={[s.segText, tab === key && s.segTextOn]}>
                {label} <Text style={s.segCount}>{count}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
        {error && <Text style={s.error}>{error}</Text>}

        {tab === 'plans' ? (
          <>
            {planCount === 0 && events.data && (
              <Text style={s.muted}>No plans yet. Start one with a squad or a few friends.</Text>
            )}
            {hosting.map((e) => (
              <HostedCard key={e.id} event={e} />
            ))}
            {invited.length > 0 && <Text style={s.h2}>Invited</Text>}
            {invited.map((e) => {
              const [label, tone] = MY_RSVP[e.myInvite.rsvp_status];
              return (
                <Pressable key={e.id} accessibilityRole="button" onPress={() => openEvent(e.id)}>
                  <Card>
                    <Text style={s.cardTitle}>{e.title}</Text>
                    <Text style={s.when}>{formatWhen(e.scheduled_at)}</Text>
                    <Chip label={label} tone={tone} />
                  </Card>
                </Pressable>
              );
            })}
          </>
        ) : (
          <>
            {squads.data?.length === 0 && (
              <Text style={s.muted}>
                Save a group of friends you invite often, like “Badminton Doubles”.
              </Text>
            )}
            {squads.data?.map((sq) => (
              <SquadCard key={sq.id} squad={sq} />
            ))}
            <Button
              label="New squad"
              onPress={() => router.push({ pathname: '/squad/[id]', params: { id: 'new' } })}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function HostedCard({ event: e }: { event: Event & { invites: Invite[] } }) {
  const s = useStyles();
  const accepted = e.invites.filter((i) => i.rsvp_status === 'accepted').length;
  const waiting = e.invites.filter((i) => i.rsvp_status === 'invited').length;
  const bench = e.invites.filter((i) => i.rsvp_status === 'bench').length;
  const changes = e.invites.filter((i) => i.rsvp_status === 'time_change_requested');
  const target = e.max_spots ?? e.min_accepted_quorum;
  const full = target != null && accepted >= target;

  return (
    <Pressable accessibilityRole="button" onPress={() => openEvent(e.id)}>
      <Card>
        <Text style={s.cardTitle}>{e.title}</Text>
        <Text style={s.when}>{formatWhen(e.scheduled_at)}</Text>
        <View style={s.chips}>
          {changes.length > 0 ? (
            <Chip
              label={changes.length > 1 ? `${changes.length} time changes` : 'Time change'}
              tone="retry"
            />
          ) : (
            full && <Chip label="Full" tone="success" />
          )}
          <Text style={s.when}>
            {accepted}
            {target ? ` of ${target}` : ''} going{waiting ? ` · ${waiting} waiting` : ''}
          </Text>
        </View>
        {(changes[0] || bench > 0) && (
          <Text style={s.muted}>
            {changes[0]
              ? `${changes[0].invitee_display_name} proposed ${changes[0].proposed_times.map((p) => formatTime(p)).join(' or ')}`
              : ''}
            {changes[0] && bench ? ' · ' : ''}
            {bench ? `${bench} on the bench` : ''}
          </Text>
        )}
        {changes.length > 0 && (
          <Button label="Review time change" onPress={() => openEvent(e.id)} />
        )}
      </Card>
    </Pressable>
  );
}

function SquadCard({ squad }: { squad: Squad }) {
  const s = useStyles();
  const members = [...squad.squad_members].sort((a, b) => a.sort_order - b.sort_order);
  const primary = members.filter((m) => m.default_tier === 'primary').length;
  return (
    <Card>
      <Text style={s.cardTitle}>{squad.name}</Text>
      <Text style={s.muted}>
        {primary} primary · {members.length - primary} bench
      </Text>
      <View style={s.roster}>
        {members.slice(0, 8).map((m, i) => (
          // Bench members sit dimmed; the counts above carry the same info as text.
          <View key={m.id ?? i} style={m.default_tier !== 'primary' && s.benched}>
            <Avatar name={m.display_name} size={32} />
          </View>
        ))}
        {members.length > 8 && <Text style={s.muted}>+{members.length - 8}</Text>}
      </View>
      <View style={s.actions}>
        <Button
          label="Plan with them"
          kind="primary"
          onPress={() => router.push({ pathname: '/event/new', params: { squad: squad.id } })}
          style={{ flex: 1 }}
        />
        <Button
          label="Edit"
          onPress={() => router.push({ pathname: '/squad/[id]', params: { id: squad.id } })}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  h1: { fontSize: 32, fontWeight: '600', color: t.text },
  h2: { fontSize: 20, fontWeight: '600', color: t.text, marginTop: 8 },
  headerBtn: { minHeight: 40, paddingVertical: 8 },
  segment: {
    flexDirection: 'row',
    backgroundColor: t.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    padding: 4,
  },
  segBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnOn: { backgroundColor: t.primarySoft },
  segText: { fontSize: 14, fontWeight: '500', color: t.muted, ...tabular },
  segTextOn: { color: t.primaryText },
  segCount: { fontWeight: '400' },
  cardTitle: { fontSize: 18, fontWeight: '600', color: t.text },
  when: { fontSize: 14, color: t.muted, ...tabular },
  muted: { fontSize: 14, color: t.muted },
  error: { fontSize: 14, color: t.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  benched: { opacity: 0.45 },
  actions: { flexDirection: 'row', gap: 8 },
}));
