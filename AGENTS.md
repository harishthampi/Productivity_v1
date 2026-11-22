# PulsePlan: agent guide

Spec: [docs/PROJECT_SPECIFICATION.md](docs/PROJECT_SPECIFICATION.md). Schema and RLS: [docs/DATABASE.md](docs/DATABASE.md).

## Layout
- `mobile/`: Expo (SDK 58) + TypeScript app. Read [mobile/AGENTS.md](mobile/AGENTS.md) before touching Expo APIs.
- `supabase/`: config, `migrations/` (schema + RLS), `tests/` (PGlite RLS tests).
- `docs/`: spec and database reference. Update them whenever a schema, payload or flow changes.

## Mobile app structure
- `src/core/`: pure TypeScript (task state machine, offline queue), unit-tested with `node --test`. No React Native imports allowed here.
- `src/lib/`: the persisted store (`expo-sqlite` localStorage), notification scheduling, Supabase sync. Sync runs only when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (see `mobile/.env.example`); without them the app is local-only and mutations stay queued.
- `src/app/`: Expo Router screens. The `task/[id]/checkin` route is the `pulseplan://task/:id/checkin` deep link.

## Working rules
- Work one phase or task group from the spec's Implementation Plan at a time. Before coding, state the files and schema changes involved.
- Add schema changes as a new migration file. Never edit a migration that has already been applied.
- Web RSVP (`/e/:inviteToken`) is not scaffolded yet. It is decided in task 3.4: either an Expo Router web route or a Supabase Edge Function. It only needs the two RPCs in DATABASE.md.

## Checks before calling something done
```bash
npm run test:db                                 # root: migrations + RLS
cd mobile && npm test && npm run typecheck && npm run lint  # app
```
