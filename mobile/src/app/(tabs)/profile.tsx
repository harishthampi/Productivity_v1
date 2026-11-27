import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Field, Label, Progress } from '../../components/ui';
import {
  computeStats,
  TIME_WINDOWS,
  timeWindowStats,
  type AttemptLog,
  type TimeWindow,
} from '../../core/tasks';
import { accountLabel, deleteAccount, signOut, useAuthUser } from '../../lib/auth';
import { notificationsAllowed } from '../../lib/notifications';
import { backendReady, getMyName, setMyName } from '../../lib/social';
import { pendingSyncCount, setDefaultCheckinDelay, useStore } from '../../lib/store';
import { makeStyles, tabular, useTheme } from '../../theme';

const DELAYS: { label: string; value: number | null }[] = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '60m', value: 60 },
  { label: 'Off', value: null },
];
const WINDOW_HOURS: Record<TimeWindow, string> = {
  Morning: '5 AM – 12 PM',
  Afternoon: '12 PM – 5 PM',
  Evening: '5 PM – 5 AM',
};
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const DAY = 86_400_000;

function toCsv(logs: AttemptLog[], titles: Map<string, string>) {
  const q = (v: string | number | null) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const rows = [...logs]
    .sort((a, b) => a.resolved_at.localeCompare(b.resolved_at))
    .map((l) =>
      [
        titles.get(l.task_id) ?? '(deleted task)',
        l.attempt_number,
        l.scheduled_at,
        l.resolved_at,
        l.outcome,
        l.retry_target_at,
      ]
        .map(q)
        .join(','),
    );
  return ['task,attempt,scheduled_at,resolved_at,outcome,retry_target_at', ...rows].join('\n');
}

