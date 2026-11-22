import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isTerminal, type Task } from '../core/tasks';

export const CHECKIN_CATEGORY = 'checkin';
export const ACTIONS = { complete: 'COMPLETE', retry: 'RETRY', miss: 'MISSED' } as const;
const CHANNEL = 'reminders';

// Deterministic ids, so edit/delete/resync can cancel without storing anything.
const ids = (taskId: string) => ({
  start: `${taskId}.start`,
  checkin: `${taskId}.checkin`,
  snooze: `${taskId}.snooze`,
});

export async function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Task reminders',
      // eslint-disable-next-line import/namespace -- re-exported via export *, the rule cannot follow it
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  // All actions open the app: background JS delivery from a killed app isn't documented for SDK 58.
  await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY, [
    {
      identifier: ACTIONS.complete,
      buttonTitle: 'Completed',
      options: { opensAppToForeground: true },
    },
    {
      identifier: ACTIONS.retry,
      buttonTitle: 'Retry Later',
      options: { opensAppToForeground: true },
    },
    {
      identifier: ACTIONS.miss,
      buttonTitle: 'Mark Missed',
      options: { opensAppToForeground: true, isDestructive: true },
    },
  ]);
}

export async function notificationsAllowed(): Promise<boolean> {
  const p = await Notifications.getPermissionsAsync();
  // eslint-disable-next-line import/namespace -- re-exported via export *, the rule cannot follow it
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function requestNotifications(): Promise<boolean> {
  if (await notificationsAllowed()) return true;
  const p = await Notifications.requestPermissionsAsync();
  return p.granted;
}

export async function cancelTaskAlerts(taskId: string) {
  const { start, checkin, snooze } = ids(taskId);
  await Promise.all(
    [start, checkin, snooze].map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
    ),
  );
}

const at = (iso: string) =>
  ({
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(iso),
    channelId: CHANNEL,
  }) as const;

/** Schedules Stage 1 (T) and Stage 2 (T + delay) upfront; OS background wake-ups can't be trusted. */
export async function scheduleTaskAlerts(task: Task, now = Date.now()) {
  await cancelTaskAlerts(task.id); // identifier reuse isn't documented to replace, so cancel first
  if (isTerminal(task)) return;
  const { start, checkin } = ids(task.id);
  try {
    if (Date.parse(task.scheduled_at) > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: start,
        content: {
          title: `Time to start: ${task.title}`,
          data: { taskId: task.id, stage: 'start' },
        },
        trigger: at(task.scheduled_at),
      });
    }
    if (task.checkin_due_at && Date.parse(task.checkin_due_at) > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: checkin,
        content: {
          title: `${task.checkin_delay_mins} mins since "${task.title}" started`,
          body: 'Did you complete it?',
          categoryIdentifier: CHECKIN_CATEGORY,
          data: { taskId: task.id, stage: 'checkin' },
        },
        trigger: at(task.checkin_due_at),
      });
    }
  } catch (e) {
    console.warn('Could not schedule reminders', e); // e.g. permission revoked; the in-app banner covers it
  }
}

/** One extra check-in alert after "Snooze 5m". */
export async function scheduleSnoozeAlert(task: Task, atIso: string) {
  if (isTerminal(task) || Date.parse(atIso) <= Date.now()) return;
  await Notifications.cancelScheduledNotificationAsync(ids(task.id).snooze).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: ids(task.id).snooze,
    content: {
      title: `Checking back in: "${task.title}"`,
      body: 'Did you complete it?',
      categoryIdentifier: CHECKIN_CATEGORY,
      data: { taskId: task.id, stage: 'checkin' },
    },
    trigger: at(atIso),
  }).catch((e) => console.warn('Could not schedule snooze', e));
}

/** Clears everything and reschedules from local state: removes ghost alerts and survives timezone changes. */
// shortcut: iOS keeps only 64 pending local notifications (32 tasks); schedule nearest-first if users exceed that.
export async function resyncAllAlerts(tasks: Task[], snoozes: Record<string, string> = {}) {
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  const upcoming = tasks
    .filter((t) => !isTerminal(t))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  for (const t of upcoming) await scheduleTaskAlerts(t);
  for (const t of upcoming) if (snoozes[t.id]) await scheduleSnoozeAlert(t, snoozes[t.id]);
}
