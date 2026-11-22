import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { colors } from '../components/ui';
import { isTerminal } from '../core/tasks';
import {
  ACTIONS,
  requestNotifications,
  resyncAllAlerts,
  setupNotifications,
} from '../lib/notifications';
import { allTasks, getTask, reconcileExpired, resolveTask, syncNow } from '../lib/store';

const handled = new Set<string>();

function handleResponse(r: Notifications.NotificationResponse) {
  const key = `${r.notification.request.identifier}@${r.notification.date}:${r.actionIdentifier}`;
  if (handled.has(key)) return; // the listener and getLastNotificationResponseAsync can both report the same tap
  handled.add(key);
  void Notifications.clearLastNotificationResponseAsync().catch(() => {});

  const { taskId, stage } = (r.notification.request.content.data ?? {}) as {
    taskId?: string;
    stage?: string;
  };
  const task = taskId ? getTask(taskId) : undefined;
  if (!task || stage !== 'checkin') return; // start-reminder taps just open the Today hub

  const action = r.actionIdentifier;
  if (action === ACTIONS.complete || action === ACTIONS.miss) {
    if (!isTerminal(task)) resolveTask(task.id, action === ACTIONS.complete ? 'complete' : 'miss');
    router.push({ pathname: '/task/[id]/checkin', params: { id: task.id, done: '1' } });
  } else {
    router.push({
      pathname: '/task/[id]/checkin',
      params: { id: task.id, retry: action === ACTIONS.retry ? '1' : '' },
    });
  }
}

// Order matters: apply a pending notification answer before auto-failing expired check-ins.
async function onForeground() {
  const r = await Notifications.getLastNotificationResponseAsync().catch(() => null);
  if (r) handleResponse(r);
  reconcileExpired();
  await resyncAllAlerts(allTasks());
  void syncNow();
}

export default function RootLayout() {
  useEffect(() => {
    void (async () => {
      await setupNotifications().catch((e) => console.warn('Notification setup failed', e));
      await requestNotifications().catch(() => false);
      await onForeground();
    })();
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void onForeground();
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ title: 'Today' }} />
        <Stack.Screen name="task/[id]/edit" options={{ presentation: 'modal', title: 'Task' }} />
        <Stack.Screen
          name="task/[id]/checkin"
          options={{ presentation: 'modal', title: 'Check-in' }}
        />
      </Stack>
    </>
  );
}
