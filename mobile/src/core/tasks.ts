// Pure task state machine. No RN imports so `node --test` can run it. Timestamps are ISO-8601 UTC strings.

export type PriorityTier = 'focus' | 'standard';
// Stored statuses. 'reminded' / 'checkin_pending' are derived from the clock (see deriveStatus), never stored.
export type TaskStatus =
  'scheduled' | 'reminded' | 'checkin_pending' | 'completed' | 'retried' | 'failed' | 'cancelled';
export type Outcome = 'completed_on_time' | 'completed_late' | 'retried' | 'failed_missed';
export type CheckinAction = 'complete' | 'retry' | 'miss';

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  priority_tier: PriorityTier;
  scheduled_at: string;
  checkin_delay_mins: number | null; // null = check-in Off
  checkin_due_at: string | null;
  status: TaskStatus;
  attempt_number: number;
  parent_task_id: string | null;
  completed_at: string | null;
  created_at: string;
};

export type AttemptLog = {
  id: string;
  task_id: string;
  attempt_number: number;
  scheduled_at: string;
  checkin_prompted_at: string | null;
  resolved_at: string;
  outcome: Outcome;
  retry_target_at: string | null;
  idempotency_key: string;
};

export type TaskInput = {
  title: string;
  notes?: string | null;
  scheduled_at: Date;
  checkin_delay_mins?: number | null;
  priority_tier?: PriorityTier;
};

export const DEFAULT_CHECKIN_DELAY_MINS = 30;
// After the check-in fires, the user has this long before the attempt auto-fails. Also the on-time cutoff.
export const CHECKIN_GRACE_MINS = 60;

const MIN = 60_000;
const ms = (iso: string) => Date.parse(iso);
const addMins = (iso: string, mins: number) => new Date(ms(iso) + mins * MIN).toISOString();
const TERMINAL: TaskStatus[] = ['completed', 'failed', 'cancelled'];

export const isTerminal = (t: Task) => TERMINAL.includes(t.status);

function validate(input: Pick<TaskInput, 'title' | 'scheduled_at' | 'checkin_delay_mins'>) {
  if (!input.title.trim()) throw new Error('Title is required');
  if (!(input.scheduled_at instanceof Date) || Number.isNaN(input.scheduled_at.getTime()))
    throw new Error('Pick a valid date and time');
  const d = input.checkin_delay_mins;
  if (d != null && !(Number.isInteger(d) && d >= 1 && d <= 1440))
    throw new Error('Invalid check-in delay');
}

const dueFor = (scheduled_at: string, delay: number | null) =>
  delay == null ? null : addMins(scheduled_at, delay);

export function createTask(input: TaskInput, id: string, now: Date): Task {
  validate(input);
  const scheduled_at = input.scheduled_at.toISOString();
  const delay =
    input.checkin_delay_mins === undefined ? DEFAULT_CHECKIN_DELAY_MINS : input.checkin_delay_mins;
  return {
    id,
    title: input.title.trim(),
    notes: input.notes?.trim() || null,
    priority_tier: input.priority_tier ?? 'standard',
    scheduled_at,
    checkin_delay_mins: delay,
    checkin_due_at: dueFor(scheduled_at, delay),
    status: 'scheduled',
    attempt_number: 1,
    parent_task_id: null,
    completed_at: null,
    created_at: now.toISOString(),
  };
}

export function editTask(task: Task, input: TaskInput): Task {
  if (isTerminal(task)) throw new Error('Finished tasks cannot be edited');
  validate(input);
  const scheduled_at = input.scheduled_at.toISOString();
  const delay =
    input.checkin_delay_mins === undefined ? task.checkin_delay_mins : input.checkin_delay_mins;
  return {
    ...task,
    title: input.title.trim(),
    notes: input.notes?.trim() || null,
    priority_tier: input.priority_tier ?? task.priority_tier,
    scheduled_at,
    checkin_delay_mins: delay,
    checkin_due_at: dueFor(scheduled_at, delay),
  };
}

export function deriveStatus(task: Task, now: Date): TaskStatus {
  if (isTerminal(task)) return task.status;
  const t = now.getTime();
  if (t < ms(task.scheduled_at)) return 'scheduled';
  if (task.checkin_due_at == null || t < ms(task.checkin_due_at)) return 'reminded';
  return 'checkin_pending';
}

/** True once the check-in window has passed without a resolution, so the attempt should auto-fail. */
export const isExpired = (task: Task, now: Date) =>
  !isTerminal(task) &&
  task.checkin_due_at != null &&
  now.getTime() > ms(task.checkin_due_at) + CHECKIN_GRACE_MINS * MIN;

