<p align="center">
  <img src="mobile/assets/icon.png" width="96" alt="PulsePlan icon" />
</p>

<h1 align="center">PulsePlan</h1>

<p align="center">Reminders that check in 30 minutes later, and plans with the friends you actually play with.</p>

PulsePlan is an iOS and Android app with two halves:

- **Accountability reminders.** Each task gets two alerts: one when it starts and a check-in a set time later (30 min by default) asking *did you finish?* You answer **Completed**, **Retry Later** or **Mark Missed** right from the lock screen. Your private Profile tracks how often you finish on time, your streak and your best time of day.
- **Social micro-scheduling.** Save friend groups as *Squads* with Primary and Bench players. Each invitee gets their own private link, and friends can RSVP or suggest a new time without installing the app. Open spots go to the bench in order.

## Features

| | |
| --- | --- |
| Two-stage alerts | Start reminder and check-in are both scheduled when the task is saved, so they don't depend on the phone waking the app in the background. |
| Offline-first tasks | Tasks work with no connection. Changes queue up and sync later, and a replayed change is never counted twice. |
| Reliability profile | Counts and percentages for on-time, late, retried and missed tasks; on-time streak; on-time rate by time of day. Only you can see them. |
| Squads and invites | Primary and Bench tiers, a cap on spots, a minimum number needed to go ahead, and a private link for each invitee. |
| Time negotiation | Invitees propose 1–2 new times. Approving one moves the event and asks everyone else to confirm again. |
| Web RSVP | `/e/<token>` lets people without the app accept, decline or suggest a time. |
| Push | The database sends Expo push notifications when people reply, when a bench player is promoted, and when an event's time changes. |
| Accounts | Sign in with Apple, Google or an email code. Guests can sign in later without losing data. Sign-out and in-app account deletion are built in. |

## Tech stack

- **App:** Expo SDK 58, React Native, TypeScript, Expo Router. Data is stored on the phone with `expo-sqlite`, and alerts use `expo-notifications`.
- **Backend:** Supabase: Postgres with row-level security, Auth, Realtime, and `pg_net` for sending pushes.
- **Web RSVP page:** the same Expo Router route, exported as a static single-page app.
- **Tests:** Node's built-in test runner. The database tests run the real migrations on [PGlite](https://pglite.dev) (Postgres in WASM), so they don't need Docker.

## Repository layout

```
mobile/                 Expo app
  src/app/              screens (Expo Router): (tabs)/, task/, event/, squad/, e/[token], welcome
  src/core/             pure TypeScript: task state machine, sync queue, stats (unit-tested)
  src/lib/              local storage, notifications, sync, social, auth
  assets/brand/         icon source (mark.svg) and the script that renders the icons
supabase/
  migrations/           schema, access rules (RLS), database functions, push triggers
  tests/                database tests on PGlite
docs/                   spec, database reference, QA checklist, release guide
```

## Getting started

**Prerequisites:** Node 20+ (developed on 24), and a phone with Expo Go or a development build.

```bash
npm install                 # repo root: database test tooling
cd mobile && npm install
npm start                   # scan the QR code with Expo Go
```

Without a backend, the app runs in **local-only mode**. Solo tasks, check-ins and stats all work, while Plans and sign-in stay hidden.

### Connecting a backend

1. Create a Supabase project, then apply the migrations:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
2. In the Supabase dashboard → Authentication, turn on anonymous sign-ins and manual linking, add `pulseplan://**` to Redirect URLs, and put `{{ .Token }}` in the Magic Link and Change Email templates. Full provider setup is in [docs/STORE_RELEASE.md](docs/STORE_RELEASE.md#sign-in-setup-supabase-dashboard--authentication).
3. Copy `mobile/.env.example` to `mobile/.env` and fill it in:
   ```
   EXPO_PUBLIC_SUPABASE_URL=...
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
   EXPO_PUBLIC_WEB_URL=...    # optional: where the web RSVP page is hosted
   ```

Expo Go is enough for local notifications. Push, Sign in with Apple and lock-screen buttons need a development build:

```bash
npx eas-cli@latest build --profile development --platform all
npx expo start --dev-client
```

### Web RSVP page

```bash
cd mobile && npx expo export --platform web
```

Host `mobile/dist/` on any static host, rewriting `/*` to `/index.html`, and set `EXPO_PUBLIC_WEB_URL` to its address.

## Tests and checks

```bash
npm run test:db                                              # root: schema, RLS, functions, push triggers, account deletion
cd mobile && npm test && npm run typecheck && npm run lint   # state machine, queue, stats
```

Device testing steps for every case in the spec are in [docs/QA.md](docs/QA.md).

## Documentation

- [Project specification](docs/PROJECT_SPECIFICATION.md): requirements, app flow, test matrix, implementation plan
- [Database](docs/DATABASE.md): tables, access rules, functions, push
- [QA checklist](docs/QA.md): device test steps
- [Store release](docs/STORE_RELEASE.md): EAS builds, sign-in providers, privacy answers
- [AGENTS.md](AGENTS.md): conventions for contributors and coding agents

## Status

Phases 1–4 of the [implementation plan](docs/PROJECT_SPECIFICATION.md#4-implementation-planmd) are built and covered by automated tests. Device QA and store submission are still pending; they need physical phones and Apple/Google developer accounts.
