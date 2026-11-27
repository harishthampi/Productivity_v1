import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { isTerminal } from '../core/tasks';
import {
  ACTIONS,
  requestNotifications,
  resyncAllAlerts,
  setupNotifications,
} from '../lib/notifications';
import { backendReady, registerPushToken } from '../lib/social';
import { backdrop, useTheme } from '../theme';
import {
  allTasks,
  getSnoozes,
  getTask,
  reconcileExpired,
  resolveTask,
  syncNow,
} from '../lib/store';

const handled = new Set<string>();

function handleResponse(r: Notifications.NotificationResponse) {
  const key = `${r.notification.request.identifier}@${r.notification.date}:${r.actionIdentifier}`;
  if (handled.has(key)) return; // the listener and getLastNotificationResponseAsync can both report the same tap
  handled.add(key);
  void Notifications.clearLastNotificationResponseAsync().catch(() => {});

  const { taskId, stage, eventId } = (r.notification.request.content.data ?? {}) as {
    taskId?: string;
    stage?: string;
    eventId?: string;
  };
  if (eventId) return router.push({ pathname: '/event/[id]', params: { id: eventId } }); // server push
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
  await resyncAllAlerts(allTasks(), getSnoozes());
  void syncNow();
  if (backendReady) void registerPushToken();
}

export default function RootLayout() {
  const t = useTheme();
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: t.primary,
      background: t.bg,
      card: t.bg,
      text: t.text,
      border: t.border,
    },
  };
  useEffect(() => {
    if (Platform.OS === 'web') return; // the web build only serves the /e/:token RSVP page
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
    <ThemeProvider value={navTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ contentStyle: backdrop(t), headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]/edit" options={{ presentation: 'modal', title: 'Task' }} />
        <Stack.Screen
          name="task/[id]/checkin"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.92],
            sheetCornerRadius: 24,
          }}
        />
        <Stack.Screen name="event/new" options={{ presentation: 'modal', title: 'New Activity' }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
        <Stack.Screen name="squad/[id]" options={{ presentation: 'modal', title: 'Squad' }} />
        <Stack.Screen name="e/[token]" options={{ title: 'Invite' }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
