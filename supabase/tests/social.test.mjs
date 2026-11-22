// Phase 3 RPCs and push triggers. Same PGlite harness as rls.test.mjs, plus a fake net.http_post that records calls.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const OWNER = '00000000-0000-0000-0000-00000000000a';
const P1 = '00000000-0000-0000-0000-00000000000b';
const P2 = '00000000-0000-0000-0000-00000000000c';
const B1 = '00000000-0000-0000-0000-00000000000d';

let db;

const as = (uid, fn) =>
  db.transaction(async (tx) => {
    await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
const rows = async (uid, sql, params) => (await as(uid, (tx) => tx.query(sql, params))).rows;
const pushes = async () => {
  const r = (await db.query(`select body from net_calls order by id`)).rows.flatMap((x) => x.body);
  await db.query(`delete from net_calls`);
  return r;
};

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    create schema net;
    create table public.net_calls (id serial primary key, body jsonb);
    create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as
      $$ insert into public.net_calls (body) values (body) returning id $$;
  `);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  await db.exec(`grant all on all tables in schema public to anon, authenticated; revoke all on public.net_calls from anon, authenticated;`);
  await db.query(
    `insert into auth.users (id, raw_user_meta_data) values ($1, '{"display_name":"Owner"}'), ($2, '{}'), ($3, '{}'), ($4, '{}')`,
    [OWNER, P1, P2, B1],
  );
  for (const u of [OWNER, P1, P2, B1]) {
    await db.query(`insert into user_devices (user_id, platform, push_token, notifications_granted) values ($1, 'ios', $2, true)`, [
      u,
      `ExponentPushToken[${u.slice(-1)}]`,
    ]);
  }
});

async function makeEvent(maxSpots = 2) {
  const [ev] = await rows(
    OWNER,
    `insert into events (title, scheduled_at, event_timezone, max_spots) values ('Doubles', '2026-11-22T15:00Z', 'America/Toronto', $1) returning id`,
    [maxSpots],
  );
  const inv = await rows(
    OWNER,
    `insert into event_invites (event_id, invitee_display_name, tier, rsvp_status, sort_order) values
       ($1, 'P1', 'primary', 'invited', 0), ($1, 'P2', 'primary', 'invited', 1),
       ($1, 'Bench1', 'bench', 'bench', 0), ($1, 'Bench2', 'bench', 'bench', 1)
     returning id, invite_token`,
    [ev.id],
  );
  await pushes();
  return { eventId: ev.id, inv };
}

test('claim links the first app user; others and the owner cannot take it over', async () => {
  const { eventId, inv } = await makeEvent();
  const [{ claim_invite }] = await rows(P1, `select claim_invite($1)`, [inv[0].invite_token]);
  assert.equal(claim_invite, eventId);
  await rows(P1, `select claim_invite($1)`, [inv[0].invite_token]); // re-claim by same user is fine
  await assert.rejects(rows(P2, `select claim_invite($1)`, [inv[0].invite_token]), /not found/);
  await assert.rejects(rows(OWNER, `select claim_invite($1)`, [inv[1].invite_token]), /not found/);
  await assert.rejects(rows(B1, `select claim_invite($1)`, [inv[2].invite_token]), /not found/); // still benched
  await assert.rejects(rows(null, `select claim_invite($1)`, [inv[1].invite_token]), /permission denied/); // anon has no grant
  assert.equal((await rows(P1, `select id from events where id = $1`, [eventId])).length, 1);
});

test('accept respects max_spots; owner is pushed on each answer', async () => {
  const { inv } = await makeEvent(1);
  await rows(null, `select respond_to_invite($1, 'accepted')`, [inv[0].invite_token]);
  await rows(null, `select respond_to_invite($1, 'accepted')`, [inv[0].invite_token]); // idempotent re-accept
  await assert.rejects(rows(null, `select respond_to_invite($1, 'accepted')`, [inv[1].invite_token]), /full/);
  const p = await pushes();
  assert.equal(p.length, 1);
  assert.equal(p[0].to, 'ExponentPushToken[a]');
  assert.match(p[0].body, /P1 is in/);
});

test('TC-07 approve time change moves event, re-asks others, notifies invitees', async () => {
  const { eventId, inv } = await makeEvent();
  await rows(P1, `select claim_invite($1)`, [inv[0].invite_token]);
  await rows(P2, `select claim_invite($1)`, [inv[1].invite_token]);
  await rows(null, `select respond_to_invite($1, 'accepted')`, [inv[0].invite_token]);
  await rows(
    null,
    `select respond_to_invite($1, 'time_change_requested', array['2026-11-22T16:00Z','2026-11-22T17:00Z']::timestamptz[])`,
    [inv[1].invite_token],
  );
  await pushes();

  await assert.rejects(rows(OWNER, `select approve_time_change($1, '2026-11-22T18:00Z')`, [inv[1].id]), /not proposed/);
  await assert.rejects(rows(P1, `select approve_time_change($1, '2026-11-22T16:00Z')`, [inv[1].id]), /not found/);
  await rows(OWNER, `select approve_time_change($1, '2026-11-22T16:00Z')`, [inv[1].id]);

  const [ev] = await rows(OWNER, `select scheduled_at from events where id = $1`, [eventId]);
  assert.equal(ev.scheduled_at.toISOString(), '2026-11-22T16:00:00.000Z');
  const st = await rows(OWNER, `select invitee_display_name n, rsvp_status s from event_invites where event_id = $1 order by sort_order, tier`, [eventId]);
  assert.deepEqual(
    Object.fromEntries(st.map((r) => [r.n, r.s])),
    { P1: 'invited', P2: 'accepted', Bench1: 'bench', Bench2: 'bench' },
  );
  const p = await pushes();
  const moved = p.filter((x) => /moved/.test(x.title));
  assert.deepEqual(moved.map((x) => x.to).sort(), ['ExponentPushToken[b]', 'ExponentPushToken[c]']);
  assert.match(moved[0].body, /11:00 AM/); // 16:00Z shown in America/Toronto
});

test('TC-08 decline prompts owner about bench; promote releases bench #1 in order', async () => {
  const { eventId, inv } = await makeEvent();
  await rows(null, `select respond_to_invite($1, 'declined')`, [inv[0].invite_token]);
  assert.match((await pushes())[0].body, /bench/);

  await assert.rejects(rows(P1, `select promote_next_bench($1)`, [eventId]), /not found/);
  const [{ promote_next_bench: first }] = await rows(OWNER, `select promote_next_bench($1)`, [eventId]);
  assert.equal(first, inv[2].id);
  const [b] = await rows(OWNER, `select rsvp_status, tier from event_invites where id = $1`, [first]);
  assert.deepEqual(b, { rsvp_status: 'invited', tier: 'primary' });
  // Bench1's token now works on the web page
  assert.equal((await rows(null, `select * from get_invite_by_token($1)`, [inv[2].invite_token])).length, 1);
  await rows(OWNER, `select promote_next_bench($1)`, [eventId]);
  await assert.rejects(rows(OWNER, `select promote_next_bench($1)`, [eventId]), /bench/);
});

test('promoting a known app user pushes them; push() is not callable by clients', async () => {
  const [ev] = await rows(OWNER, `insert into events (title, scheduled_at, event_timezone) values ('X', now(), 'UTC') returning id`);
  await rows(
    OWNER,
    `insert into event_invites (event_id, invitee_user_id, invitee_display_name, tier, rsvp_status) values ($1, $2, 'B1', 'bench', 'bench')`,
    [ev.id, B1],
  );
  assert.equal((await pushes()).length, 0); // bench invites stay silent
  await rows(OWNER, `select promote_next_bench($1)`, [ev.id]);
  const p = await pushes();
  assert.equal(p[0].to, 'ExponentPushToken[d]');
  await assert.rejects(rows(P1, `select push(array[$1]::uuid[], 't', 'b', '{}')`, [OWNER]), /permission denied/);
});
