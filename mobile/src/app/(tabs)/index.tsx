import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Chip, formatTime, formatWhen, Progress, type Tone } from '../../components/ui';
import { deriveStatus, isTerminal, type AttemptLog, type Task } from '../../core/tasks';
import { notificationsAllowed } from '../../lib/notifications';
import { resolveTask, snoozeCheckin, useStore } from '../../lib/store';
import { glass, makeStyles, tabular } from '../../theme';

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function useNotificationsAllowed() {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    const check = () =>
      void notificationsAllowed()
        .then(setAllowed)
        .catch(() => setAllowed(false));
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);
  return allowed;
}

/** e.g. "EST · UTC−5": the timezone anchor from the design. */
function timezoneLabel(now: Date) {
  const name = new Intl.DateTimeFormat([], { timeZoneName: 'short' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value;
  const off = -now.getTimezoneOffset() / 60;
  const utc = `UTC${off >= 0 ? '+' : '−'}${Math.abs(off)}`;
  return name && !name.startsWith('GMT') ? `${name} · ${utc}` : utc;
}

const openCheckin = (id: string) => router.push({ pathname: '/task/[id]/checkin', params: { id } });
const openEdit = (id: string) => router.push({ pathname: '/task/[id]/edit', params: { id } });

function statusChip(
  t: Task,
  now: Date,
  lastLog: AttemptLog | undefined,
  isNext: boolean,
): [string, Tone] {
  if (t.status === 'completed')
    return lastLog?.outcome === 'completed_late'
      ? ['Completed late', 'success']
      : ['Completed on time', 'success'];
  if (t.status === 'failed') return ['Missed · recalibrated', 'missed'];
  const st = deriveStatus(t, now);
  if (st === 'checkin_pending') return ['Awaiting check-in', 'retry'];
  if (st === 'reminded') return ['In progress', 'primary'];
  return isNext ? ['Up next', 'primary'] : ['Scheduled', 'missed'];
}

export default function TodayHub() {
  const s = useStyles();
  const tasks = useStore((st) => st.tasks);
  const logs = useStore((st) => st.logs);
  const snoozes = useStore((st) => st.snoozes);
  const now = useNow();
  const allowed = useNotificationsAllowed();

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const inToday = (iso: string | null) => !!iso && new Date(iso) >= start && new Date(iso) <= end;
  const byTime = (a: Task, b: Task) => a.scheduled_at.localeCompare(b.scheduled_at);

  const active = tasks.filter((t) => !isTerminal(t)).sort(byTime);
  const pending = active.filter(
    (t) =>
      deriveStatus(t, now) === 'checkin_pending' &&
      !(snoozes[t.id] && new Date(snoozes[t.id]) > now),
  );
  const todayFeed = [
    ...active.filter((t) => new Date(t.scheduled_at) <= end),
    ...tasks.filter((t) => isTerminal(t) && (inToday(t.completed_at) || inToday(t.scheduled_at))),
  ].sort(byTime);
  const upcoming = active.filter((t) => new Date(t.scheduled_at) > end);

  const completed = todayFeed.filter((t) => t.status === 'completed').length;
  const inFlight = todayFeed.filter(
    (t) => !isTerminal(t) && deriveStatus(t, now) !== 'scheduled',
  ).length;
  const later = todayFeed.filter(
    (t) => !isTerminal(t) && deriveStatus(t, now) === 'scheduled',
  ).length;
  const velocity = todayFeed.length ? completed / todayFeed.length : 0;
  const nextId = active.find((t) => deriveStatus(t, now) === 'scheduled')?.id;
  const lastLog = (id: string) => logs.filter((l) => l.task_id === id).at(-1);

  const quickComplete = (t: Task) => {
    resolveTask(t.id, 'complete');
    router.push({ pathname: '/task/[id]/checkin', params: { id: t.id, done: '1' } });
  };

  const row = (t: Task, showDate = false) => {
    const terminal = isTerminal(t);
    const [label, tone] = statusChip(t, now, lastLog(t.id), t.id === nextId);
    const pendingNow = deriveStatus(t, now) === 'checkin_pending';
    const meta = [
      t.priority_tier === 'focus' && 'Focus',
      t.attempt_number > 1 && !terminal && `Attempt ${t.attempt_number}`,
      t.checkin_delay_mins != null && !terminal && `+${t.checkin_delay_mins}m check`,
    ].filter(Boolean);
    // Rail dot: accent = up next / in progress, amber = check-in waiting, grey = later, hollow = done.
    const dotStyle = terminal
      ? s.dotDone
      : tone === 'retry'
        ? s.dotPending
        : tone === 'primary'
          ? null
          : s.dotLater;
    return (
      <View key={t.id} style={s.feedRow}>
        <Text style={[s.feedTime, terminal && s.dim]}>
          {showDate ? formatWhen(t.scheduled_at).replace(/,? \d.*$/, '') + '\n' : ''}
          {formatTime(t.scheduled_at)}
        </Text>
        <View style={s.rail}>
          <View style={[s.dot, dotStyle]} />
          <View style={s.railLine} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.title}, ${formatTime(t.scheduled_at)}, ${label}`}
          disabled={terminal}
          onPress={() => (pendingNow ? openCheckin(t.id) : openEdit(t.id))}
          style={({ pressed }) => [s.feedCard, pressed && { opacity: 0.85 }]}
        >
          <Text style={[s.feedTitle, terminal && s.dim]} numberOfLines={2}>
            {t.title}
          </Text>
          <View style={s.metaRow}>
            <Chip label={label} tone={tone} />
            {meta.length > 0 && <Text style={s.meta}>{meta.join(' · ')}</Text>}
          </View>
          {!terminal && (
            <Button
              label="Done"
              kind="ghost"
              onPress={() => quickComplete(t)}
              style={s.doneBtn}
            />
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.brandRow}>
          <View style={s.brandMark} />
          <Text style={s.brand}>PulsePlan</Text>
        </View>

        <Text style={s.h1}>Today</Text>
        <Text style={s.date}>
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
          {timezoneLabel(now)}
        </Text>

        <Card style={{ marginTop: 12 }}>
          <View style={s.velocityRow}>
            <Text style={s.velocity}>{Math.round(velocity * 100)}%</Text>
            <Text style={s.velocityLabel}>Velocity</Text>
          </View>
          <Progress value={velocity} />
          <Text style={s.meta}>
            {completed} completed · {inFlight} active · {later} upcoming
          </Text>
        </Card>

        {!allowed && (
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openSettings()}
            style={s.notice}
          >
            <Text style={s.noticeText}>
              Notifications are off, so check-ins can’t reach you. Tap to open Settings.
            </Text>
          </Pressable>
        )}

        {pending.map((t) => (
          <CheckinCard key={t.id} task={t} now={now} />
        ))}

        <Text style={s.h2}>Today’s pacts</Text>
        {todayFeed.length === 0 && (
          <Text style={s.empty}>
            Nothing scheduled. Tap “New task” to make a pact with yourself.
          </Text>
        )}
        {todayFeed.map((t) => row(t))}

        {upcoming.length > 0 && <Text style={s.h2}>Upcoming</Text>}
        {upcoming.map((t) => row(t, true))}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New task"
        onPress={() => openEdit('new')}
        style={({ pressed }) => [s.fab, pressed && { transform: [{ scale: 0.96 }] }]}
      >
        <Text style={s.fabText}>New task</Text>
      </Pressable>
    </SafeAreaView>
  );
}

/** The active check-in: marked by the amber rail dot and an amber hairline, no animation. */
function CheckinCard({ task, now }: { task: Task; now: Date }) {
  const s = useStyles();
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(task.scheduled_at)) / 60_000));
  return (
    <View style={s.checkWrap} accessibilityLiveRegion="polite">
      <View style={s.checkCard}>
        <View style={s.metaRow}>
          <View style={s.ping} />
          <Text style={s.checkLabel}>{task.checkin_delay_mins ?? 30}-min check-in</Text>
        </View>
        <Text style={s.checkTitle}>Did you finish “{task.title}”?</Text>
        <Text style={[s.meta, tabular]}>
          Started {formatTime(task.scheduled_at)} · {mins} min ago
        </Text>
        <View style={s.checkActions}>
          <Button
            label="Check in"
            kind="primary"
            onPress={() => openCheckin(task.id)}
            style={{ flex: 1 }}
          />
          <Button label="Snooze 5m" onPress={() => snoozeCheckin(task.id)} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { fontSize: 16, fontWeight: '600', color: t.text },
  brandMark: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.primary },
  h1: { fontSize: 32, fontWeight: '600', color: t.text, marginTop: 12 },
  date: { fontSize: 15, color: t.muted, ...tabular },
  h2: { fontSize: 20, fontWeight: '600', color: t.text, marginTop: 16 },
  velocityRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  velocity: { fontSize: 40, fontWeight: '500', color: t.text, ...tabular },
  velocityLabel: { fontSize: 15, color: t.muted },
  meta: { fontSize: 14, color: t.muted, ...tabular },
  empty: { fontSize: 15, color: t.muted },
  dim: { color: t.muted },
  notice: { padding: 16, borderRadius: 12, backgroundColor: t.retrySoft, marginTop: 8 },
  noticeText: { fontSize: 15, fontWeight: '500', color: t.retryText },
  checkWrap: { marginTop: 8 },
  checkCard: {
    ...glass(t),
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.retry,
    padding: 16,
    gap: 8,
  },
  ping: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.retry },
  checkLabel: { fontSize: 14, fontWeight: '500', color: t.retryText },
  checkTitle: { fontSize: 18, fontWeight: '600', color: t.text },
  checkActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  feedRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  feedTime: {
    width: 64,
    fontSize: 13,
    fontWeight: '500',
    color: t.text,
    paddingTop: 16,
    ...tabular,
  },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.primary, marginTop: 20 },
  dotLater: { backgroundColor: t.inactive },
  dotDone: { backgroundColor: 'transparent', borderWidth: 2, borderColor: t.inactive },
  dotPending: { backgroundColor: t.retry },
  railLine: { flex: 1, width: 2, backgroundColor: t.inactive, marginTop: 4 },
  feedCard: {
    flex: 1,
    ...glass(t),
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    marginBottom: 8,
  },
  feedTitle: { fontSize: 17, fontWeight: '500', color: t.text },
  doneBtn: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 0, paddingVertical: 4 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: t.primary,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.16)',
  },
  fabText: { fontSize: 16, fontWeight: '600', color: t.onPrimary },
}));
