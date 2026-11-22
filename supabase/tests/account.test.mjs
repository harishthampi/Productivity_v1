// Account deletion: everything the user owns goes; other people's data only loses the link to them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const ME = '00000000-0000-0000-0000-00000000000a';
const FRIEND = '00000000-0000-0000-0000-00000000000b';
let db;

const as = (uid, sql, params) =>
  db.transaction(async (tx) => {
    await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return (await tx.query(sql, params)).rows;
  });
const count = async (table, where = 'true', params = []) =>
  Number((await db.query(`select count(*)::int c from ${table} where ${where}`, params)).rows[0].c);

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
  await db.exec(`grant all on all tables in schema public to anon, authenticated;`);
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [ME, FRIEND]);

  // My data
  const [t] = await as(ME, `insert into tasks (title, scheduled_at) values ('mine', now()) returning id`);
  await as(ME, `insert into task_attempt_logs (task_id, attempt_number, scheduled_at, outcome, idempotency_key) values ($1, 1, now(), 'completed_on_time', gen_random_uuid())`, [t.id]);
  const [sq] = await as(ME, `insert into squads (name) values ('crew') returning id`);
  await as(ME, `insert into squad_members (squad_id, display_name) values ($1, 'x')`, [sq.id]);
  const [ev] = await as(ME, `insert into events (title, scheduled_at, event_timezone) values ('my event', now(), 'UTC') returning id`);
  await as(ME, `insert into event_invites (event_id, invitee_user_id, invitee_display_name) values ($1, $2, 'Friend')`, [ev.id, FRIEND]);
  await as(ME, `insert into user_devices (platform, push_token) values ('ios', 'tok')`);

  // Friend's data that references me
  const [fev] = await as(FRIEND, `insert into events (title, scheduled_at, event_timezone) values ('their event', now(), 'UTC') returning id`);
  await as(FRIEND, `insert into event_invites (event_id, invitee_user_id, invitee_display_name) values ($1, $2, 'Me')`, [fev.id, ME]);
  const [fsq] = await as(FRIEND, `insert into squads (name) values ('their crew') returning id`);
  await as(FRIEND, `insert into squad_members (squad_id, member_user_id, display_name) values ($1, $2, 'Me')`, [fsq.id, ME]);
});

test('logged-out callers cannot delete anything', async () => {
  await assert.rejects(as(null, `select delete_my_account()`), /permission denied/);
});

test('delete_my_account removes my data and unlinks me from friends’ data', async () => {
  await as(ME, `select delete_my_account()`);
  assert.equal(await count('auth.users', 'id = $1', [ME]), 0);
  for (const t of ['public.users', 'tasks', 'task_attempt_logs', 'user_devices']) {
    const col = t === 'public.users' ? 'id' : 'user_id';
    assert.equal(await count(t, `${col} = $1`, [ME]), 0, t);
  }
  assert.equal(await count('squads', 'owner_id = $1', [ME]), 0);
  assert.equal(await count('squad_members', `display_name = 'x'`), 0);
  assert.equal(await count('events', 'owner_id = $1', [ME]), 0);
  assert.equal(await count('event_invites', `invitee_display_name = 'Friend'`), 0);
  // Friend keeps their event and squad, just without the link to my account
  assert.equal(await count('event_invites', `invitee_display_name = 'Me' and invitee_user_id is null`), 1);
  assert.equal(await count('squad_members', `display_name = 'Me' and member_user_id is null`), 1);
  assert.equal(await count('auth.users', 'id = $1', [FRIEND]), 1);
});
