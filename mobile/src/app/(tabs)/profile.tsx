import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, colors } from '../../components/ui';
import { computeStats, TIME_WINDOWS, timeWindowStats } from '../../core/tasks';
import { notificationsAllowed } from '../../lib/notifications';
import { backendReady, getMyName, setMyName } from '../../lib/social';
import { accountLabel, deleteAccount, signOut, useAuthUser } from '../../lib/auth';
import { pendingSyncCount, setDefaultCheckinDelay, useStore } from '../../lib/store';

const DELAYS: { label: string; value: number | null }[] = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '60m', value: 60 },
  { label: 'Off', value: null },
];
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

export default function Profile() {
  const logs = useStore((s) => s.logs);
  const defaultDelay = useStore((s) => s.settings.defaultCheckinDelay);
  const stats = computeStats(logs);
  const { by, best } = timeWindowStats(logs);
  const total = stats.onTime + stats.late + stats.retried + stats.failed;

  const tiles = [
    { label: 'Completed on time', n: stats.onTime },
    { label: 'Completed late', n: stats.late },
    { label: 'Retried / rescheduled', n: stats.retried },
    { label: 'Missed', n: stats.failed },
  ];

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.privacy}>Only you can see these numbers.</Text>

      <View style={s.grid}>
        {tiles.map((t) => (
          <View
            key={t.label}
            style={s.tile}
            accessible
            accessibilityLabel={`${t.label}: ${t.n}, ${pct(t.n, total)} percent`}
          >
            <Text style={s.big}>{t.n}</Text>
            <Text style={s.tileLabel}>{t.label}</Text>
            <Text style={s.muted}>{pct(t.n, total)}% of attempts</Text>
          </View>
        ))}
        <View
          style={s.tile}
          accessible
          accessibilityLabel={`Current on-time streak: ${stats.streak}`}
        >
          <Text style={s.big}>{stats.streak}</Text>
          <Text style={s.tileLabel}>On-time streak</Text>
        </View>
        <View
          style={s.tile}
          accessible
          accessibilityLabel={`Best time window: ${best ?? 'not enough data yet'}`}
        >
          <Text style={[s.big, !best && { fontSize: 20 }]}>{best ?? '—'}</Text>
          <Text style={s.tileLabel}>Best time window</Text>
          {!best && <Text style={s.muted}>Needs 3+ tasks in a window</Text>}
        </View>
      </View>

      <Text style={s.h}>On-time rate by time of day</Text>
      <View style={s.card}>
        {TIME_WINDOWS.map((w) => {
          const { total: n, onTime } = by[w];
          const rate = pct(onTime, n);
          return (
            <View
              key={w}
              style={s.barRow}
              accessible
              accessibilityLabel={
                n ? `${w}: ${rate} percent on time across ${n} tasks` : `${w}: no tasks yet`
              }
            >
              <Text style={s.barLabel}>{w}</Text>
              <View style={s.track}>
                {n > 0 && rate > 0 && <View style={[s.bar, { width: `${rate}%` }]} />}
              </View>
              <Text style={s.barValue}>{n ? `${rate}% · ${n}` : 'No data'}</Text>
            </View>
          );
        })}
        <Text style={s.muted}>Based on when each task was scheduled. Retries are not counted.</Text>
      </View>

      <Text style={s.h}>Settings</Text>
      <View style={s.card}>
        <Text style={s.tileLabel}>Default check-in for new tasks</Text>
        <View style={s.chips}>
          {DELAYS.map((d) => (
            <Button
              key={d.label}
              label={d.label}
              selected={defaultDelay === d.value}
              onPress={() => setDefaultCheckinDelay(d.value)}
            />
          ))}
        </View>
      </View>
      <NotificationRow />
      {backendReady && <NameRow />}
      <AccountSection />
    </ScrollView>
  );
}

function AccountSection() {
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
    <View style={s.card}>
      <Text style={s.tileLabel}>Account</Text>
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
      {msg && <Text style={{ color: colors.danger }}>{msg}</Text>}
    </View>
  );
}

function NotificationRow() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    notificationsAllowed().then(setAllowed, () => setAllowed(false));
  }, []);
  return (
    <View style={s.card}>
      <Text style={s.tileLabel}>
        Notifications: {allowed == null ? '…' : allowed ? 'On' : 'Off'}
      </Text>
      <Button label="Open notification settings" onPress={() => void Linking.openSettings()} />
    </View>
  );
}

function NameRow() {
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
    <View style={s.card}>
      <Text style={s.tileLabel}>Name shown on your invites</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        accessibilityLabel="Your name"
        style={s.input}
      />
      <Button label="Save name" onPress={() => void save()} />
      {msg && <Text style={s.muted}>{msg}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16, gap: 10, paddingBottom: 40 },
  privacy: { color: colors.muted, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  big: { fontSize: 30, fontWeight: '700', color: colors.text },
  tileLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  h: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 14 },
  card: {
    padding: 14,
    gap: 10,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  barLabel: { width: 78, fontSize: 15, color: colors.text },
  track: { flex: 1, height: 12, justifyContent: 'center' },
  bar: {
    height: 12,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: colors.primary,
  },
  barValue: { width: 76, textAlign: 'right', fontSize: 14, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    fontSize: 16,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
});
