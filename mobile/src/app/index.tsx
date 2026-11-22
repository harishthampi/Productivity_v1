import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, colors, formatTime, formatWhen } from '../components/ui';
import { deriveStatus, isTerminal, type Task, type TaskStatus } from '../core/tasks';
import { notificationsAllowed } from '../lib/notifications';
import { resolveTask, useStore } from '../lib/store';

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

const STATUS_LABEL: Record<TaskStatus, string> = {
  scheduled: 'Scheduled',
  reminded: 'In progress',
  checkin_pending: 'Check-in due',
  completed: 'Completed',
  retried: 'Retried',
  failed: 'Missed',
  cancelled: 'Cancelled',
};

const openCheckin = (id: string) => router.push({ pathname: '/task/[id]/checkin', params: { id } });
const openEdit = (id: string) => router.push({ pathname: '/task/[id]/edit', params: { id } });

export default function TodayHub() {
  const tasks = useStore((s) => s.tasks);
  const now = useNow();
  const allowed = useNotificationsAllowed();

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const isToday = (iso: string | null) =>
    !!iso && new Date(iso) >= startOfToday && new Date(iso) <= endOfToday;

  const byTime = (a: Task, b: Task) => a.scheduled_at.localeCompare(b.scheduled_at);
  const active = tasks.filter((t) => !isTerminal(t)).sort(byTime);
  const pending = active.filter((t) => deriveStatus(t, now) === 'checkin_pending');
  const today = active.filter(
    (t) => !pending.includes(t) && new Date(t.scheduled_at) <= endOfToday,
  );
  const upcoming = active.filter((t) => new Date(t.scheduled_at) > endOfToday);
  const doneToday = tasks.filter(
    (t) => isTerminal(t) && (isToday(t.completed_at) || isToday(t.scheduled_at)),
  );

  const quickComplete = (t: Task) => {
    resolveTask(t.id, 'complete');
    router.push({ pathname: '/task/[id]/checkin', params: { id: t.id, done: '1' } });
  };

  const row = (t: Task, showDate = false) => {
    const status = deriveStatus(t, now);
    const terminal = isTerminal(t);
    return (
      <Pressable
        key={t.id}
        accessibilityRole="button"
        accessibilityLabel={`${t.title}, ${STATUS_LABEL[status]}`}
        disabled={terminal}
        onPress={() => (status === 'checkin_pending' ? openCheckin(t.id) : openEdit(t.id))}
        style={s.row}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.rowTitle, terminal && s.muted]}>
            {t.priority_tier === 'focus' ? '★ ' : ''}
            {t.title}
          </Text>
          <Text style={s.muted}>
            {showDate ? formatWhen(t.scheduled_at) : formatTime(t.scheduled_at)} ·{' '}
            {STATUS_LABEL[status]}
            {t.attempt_number > 1 ? ` · attempt ${t.attempt_number}` : ''}
          </Text>
        </View>
        {!terminal && <Button label="Done" onPress={() => quickComplete(t)} />}
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button label="+ Add Task" kind="primary" onPress={() => openEdit('new')} />
          ),
        }}
      />
      <ScrollView contentContainerStyle={s.content}>
        {!allowed && (
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openSettings()}
            style={[s.banner, { backgroundColor: colors.warn }]}
          >
            <Text style={s.bannerText}>
              Notifications are off, so reminders won’t fire. Tap to open Settings.
            </Text>
          </Pressable>
        )}

        {pending.map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            onPress={() => openCheckin(t.id)}
            style={s.banner}
          >
            <Text style={[s.bannerText, { color: '#fff' }]}>
              Check-in: did you finish “{t.title}”?
            </Text>
          </Pressable>
        ))}

        <Text style={s.h}>Today</Text>
        {today.length === 0 && pending.length === 0 && (
          <Text style={s.muted}>Nothing scheduled. Add a task to get started.</Text>
        )}
        {today.map((t) => row(t))}

        {upcoming.length > 0 && <Text style={s.h}>Upcoming</Text>}
        {upcoming.map((t) => row(t, true))}

        {doneToday.length > 0 && <Text style={s.h}>Resolved today</Text>}
        {doneToday.map((t) => row(t))}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  h: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  banner: { padding: 14, borderRadius: 14, backgroundColor: colors.primary },
  bannerText: { fontSize: 16, fontWeight: '600', color: colors.text },
});
