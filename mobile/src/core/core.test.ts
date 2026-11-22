import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats,
  createTask,
  deriveStatus,
  editTask,
  isExpired,
  resolveCheckin,
  retryPresets,
  timeWindowStats,
  windowOf,
  type AttemptLog,
} from './tasks.ts';
import { enqueue, flush, type Mutation } from './queue.ts';

const T = new Date('2026-11-22T15:00:00Z');
const at = (mins: number) => new Date(T.getTime() + mins * 60_000);
const make = (delay?: number | null) =>
  createTask(
    { title: ' Submit Report ', scheduled_at: T, checkin_delay_mins: delay },
    'task-1',
    at(-60),
  );

test('createTask validates and defaults to a 30 min check-in', () => {
  const t = make();
  assert.equal(t.title, 'Submit Report');
  assert.equal(t.checkin_delay_mins, 30);
  assert.equal(t.checkin_due_at, '2026-11-22T15:30:00.000Z');
  assert.equal(make(null).checkin_due_at, null);
  assert.throws(() => createTask({ title: '  ', scheduled_at: T }, 'x', T), /Title/);
  assert.throws(
    () => createTask({ title: 'a', scheduled_at: new Date('nope') }, 'x', T),
    /valid date/,
  );
});

test('status follows the clock: scheduled → reminded → checkin_pending → expired', () => {
  const t = make();
  assert.equal(deriveStatus(t, at(-1)), 'scheduled');
  assert.equal(deriveStatus(t, at(10)), 'reminded');
  assert.equal(deriveStatus(t, at(30)), 'checkin_pending');
  assert.equal(isExpired(t, at(90)), false);
  assert.equal(isExpired(t, at(91)), true);
  assert.equal(deriveStatus(make(null), at(500)), 'reminded'); // check-in Off never goes pending
  assert.equal(isExpired(make(null), at(5000)), false);
});

test('TC-02 complete within grace is on time; after grace is late', () => {
  const { task, log } = resolveCheckin(make(), 'complete', at(31), 'k1');
  assert.equal(task.status, 'completed');
  assert.equal(task.completed_at, at(31).toISOString());
  assert.equal(log.outcome, 'completed_on_time');
  assert.equal(log.checkin_prompted_at, '2026-11-22T15:30:00.000Z');
  assert.equal(resolveCheckin(make(), 'complete', at(95), 'k2').log.outcome, 'completed_late');
  assert.throws(() => resolveCheckin(task, 'complete', at(32), 'k3'), /already resolved/);
});

test('TC-03 retry logs attempt 1 and reschedules attempt 2', () => {
  const r = resolveCheckin(make(), 'retry', at(31), 'k1', at(240));
  assert.equal(r.log.outcome, 'retried');
  assert.equal(r.log.attempt_number, 1);
  assert.equal(r.log.retry_target_at, at(240).toISOString());
  assert.equal(r.task.attempt_number, 2);
  assert.equal(r.task.status, 'scheduled');
  assert.equal(r.task.checkin_due_at, at(270).toISOString());
  assert.throws(() => resolveCheckin(make(), 'retry', at(31), 'k', at(30)), /future/);
  const done = resolveCheckin(r.task, 'complete', at(271), 'k2');
  assert.equal(done.log.attempt_number, 2);
  assert.equal(done.log.outcome, 'completed_on_time');
});

test('TC-04 miss marks failed', () => {
  const r = resolveCheckin(make(), 'miss', at(91), 'k1');
  assert.equal(r.task.status, 'failed');
  assert.equal(r.log.outcome, 'failed_missed');
});

test('editTask recomputes due time and refuses finished tasks', () => {
  const t = editTask(make(), { title: 'New', scheduled_at: at(60), checkin_delay_mins: 15 });
  assert.equal(t.checkin_due_at, at(75).toISOString());
  const done = resolveCheckin(make(), 'complete', at(31), 'k').task;
  assert.throws(() => editTask(done, { title: 'x', scheduled_at: T }), /cannot be edited/);
});

test('retry presets are in the future, tomorrow is 10:00 local', () => {
  const p = retryPresets(T);
  assert.ok(p.every((x) => x.at > T));
  assert.equal(p[2].at.getHours(), 10);
});

test('stats count outcomes; streak counts latest on-time finals, skipping retries', () => {
  const log = (outcome: AttemptLog['outcome'], mins: number) =>
    ({ outcome, resolved_at: at(mins).toISOString() }) as AttemptLog;
  const s = computeStats([
    log('failed_missed', 1),
    log('completed_on_time', 2),
    log('retried', 3),
    log('completed_on_time', 4),
  ]);
  assert.deepEqual(s, { onTime: 2, late: 0, retried: 1, failed: 1, streak: 2 });
});

test('queue dedupes by key and stops at first failure, preserving order', async () => {
  const m = (key: string): Mutation => ({ key, op: 'delete_task', payload: { id: key } });
  let q = enqueue(enqueue(enqueue([], m('a')), m('a')), m('b'));
  q = enqueue(q, m('c'));
  assert.equal(q.length, 3);
  const sent: string[] = [];
  const left = await flush(q, async (x) => {
    if (x.key === 'b') throw new Error('offline');
    sent.push(x.key);
  });
  assert.deepEqual(sent, ['a']);
  assert.deepEqual(
    left.map((x) => x.key),
    ['b', 'c'],
  );
  assert.deepEqual(await flush(left, async () => {}), []);
});

test('time windows: local-hour buckets, retries skipped, best needs 3+ samples', () => {
  const at = (h: number, outcome: AttemptLog['outcome']) =>
    ({ outcome, scheduled_at: new Date(2026, 10, 22, h).toISOString() }) as AttemptLog;
  assert.equal(windowOf(new Date(2026, 10, 22, 4).toISOString()), 'Evening');
  assert.equal(windowOf(new Date(2026, 10, 22, 5).toISOString()), 'Morning');
  assert.equal(windowOf(new Date(2026, 10, 22, 12).toISOString()), 'Afternoon');
  assert.equal(windowOf(new Date(2026, 10, 22, 17).toISOString()), 'Evening');
  const logs = [
    at(9, 'completed_on_time'),
    at(10, 'failed_missed'),
    at(11, 'completed_on_time'),
    at(9, 'retried'),
    at(14, 'completed_on_time'),
    at(15, 'completed_on_time'), // 100% but only 2 samples
    at(19, 'failed_missed'),
    at(20, 'completed_late'),
    at(21, 'completed_on_time'),
  ];
  const { by, best } = timeWindowStats(logs);
  assert.deepEqual(by.Morning, { total: 3, onTime: 2 });
  assert.deepEqual(by.Afternoon, { total: 2, onTime: 2 });
  assert.equal(best, 'Morning');
  assert.equal(timeWindowStats([]).best, null);
});
