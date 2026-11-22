# Database

Source of truth: [`supabase/migrations/`](../supabase/migrations/). Tests: `npm run test:db` (root), which runs the migrations on PGlite and checks RLS.

## Conventions
- Every timestamp is `timestamptz` (UTC). IANA zones live next to it (`users.timezone`, `events.event_timezone`).
- `user_id` / `owner_id` default to `auth.uid()`, so clients don't send them.
- Offline-queued writes to `task_attempt_logs` carry a client UUID `idempotency_key` (unique). Insert with `on conflict (idempotency_key) do nothing`.
- `public.users` rows are created by a trigger on `auth.users` insert, and clients never insert them.

## Tables
| Table | Notes |
| --- | --- |
| `users` | Profile. `default_checkin_delay_mins` defaults to 30. |
| `tasks` | `checkin_delay_mins` null means check-in is Off. A trigger sets `checkin_due_at = scheduled_at + delay`. Status: `scheduled → reminded → checkin_pending → completed / retried / failed`, plus `cancelled`. The client only ever stores `scheduled`, `completed`, `failed` or `cancelled`. `reminded` and `checkin_pending` are worked out from the clock, and a retry sets the row back to `scheduled` with `attempt_number + 1` and the new time; the `retried` outcome is recorded in the log. Grace window: an attempt counts as on time if resolved within 60 min of `checkin_due_at` (or of `scheduled_at` when check-in is Off). After that it auto-fails the next time the app comes to the foreground. |
| `task_attempt_logs` | One row per resolved attempt. `outcome` is one of `completed_on_time`, `completed_late`, `retried`, `failed_missed`. `retry_target_at` is required exactly when the outcome is `retried`. Reliability stats are computed from this table; there are no stored counters, so nothing can be double-counted. |
| `squads`, `squad_members` | Owner-only. A member is either an app user (`member_user_id`) or a contact (`contact_ref`). `default_tier` is `primary` or `bench`. |
| `events` | `status` is `active`, `cancelled` or `completed`. |
| `event_invites` | One row per recipient, each with its own random 64-hex-char `invite_token`. `rsvp_status`: `bench` (not yet released), `invited`, `accepted`, `declined`, `time_change_requested`. `proposed_times` holds 1–2 values exactly when the status is `time_change_requested`. |
| `user_devices` | Push tokens, unique per `(user_id, push_token)`. |

`event_invites.sort_order` and `squad_members.sort_order` set the order (lowest first). On invites it decides which bench player is promoted next.

## Access rules (RLS)
- **Owner-only:** `users` (self), `tasks`, `task_attempt_logs`, `user_devices`, `squads`, `squad_members`. Solo metrics are never visible to anyone else.
- **events:** the owner has full access. An invitee whose invite is not `bench` can read the event.
- **event_invites:** the owner has full access. An invitee can read only their own row, and only once it is not `bench`. Invitees have **no direct write access**. RSVPs go through the RPC below.
- **anon:** no table access at all.

## RPCs (callable by `anon` and `authenticated`)
- `get_invite_by_token(p_token)` returns `title, scheduled_at, event_timezone, location_text, owner_display_name, event_status, rsvp_status, proposed_times`. An unknown token or a `bench` token returns no row, which the client turns into a 404.
- `respond_to_invite(p_token, p_status, p_proposed_times default '{}')`. `p_status` must be `accepted`, `declined` or `time_change_requested` (the last needs 1–2 times). Works only on `active` events. Raises `P0002` when the invite is not found. Setting the same status twice is harmless. Accepting fails with `event is full` once `max_spots` people have accepted. The event row is locked during the check, so two people can't both take the last spot.

## Owner and app-user RPCs (`authenticated` only)
- `claim_invite(p_token)` sets `invitee_user_id = auth.uid()` on a non-bench invite that is unclaimed (or already this user's) and returns the `event_id`. It fails for the event owner and for anyone after the first claimer. Sharing a link per invitee and letting the app claim it is how app users get linked to invites.
- `approve_time_change(p_invite_id, p_time)` is owner-only, and `p_time` must be one of that invite's `proposed_times`. It moves `events.scheduled_at`, resets other `accepted` / `time_change_requested` invites to `invited` (so they re-confirm), and marks the requester `accepted`.
- `promote_next_bench(p_event_id)` is owner-only. It turns the lowest-`sort_order` bench invite into `invited` / `primary` and returns its id.
- Rejecting a proposal is a direct owner update: `rsvp_status = 'invited', proposed_times = '{}'`.

## Push (server-side)
- `push(user_ids, title, body, data)` posts to Expo's push API through `pg_net`, using `user_devices` rows where `notifications_granted` is true. It does nothing when `pg_net` is missing. Clients cannot call it.
- Triggers send: the owner when an invitee accepts, declines or asks for a new time (plus a bench nudge on a decline); the invitee when their invite becomes active (insert, or promotion from the bench); and active invitees when `events.scheduled_at` changes. Changes the owner makes don't notify the owner.
- `events` and `event_invites` are in the `supabase_realtime` publication. Subscribers only receive rows RLS lets them see.
