import 'expo-sqlite/localStorage/install';
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import {
  computeStats,
  createTask,
  DEFAULT_CHECKIN_DELAY_MINS,
  editTask,
  isExpired,
  mergeServerData,
  rekeyLocalData,
  resolveCheckin,
  type AttemptLog,
  type CheckinAction,
  type Task,
  type TaskInput,
} from '../core/tasks';
import { enqueue, flush, type Mutation } from '../core/queue';
import { cancelTaskAlerts, scheduleSnoozeAlert, scheduleTaskAlerts } from './notifications';
import { send } from './sync';

type Settings = { defaultCheckinDelay: number | null; onboarded?: boolean };
// snoozes: taskId → ISO time the check-in card reappears. Local-only, never synced.
type State = {
  tasks: Task[];
  logs: AttemptLog[];
  queue: Mutation[];
  settings: Settings;
  snoozes: Record<string, string>;
};
const KEY = 'pulseplan.state.v1';
const EMPTY: State = {
  tasks: [],
  logs: [],
  queue: [],
  snoozes: {},
  settings: { defaultCheckinDelay: DEFAULT_CHECKIN_DELAY_MINS },
};

function load(): State {
  const raw = globalThis.localStorage.getItem(KEY);
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    globalThis.localStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw); // keep it rather than overwrite user data
    return EMPTY;
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  globalThis.localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useStore = <T>(select: (s: State) => T): T =>
  useSyncExternalStore(subscribe, () => select(state));
export const getTask = (id: string) => state.tasks.find((t) => t.id === id);
export const getStats = () => computeStats(state.logs);
export const getSettings = () => state.settings;
export const pendingSyncCount = () => state.queue.length;
export const getSnoozes = () => state.snoozes;

/** Hides the check-in card and re-alerts in `mins`. The grace window (auto-miss) is unchanged. */
export function snoozeCheckin(id: string, mins = 5) {
  const task = getTask(id);
  if (!task) return;
  const until = new Date(Date.now() + mins * 60_000).toISOString();
  set({ ...state, snoozes: { ...state.snoozes, [id]: until } });
  void scheduleSnoozeAlert(task, until);
}
export const setDefaultCheckinDelay = (mins: number | null) =>
  set({ ...state, settings: { ...state.settings, defaultCheckinDelay: mins } });

const uuid = () => Crypto.randomUUID();
const upsertTask = (t: Task): Mutation => ({ key: uuid(), op: 'upsert_task', payload: t });
const insertLog = (l: AttemptLog): Mutation => ({
  key: l.idempotency_key,
  op: 'insert_log',
  payload: l,
});
export const setOnboarded = () =>
  set({ ...state, settings: { ...state.settings, onboarded: true } });

/** Sign-out / account deletion: forget everything on this device. The next person starts at the welcome screen. */
export const wipeLocal = () => set({ ...EMPTY, settings: { ...EMPTY.settings } });

/** Switched to a different account: new ids (old ones belong to the previous account) and a full re-upload. */
export function adoptForNewAccount() {
  const { tasks, logs } = rekeyLocalData(state.tasks, state.logs, uuid);
  let queue: Mutation[] = [];
  for (const t of tasks) queue = enqueue(queue, upsertTask(t));
  for (const l of logs) queue = enqueue(queue, insertLog(l));
  set({ ...state, tasks, logs, queue });
}

export const mergeFromServer = (server: { tasks: Task[]; logs: AttemptLog[] }) =>
  set({ ...state, ...mergeServerData(state, server) });

const replace = (tasks: Task[], t: Task) => tasks.map((x) => (x.id === t.id ? t : x));

export function addTask(input: TaskInput): Task {
  const task = createTask(input, uuid(), new Date());
  set({ ...state, tasks: [...state.tasks, task], queue: enqueue(state.queue, upsertTask(task)) });
  void scheduleTaskAlerts(task);
  void syncNow();
  return task;
}

export function updateTask(id: string, input: TaskInput): Task {
  const old = getTask(id);
  if (!old) throw new Error('Task not found');
  const task = editTask(old, input);
  set({
    ...state,
    tasks: replace(state.tasks, task),
    queue: enqueue(state.queue, upsertTask(task)),
  });
  void scheduleTaskAlerts(task);
  void syncNow();
  return task;
}

export function deleteTask(id: string) {
  set({
    ...state,
    tasks: state.tasks.filter((t) => t.id !== id),
    logs: state.logs.filter((l) => l.task_id !== id), // matches the server's on delete cascade
    queue: enqueue(state.queue, { key: uuid(), op: 'delete_task', payload: { id } }),
  });
  void cancelTaskAlerts(id);
  void syncNow();
}

/** Resolves the current attempt. The idempotency key is generated once here, so a replayed sync can't double-count. */
export function resolveTask(id: string, action: CheckinAction, retryAt?: Date) {
  const old = getTask(id);
  if (!old) throw new Error('Task not found');
  const { task, log } = resolveCheckin(old, action, new Date(), uuid(), retryAt);
  set({
    ...state,
    tasks: replace(state.tasks, task),
    logs: [...state.logs, log],
    queue: enqueue(enqueue(state.queue, upsertTask(task)), insertLog(log)),
  });
  void scheduleTaskAlerts(task); // terminal → cancels; retry → schedules the new T and T+delay
  void syncNow();
  return { task, log };
}

/** Auto-fails attempts whose check-in window passed while the app was closed. */
export function reconcileExpired(now = new Date()) {
  for (const t of state.tasks.filter((x) => isExpired(x, now))) resolveTask(t.id, 'miss');
}

let syncing = false;
export async function syncNow() {
  if (syncing || state.queue.length === 0) return;
  syncing = true;
  try {
    const snapshot = state.queue;
    const left = await flush(snapshot, send);
    const sent = new Set(snapshot.slice(0, snapshot.length - left.length).map((m) => m.key));
    if (sent.size) set({ ...state, queue: state.queue.filter((m) => !sent.has(m.key)) });
  } finally {
    syncing = false;
  }
}

export const allTasks = () => state.tasks;