export default function Profile() {
  const s = useStyles();
  const logs = useStore((st) => st.logs);
  const tasks = useStore((st) => st.tasks);
  const defaultDelay = useStore((st) => st.settings.defaultCheckinDelay);
  const [now] = useState(() => Date.now());

  const recent = logs.filter((l) => now - Date.parse(l.resolved_at) <= 30 * DAY);
  const month = computeStats(recent);
  const attempts = month.onTime + month.late + month.retried + month.failed;
  const finals = month.onTime + month.late + month.failed;
  const followThrough = pct(month.onTime + month.late, finals);

  const allTime = computeStats(logs);
  const lastSeven = logs
    .filter((l) => l.outcome !== 'retried')
    .sort((a, b) => b.resolved_at.localeCompare(a.resolved_at))
    .slice(0, 7)
    .reverse();
  const { by, best } = timeWindowStats(logs);

  const exportLog = () =>
    void Share.share({
      title: 'PulsePlan accountability log',
      message: toCsv(logs, new Map(tasks.map((t) => [t.id, t.title]))),
    });

  const columns = [
    {
      label: 'On-time',
      n: month.onTime,
      note: month.late ? `+${month.late} late` : 'Right on pace',
    },
    { label: 'Retried', n: month.retried, note: 'Adaptive pacing' },
    { label: 'Missed', n: month.failed, note: 'Recalibrated' },
  ];

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.h1}>Profile</Text>
        <Identity />

        <Card>
          <Label>Execution balance · last 30 days</Label>
          <View style={s.gaugeRow}>
            <Text style={s.gauge}>{finals ? `${followThrough}%` : '—'}</Text>
            <Text style={s.gaugeLabel}>
              overall follow-through{'\n'}
              <Text style={s.muted}>
                {attempts} committed block{attempts === 1 ? '' : 's'}
              </Text>
            </Text>
          </View>
          <Progress value={finals ? followThrough / 100 : 0} tone="success" />
          <View style={s.columns}>
            {columns.map((c) => (
              <View
                key={c.label}
                style={s.column}
                accessible
                accessibilityLabel={`${c.label}: ${c.n} tasks, ${pct(c.n, attempts)} percent. ${c.note}`}
              >
                <Text style={s.colValue}>{c.n}</Text>
                <Text style={s.colLabel}>
                  {c.label} · {pct(c.n, attempts)}%
                </Text>
                <Text style={s.muted}>{c.note}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <Label>Consistency streak</Label>
          <Text style={s.streak}>
            {allTime.streak} <Text style={s.streakUnit}>on time in a row</Text>
          </Text>
          <StreakDots logs={lastSeven} />
          <Text style={s.quote}>“Consistency is about honest loops, not rigid perfection.”</Text>
        </Card>

        <Card>
          <Label>Time-of-day rhythm</Label>
          {TIME_WINDOWS.map((w) => {
            const { total, onTime } = by[w];
            const rate = pct(onTime, total);
            return (
              <View
                key={w}
                style={{ gap: 6 }}
                accessible
                accessibilityLabel={
                  total
                    ? `${w}: ${rate} percent on time across ${total} tasks`
                    : `${w}: no tasks yet`
                }
              >
                <View style={s.rhythmHead}>
                  <Text style={s.rhythmName}>
                    {w} <Text style={s.muted}>{WINDOW_HOURS[w]}</Text>
                  </Text>
                  <Text style={s.rhythmValue}>{total ? `${rate}%` : 'No data'}</Text>
                </View>
                <Progress value={rate / 100} />
                {w === best && <Text style={s.peak}>Peak focus</Text>}
              </View>
            );
          })}
          <Text style={s.muted}>
            All time, by when each task was scheduled. Retries aren’t counted.
          </Text>
        </Card>

        <Card>
          <Label>Preferences</Label>
          <Text style={s.rowTitle}>Default check-in window</Text>
          <View style={s.chips}>
            {DELAYS.map((d) => (
              <Button
                key={d.label}
                label={d.label}
                selected={defaultDelay === d.value}
                onPress={() => setDefaultCheckinDelay(d.value)}
                style={s.chip}
              />
            ))}
          </View>
          <NotificationRow />
          <Button
            label="Export Accountability Log (CSV)"
            onPress={exportLog}
            disabled={logs.length === 0}
          />
        </Card>

        {backendReady && <NameRow />}
        <AccountSection />
        <Text style={[s.muted, { textAlign: 'center' }]}>Only you can see these numbers.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function StreakDots({ logs }: { logs: AttemptLog[] }) {
  const s = useStyles();
  const t = useTheme();
  if (!logs.length) return <Text style={s.muted}>Your last 7 results will show here.</Text>;
  return (
    <View
      style={s.dots}
      accessible
      accessibilityLabel={`Last ${logs.length} results: ${logs.filter((l) => l.outcome === 'completed_on_time').length} on time`}
    >
      {logs.map((l) => (
        <View
          key={l.idempotency_key}
          style={[
            s.dotItem,
            l.outcome === 'completed_on_time'
              ? { backgroundColor: t.success, borderColor: t.success }
              : l.outcome === 'completed_late'
                ? { borderColor: t.success }
                : { borderColor: t.inactive },
          ]}
        />
      ))}
    </View>
  );
}

function Identity() {
  const s = useStyles();
  const user = useAuthUser();
  const [name, setName] = useState('');
  useEffect(() => {
    if (backendReady) getMyName().then(setName, () => {});
  }, [user?.id]);
  const shown = name || (user && !user.is_anonymous ? (user.email?.split('@')[0] ?? 'You') : 'You');
  return (
    <Card style={s.identity}>
      <Avatar name={shown} size={52} />
      <View style={{ flex: 1 }}>
        <Text style={s.idName}>{shown}</Text>
        <Text style={s.muted}>
          {!backendReady ? 'On this device' : user ? accountLabel(user) : 'Not signed in'}
        </Text>
      </View>
    </Card>
  );
}

function AccountSection() {
  const s = useStyles();
  const user = useAuthUser();
  const [msg, setMsg] = useState<string | null>(null);
  const leave = (fn: () => Promise<void>) => () =>
    void fn().then(
      () => router.replace(backendReady ? '/welcome' : '/'),
      (e: Error) => setMsg(e.message),
    );
  const unsynced = () => {
    const n = pendingSyncCount();
    return n ? ` ${n} change${n === 1 ? '' : 's'} haven’t synced yet and will be lost.` : '';
  };
  const confirmDelete = () =>
    Alert.alert(
      backendReady ? 'Delete account?' : 'Delete all data?',
      backendReady
        ? 'This permanently deletes your account, tasks, stats, squads and the plans you host. Friends’ plans keep your name but lose the link to you. This can’t be undone.'
        : 'This permanently deletes every task and stat on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: leave(deleteAccount) },
      ],
    );
  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      `Your data stays in your account; this phone is cleared.${unsynced()}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: leave(signOut) },
      ],
    );

  if (user === undefined) return null;
  const guest = !user || user.is_anonymous;
  return (
    <Card>
      <Label>Account</Label>
      {!backendReady ? (
        <Text style={s.muted}>Your data is stored only on this device.</Text>
      ) : guest ? (
        <>
          <Text style={s.muted}>
            You’re using PulsePlan as a guest. Sign in to keep your data if you change phones.
          </Text>
          <Button label="Sign in" kind="primary" onPress={() => router.push('/welcome')} />
        </>
      ) : (
        <>
          <Text style={s.muted}>Signed in as {accountLabel(user)}</Text>
          <Button label="Sign out" onPress={confirmSignOut} />
        </>
      )}
      {(!backendReady || user) && (
        <Button
          label={backendReady ? 'Delete account' : 'Delete all data'}
          kind="danger"
          onPress={confirmDelete}
        />
      )}
      {msg && <Text style={s.error}>{msg}</Text>}
    </Card>
  );
}

function NotificationRow() {
  const s = useStyles();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    notificationsAllowed().then(setAllowed, () => setAllowed(false));
  }, []);
  return (
    <View style={s.notifRow}>
      <Text style={s.rowTitle}>
        Notifications: {allowed == null ? '…' : allowed ? 'On' : 'Off'}
      </Text>
      <Button label="Settings" kind="ghost" onPress={() => void Linking.openSettings()} />
    </View>
  );
}

function NameRow() {
  const s = useStyles();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    getMyName().then(setName, (e: Error) => setMsg(e.message));
  }, []);
  const save = () =>
    setMyName(name).then(
      () => setMsg('Saved'),
      (e: Error) => setMsg(e.message),
    );
  return (
    <Card>
      <Label>Name shown on your invites</Label>
      <Field
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        accessibilityLabel="Your name"
      />
      <Button label="Save name" onPress={() => void save()} />
      {msg && <Text style={s.muted}>{msg}</Text>}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  h1: { fontSize: 34, fontWeight: '800', color: t.text, marginTop: 12 },
  muted: { fontSize: 13, color: t.muted },
  error: { fontSize: 14, color: t.danger },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  idName: { fontSize: 19, fontWeight: '700', color: t.text },
  gaugeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gauge: { fontSize: 40, fontWeight: '800', color: t.text, ...tabular },
  gaugeLabel: { fontSize: 15, fontWeight: '600', color: t.text },
  columns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  column: { flex: 1, backgroundColor: t.card, borderRadius: 12, padding: 10, gap: 2 },
  colValue: { fontSize: 22, fontWeight: '800', color: t.text, ...tabular },
  colLabel: { fontSize: 13, fontWeight: '600', color: t.text, ...tabular },
  streak: { fontSize: 32, fontWeight: '800', color: t.text, ...tabular },
  streakUnit: { fontSize: 15, fontWeight: '600', color: t.muted },
  dots: { flexDirection: 'row', gap: 8 },
  dotItem: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  quote: { fontSize: 14, fontStyle: 'italic', color: t.muted },
  rhythmHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rhythmName: { fontSize: 15, fontWeight: '600', color: t.text },
  rhythmValue: { fontSize: 15, fontWeight: '700', color: t.text, ...tabular },
  peak: { fontSize: 13, fontWeight: '600', color: t.successText },
  rowTitle: { fontSize: 15, fontWeight: '600', color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingVertical: 8, borderRadius: 999 },
  notifRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
