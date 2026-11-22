// RLS + token RPC tests against real Postgres (PGlite/WASM), with a minimal stand-in for Supabase's auth schema.
// shortcut: stubbed auth.uid()/roles, not the real Supabase stack; also run against `supabase start` once Docker is available.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const OWNER = '00000000-0000-0000-0000-00000000000a';
const FRIEND = '00000000-0000-0000-0000-00000000000b';
const BENCH = '00000000-0000-0000-0000-00000000000c';
const STRANGER = '00000000-0000-0000-0000-00000000000d';

let db;
let eventId, friendToken, benchToken;

const as = (uid, fn) =>
  db.transaction(async (tx) => {
    await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
const rows = async (uid, sql, params) => (await as(uid, (tx) => tx.query(sql, params))).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
  `);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  // Supabase's default grants; RLS is what actually restricts access.
  await db.exec(`grant all on all tables in schema public to anon, authenticated;`);

  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values
     ($1, '{"display_name":"Owner"}'), ($2, '{}'), ($3, '{}'), ($4, '{}')`,
    [OWNER, FRIEND, BENCH, STRANGER],
  );
  eventId = (
    await db.query(
      `insert into events (owner_id, title, scheduled_at, event_timezone, max_spots)
       values ($1, 'Badminton Doubles', '2026-11-22T15:00Z', 'America/Toronto', 4) returning id`,
      [OWNER],
    )
  ).rows[0].id;
  const inv = await db.query(
    `insert into event_invites (event_id, invitee_user_id, invitee_display_name, invitee_contact_ref, tier, rsvp_status)
     values ($1, $2, 'Friend', '+15550001', 'primary', 'invited'),
            ($1, $3, 'Benchy', '+15550002', 'bench', 'bench')
     returning invite_token`,
    [eventId, FRIEND, BENCH],
  );
  [friendToken, benchToken] = inv.rows.map((r) => r.invite_token);
});

test('auth signup creates a public.users profile', async () => {
  const r = await rows(OWNER, `select display_name from users`);
  assert.deepEqual(r, [{ display_name: 'Owner' }]);
});

test('solo tasks and logs are owner-only', async () => {
  const [task] = await rows(
    OWNER,
    `insert into tasks (title, scheduled_at) values ('Submit Report', '2026-11-22T15:00Z') returning id, checkin_due_at`,
  );
  assert.equal(task.checkin_due_at.toISOString(), '2026-11-22T15:30:00.000Z');
  await rows(
    OWNER,
    `insert into task_attempt_logs (task_id, attempt_number, scheduled_at, outcome, idempotency_key)
     values ($1, 1, '2026-11-22T15:00Z', 'completed_on_time', '11111111-1111-1111-1111-111111111111')`,
    [task.id],
  );
  assert.equal((await rows(FRIEND, `select * from tasks`)).length, 0);
  assert.equal((await rows(FRIEND, `select * from task_attempt_logs`)).length, 0);
  assert.equal((await rows(null, `select * from tasks`)).length, 0);
  // Friend cannot plant a log on someone else's task.
  await assert.rejects(
    rows(
      FRIEND,
      `insert into task_attempt_logs (task_id, attempt_number, scheduled_at, outcome, idempotency_key)
       values ($1, 1, now(), 'failed_missed', gen_random_uuid())`,
      [task.id],
    ),
    /row-level security/,
  );
});

test('replayed idempotency_key does not double-log', async () => {
  const [t] = await rows(OWNER, `insert into tasks (title, scheduled_at) values ('x', now()) returning id`);
  const ins = `insert into task_attempt_logs (task_id, attempt_number, scheduled_at, outcome, idempotency_key)
               values ($1, 1, now(), 'completed_on_time', '22222222-2222-2222-2222-222222222222')
               on conflict (idempotency_key) do nothing returning id`;
  assert.equal((await rows(OWNER, ins, [t.id])).length, 1);
  assert.equal((await rows(OWNER, ins, [t.id])).length, 0);
});

test('task title cannot be blank', async () => {
  await assert.rejects(rows(OWNER, `insert into tasks (title, scheduled_at) values ('  ', now())`), /check/);
});

test('TC-05: only active invitees see the event; bench and strangers do not', async () => {
  assert.equal((await rows(FRIEND, `select id from events`)).length, 1);
  assert.equal((await rows(BENCH, `select id from events`)).length, 0);
  assert.equal((await rows(STRANGER, `select id from events`)).length, 0);
  assert.equal((await rows(STRANGER, `select id from event_invites`)).length, 0);
  assert.equal((await rows(BENCH, `select id from event_invites`)).length, 0);
  // Friend sees only their own invite row, not other invitees' contacts.
  const mine = await rows(FRIEND, `select invitee_display_name from event_invites`);
  assert.deepEqual(mine, [{ invitee_display_name: 'Friend' }]);
  assert.equal((await rows(OWNER, `select id from event_invites`)).length, 2);
});

test('invitees cannot write invites or events directly', async () => {
  const upd = await rows(FRIEND, `update event_invites set tier = 'primary', rsvp_status = 'accepted' returning id`);
  assert.equal(upd.length, 0);
  const ev = await rows(FRIEND, `update events set title = 'hijacked' returning id`);
  assert.equal(ev.length, 0);
});

test('TC-06: token RPC returns only the safe summary; bad/bench tokens return nothing', async () => {
  const [summary] = await rows(null, `select * from get_invite_by_token($1)`, [friendToken]);
  assert.deepEqual(Object.keys(summary).sort(), [
    'event_status', 'event_timezone', 'location_text', 'owner_display_name',
    'proposed_times', 'rsvp_status', 'scheduled_at', 'title',
  ]);
  assert.equal(summary.owner_display_name, 'Owner');
  assert.equal((await rows(null, `select * from get_invite_by_token('nope')`)).length, 0);
  assert.equal((await rows(null, `select * from get_invite_by_token($1)`, [benchToken])).length, 0);
  // anon has no direct table access at all
  assert.equal((await rows(null, `select * from event_invites`)).length, 0);
  assert.equal((await rows(null, `select * from events`)).length, 0);
});

test('respond_to_invite validates input and scope', async () => {
  const ok = await rows(null, `select respond_to_invite($1, 'accepted') as s`, [friendToken]);
  assert.equal(ok[0].s, 'accepted');
  const tc = await rows(
    null,
    `select respond_to_invite($1, 'time_change_requested', array['2026-11-22T16:00Z']::timestamptz[]) as s`,
    [friendToken],
  );
  assert.equal(tc[0].s, 'time_change_requested');
  await assert.rejects(rows(null, `select respond_to_invite($1, 'time_change_requested')`, [friendToken]), /1-2 proposed/);
  await assert.rejects(rows(null, `select respond_to_invite($1, 'invited')`, [friendToken]), /invalid rsvp/);
  await assert.rejects(rows(null, `select respond_to_invite($1, 'accepted')`, [benchToken]), /not found/);
  await assert.rejects(rows(null, `select respond_to_invite('forged', 'accepted')`), /not found/);
});
