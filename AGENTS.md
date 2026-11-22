# PulsePlan: agent guide

Spec: [docs/PROJECT_SPECIFICATION.md](docs/PROJECT_SPECIFICATION.md). Schema and RLS: [docs/DATABASE.md](docs/DATABASE.md). Device QA: [docs/QA.md](docs/QA.md). Release: [docs/STORE_RELEASE.md](docs/STORE_RELEASE.md).

## Layout
- `mobile/`: Expo (SDK 58) + TypeScript app. Read [mobile/AGENTS.md](mobile/AGENTS.md) before touching Expo APIs.
- `supabase/`: config, `migrations/` (schema + RLS), `tests/` (PGlite RLS tests).
- `docs/`: spec and database reference. Update them whenever a schema, payload or flow changes.

## Mobile app structure
- `src/core/`: pure TypeScript (task state machine, offline queue), unit-tested with `node --test`. No React Native imports allowed here.
- `src/lib/`: the persisted store (`expo-sqlite` localStorage), notification scheduling, Supabase sync. Sync runs only when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (see `mobile/.env.example`); without them the app is local-only and mutations stay queued.
- `src/app/`: Expo Router screens. Tabs live in `(tabs)/`. The `task/[id]/checkin` route is the `pulseplan://task/:id/checkin` deep link.

## Working rules
- Work one phase or task group from the spec's Implementation Plan at a time. Before coding, state the files and schema changes involved.
- Add schema changes as a new migration file. Never edit a migration that has already been applied.
- Web RSVP (`/e/:inviteToken`) is the Expo Router route `src/app/e/[token].tsx`. In the app it claims the invite; on the web it is the no-install RSVP page. Build it with `npx expo export --platform web` (single-page mode) and host `dist/` with a rewrite of `/*` to `/index.html`. Supabase Edge Functions can't serve HTML on their default domain.
- Solo tasks are offline-first (`src/lib/store.ts`). Squads, events and invites are online-only (`src/lib/social.ts`).

## Checks before calling something done
```bash
npm run test:db                                 # root: migrations + RLS
cd mobile && npm test && npm run typecheck && npm run lint  # app
```