export function resolveCheckin(
  task: Task,
  action: CheckinAction,
  now: Date,
  idempotencyKey: string,
  retryAt?: Date,
): { task: Task; log: AttemptLog } {
  if (isTerminal(task)) throw new Error('Task is already resolved');
  const nowIso = now.toISOString();
  const cutoff = ms(task.checkin_due_at ?? task.scheduled_at) + CHECKIN_GRACE_MINS * MIN;
  let outcome: Outcome;
  let next: Task;
  let retry_target_at: string | null = null;

  if (action === 'complete') {
    outcome = now.getTime() <= cutoff ? 'completed_on_time' : 'completed_late';
    next = { ...task, status: 'completed', completed_at: nowIso };
  } else if (action === 'miss') {
    outcome = 'failed_missed';
    next = { ...task, status: 'failed' };
  } else {
    if (!retryAt || Number.isNaN(retryAt.getTime()) || retryAt.getTime() <= now.getTime())
      throw new Error('Pick a retry time in the future');
    outcome = 'retried';
    retry_target_at = retryAt.toISOString();
    // The retried attempt lives in the log; the task row itself starts the next attempt.
    next = {
      ...task,
      status: 'scheduled',
      attempt_number: task.attempt_number + 1,
      scheduled_at: retry_target_at,
      checkin_due_at: dueFor(retry_target_at, task.checkin_delay_mins),
    };
  }

  const prompted =
    task.checkin_due_at && ms(task.checkin_due_at) <= now.getTime() ? task.checkin_due_at : null;
  return {
    task: next,
    log: {
      id: idempotencyKey,
      task_id: task.id,
      attempt_number: task.attempt_number,
      scheduled_at: task.scheduled_at,
      checkin_prompted_at: prompted,
      resolved_at: nowIso,
      outcome,
      retry_target_at,
      idempotency_key: idempotencyKey,
    },
  };
}

/** Quick retry slots: +1h, +3h, tomorrow 10:00 in device-local time (setHours keeps DST correct). */
export function retryPresets(now: Date): { label: string; at: Date }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return [
    { label: '+1 hr', at: new Date(now.getTime() + 60 * MIN) },
    { label: '+3 hrs', at: new Date(now.getTime() + 180 * MIN) },
    { label: 'Tomorrow 10:00 AM', at: tomorrow },
  ];
}

export type Stats = {
  onTime: number;
  late: number;
  retried: number;
  failed: number;
  streak: number;
};

export function computeStats(logs: AttemptLog[]): Stats {
  const s: Stats = { onTime: 0, late: 0, retried: 0, failed: 0, streak: 0 };
  for (const l of logs) {
    if (l.outcome === 'completed_on_time') s.onTime++;
    else if (l.outcome === 'completed_late') s.late++;
    else if (l.outcome === 'retried') s.retried++;
    else s.failed++;
  }
  // Streak = most recent final outcomes that were on time; retries neither extend nor break it.
  const finals = logs
    .filter((l) => l.outcome !== 'retried')
    .sort((a, b) => ms(b.resolved_at) - ms(a.resolved_at));
  for (const l of finals) {
    if (l.outcome !== 'completed_on_time') break;
    s.streak++;
  }
  return s;
}

export type TimeWindow = 'Morning' | 'Afternoon' | 'Evening';
export const TIME_WINDOWS: TimeWindow[] = ['Morning', 'Afternoon', 'Evening'];
// Device-local hour of the attempt's start time. Night (before 5am) folds into Evening.
export const windowOf = (iso: string): TimeWindow => {
  const h = new Date(iso).getHours();
  return h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : 'Evening';
};
const MIN_SAMPLE = 3; // don't crown a "best" window from one or two tasks

/** On-time rate per time window over final outcomes (retries skipped), plus the best window once there's enough data. */
export function timeWindowStats(logs: AttemptLog[]) {
  const by = Object.fromEntries(TIME_WINDOWS.map((w) => [w, { total: 0, onTime: 0 }])) as Record<
    TimeWindow,
    { total: number; onTime: number }
  >;
  for (const l of logs) {
    if (l.outcome === 'retried') continue;
    const w = by[windowOf(l.scheduled_at)];
    w.total++;
    if (l.outcome === 'completed_on_time') w.onTime++;
  }
  let best: TimeWindow | null = null;
  for (const w of TIME_WINDOWS) {
    const rate = (x: TimeWindow) => by[x].onTime / by[x].total;
    if (by[w].total >= MIN_SAMPLE && (best === null || rate(w) > rate(best))) best = w;
  }
  return { by, best };
}
