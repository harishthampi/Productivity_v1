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
import { makeStyles, tabular, useTheme } from '../../theme';

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
            label="＋ New Plan"
            kind="primary"
            onPress={() => router.push('/event/new')}
            style={s.headerBtn}
          />
        </View>

        <View style={s.segment} accessibilityRole="tablist">
          {(
            [
              ['plans', `Upcoming Plans (${planCount})`],
              ['squads', `My Squads (${squads.data?.length ?? 0})`],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[s.segBtn, tab === key && s.segBtnOn]}
            >
              <Text style={[s.segText, tab === key && s.segTextOn]}>{label}</Text>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/squad/[id]', params: { id: 'new' } })}
              style={s.dashed}
            >
              <Text style={s.dashedText}>＋ Create New Squad</Text>
            </Pressable>
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
          {changes.length > 0 && (
            <Chip
              label={`${changes.length} time change${changes.length > 1 ? 's' : ''} requested · needs review`}
              tone="retry"
            />
          )}
          {full ? (
            <Chip label={`${accepted}/${target} confirmed · full quorum`} tone="success" />
          ) : (
            <Chip
              label={`${accepted}${target ? `/${target}` : ''} going${waiting ? ` (${waiting} pending)` : ''}`}
              tone="primary"
            />
          )}
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
          <Button label="Review Time Change" onPress={() => openEvent(e.id)} />
        )}
      </Card>
    </Pressable>
  );
}

function SquadCard({ squad }: { squad: Squad }) {
  const s = useStyles();
  const t = useTheme();
  const members = [...squad.squad_members].sort((a, b) => a.sort_order - b.sort_order);
  const primary = members.filter((m) => m.default_tier === 'primary').length;
  return (
    <Card>
      <Text style={s.cardTitle}>{squad.name}</Text>
      <Text style={s.muted}>
        {primary} Primary · {members.length - primary} Bench
      </Text>
      <View style={s.roster}>
        {members.slice(0, 8).map((m, i) => (
          <View key={m.id ?? i} style={{ alignItems: 'center', gap: 2 }}>
            <Avatar name={m.display_name} size={32} />
            <Text style={[s.tier, { color: m.default_tier === 'primary' ? t.primary : t.muted }]}>
              {m.default_tier === 'primary' ? 'P' : 'B'}
            </Text>
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
  screen: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  h1: { fontSize: 34, fontWeight: '800', color: t.text },
  h2: { fontSize: 20, fontWeight: '700', color: t.text, marginTop: 8 },
  headerBtn: { minHeight: 40, paddingVertical: 8, borderRadius: 999 },
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
  segText: { fontSize: 14, fontWeight: '600', color: t.muted, ...tabular },
  segTextOn: { color: t.primaryText },
  cardTitle: { fontSize: 18, fontWeight: '700', color: t.text },
  when: { fontSize: 14, color: t.muted, ...tabular },
  muted: { fontSize: 14, color: t.muted },
  error: { fontSize: 14, color: t.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  tier: { fontSize: 11, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  dashed: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashedText: { fontSize: 16, fontWeight: '600', color: t.muted },
}));
