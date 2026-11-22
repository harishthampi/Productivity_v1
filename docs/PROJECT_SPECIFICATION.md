# PulsePlan — Comprehensive Project Specification

This master document contains the complete technical requirements, application flow, testing guide, and implementation plan for building **PulsePlan**—the Accountability Reminder & Social Micro-Scheduler mobile app.

---

# 1. TECHNICAL-REQUIREMENTS.md

## 1.1 Product Overview
* **Product Name:** PulsePlan *(working title)*
* **One-Line Description:** A mobile accountability reminder and targeted social micro-scheduler that verifies task completion 30 minutes after start time, tracks execution reliability, and lets users coordinate casual group activities with specific friend squads and structured time negotiation.
* **Platforms:** iOS (App Store), Android (Google Play Store), plus a lightweight mobile-first Web RSVP fallback (`/e/:inviteToken`).
* **Recommended Stack:** React Native (Expo) + TypeScript for mobile client; Next.js / lightweight Edge web route for `/e/:inviteToken`; Supabase (PostgreSQL, Auth, Realtime, Edge Functions) for backend; Expo Notifications + APNs/FCM for local and push alerts.

## 1.2 Core Features & Expected Behavior

### 1.2.1 Personal Accountability Loop (Solo Tasks)
* **Task Creation:**
  * Inputs: `title` (required), `notes` (optional), `scheduled_at` (required, stored in UTC with user IANA timezone), `checkin_delay_mins` (default `30`, configurable e.g. `15`, `30`, `60`), `priority_tier` (`focus` vs. `standard`).
  * Validation: `title` cannot be empty; `scheduled_at` must be a valid timestamp.
* **Two-Stage Notification Pipeline:**
  * **Stage 1 (Start Reminder):** Triggers at `scheduled_at` (`T`).
  * **Stage 2 (Post-Start Check-In):** Triggers at `scheduled_at + checkin_delay_mins` (`T + 30m`) if the task has not already been completed or cancelled.
  * Lock-screen & in-app actions on Check-In: **Completed**, **Retry Later**, **Mark Missed**.
* **Check-In Outcomes & Retry Behavior:**
  * **Completed:** Records `completed_at`, triggers celebratory haptic + micro-animation overlay, increments user reliability stats (`completed_on_time` if resolved within check-in grace window, or `completed_late`).
  * **Retry Later:** Prompts user to select a new time slot (quick presets: `+1 hr`, `+3 hrs`, `Tomorrow 10:00 AM`, or custom date/time). Logs current attempt as `retried` in `task_attempt_logs`, increments `attempt_number`, updates `scheduled_at` and `checkin_due_at`, and schedules fresh notifications.
  * **Failed / Missed:** Triggered when the user explicitly taps *Mark Missed* or when an uncompleted task expires past its check-in window without a retry. Logs `failed_missed` in `task_attempt_logs` and updates profile stats.

### 1.2.2 Targeted Squads & Social Micro-Scheduler
* **Squads (Saved Friend Subsets):**
  * Users can save named subsets of friends/contacts (e.g., *"Badminton A-Team"*, *"Weekend Doubles"*) directly from past events (*"Save these 4 players as a Squad?"*) or via contact/user selection.
  * Supports optional **Tier 1 (Primary)** and **Tier 2 (Bench / Waitlist)** ordering for capped activities (e.g., 4 spots for doubles).
* **Targeted Event Creation & Gated Invites:**
  * Owner creates an activity: `title`, `scheduled_at`, `event_timezone`, `location_text` (optional), `min_accepted_quorum` (optional), `max_spots` (optional), and selects specific Squad members or individual contacts.
  * **Gated Invite Rule:** Instead of a single unrestricted public link, each invited recipient receives a scoped `invite_token` tied to their `event_invites` row. Uninvited third parties cannot view or claim spots.
* **RSVP & Time-Change Negotiation:**
  * Recipients respond via mobile app or mobile web fallback (`/e/:inviteToken`) without mandatory app install for first RSVP.
  * Supported actions: **Accept**, **Decline**, or **Request Time Change** (submitting 1–2 proposed alternative time slots).
  * Owner receives a push notification on time-change requests and can **Approve** (updating `events.scheduled_at` and notifying all invitees to re-confirm) or **Decline** the proposed slot.
  * **Bench Auto-Fill / Prompt:** If a `primary` invitee declines and `bench` invitees exist, the owner is prompted (or auto-triggers based on event setting) to release the open invite to the next bench member.

### 1.2.3 User Profile & Reliability Analytics
* **Execution Breakdown:** Displays non-punitive, honest personal metrics:
  * **Completed On-Time** (count & %)
  * **Retried / Rescheduled** (count & %)
  * **Failed / Missed** (count & %)
  * **Current On-Time Streak** & **Best Productive Time Window** (Morning / Afternoon / Evening).
* **Privacy Rule:** Solo task metrics and failure counts are strictly private to the user (`user_id`) and never exposed to friends.

## 1.3 Technical Constraints & Non-Functional Requirements
* **OS Background & Notification Reliability:** Mobile OS background workers cannot be trusted to wake up after 30 minutes to schedule a second notification. Both Stage 1 (`T`) and Stage 2 (`T + 30m`) local notifications must be scheduled upfront upon task creation/reschedule, backed by server push notifications and foreground reconciliation when the app opens.
* **Timezone & DST Safety:** Store all timestamps in UTC (`timestamptz`) alongside IANA timezone strings (`America/Toronto`, etc.). Recalculate local notification triggers if device timezone changes.
* **Offline-First & Idempotency:** Check-in resolutions, task retries, and RSVPs must succeed optimistically offline and sync via a queued mutation layer with client-generated UUID `idempotency_key`s to prevent duplicate log entries or double-counted stats.
* **Security & Row-Level Security (RLS):** Enforce authorization server-side via PostgreSQL RLS. Scoped web invite tokens must expose only minimal event summary fields (`title`, `scheduled_at`, `location_text`, `owner_display_name`, and that invitee's own RSVP state)—never full participant phone numbers or emails.

## 1.4 Non-Goals (Out of Scope for v1)
* Full 24/7 live GPS background location sharing.
* Open-ended group chat threads inside events (keep communication structured via status pulses, micro-polls, and time slots).
* Complex recurring project/Kanban boards or third-party calendar two-way write sync (v1 supports `.ics` export/add-to-calendar only).

---

# 2. APPFLOW.md

## 2.1 Screen Inventory
1. **Onboarding & Auth Screen:** Sign in (Apple, Google, Email/Magic Link), timezone confirmation, notification permission request, and default check-in window confirmation (`30 mins`).
2. **Today Hub (Tab 1 — Primary Home):** Displays active check-in banners at top, today's scheduled solo tasks, quick `+ Add Task` trigger, and 1-tap status controls.
3. **Add / Edit Task Sheet:** Fast input for task title, date/time picker, check-in delay selector (`15m`, `30m`, `60m`, `Off`), and priority toggle (`Focus` vs. `Standard`).
4. **30-Minute Check-In & Retry Modal:** Triggered by check-in notification or tapping an awaiting task. Displays *"30 mins since [Task] started — did you complete it?"* with **Yes, Completed**, **Retry Later** (opens quick slot presets + custom picker), and **Mark Missed**.
5. **Celebration Overlay:** Lightweight animated confirmation with haptic feedback showing updated on-time completion count and streak.
6. **Plans & Squads Hub (Tab 2):** Segmented view for **Upcoming Plans** (*Hosting* & *Invited*) and **My Squads** (saved friend subsets).
7. **Create Activity Screen:** Form for activity title, date/time, optional location, optional quorum/spot cap, and **Recipient Picker** (select a saved Squad, toggle Primary vs. Bench members, or pick contacts).
8. **Event Detail & Negotiation Screen:** Shows event time/location, live RSVP roster (*Accepted*, *Declined*, *Time Change Requested*, *Bench*), owner controls to **Approve/Reject Proposed Time** or **Invite Next Bench Member**, and per-invitee share actions.
9. **Web RSVP Landing Page (`/e/:inviteToken`):** Mobile-responsive web view for non-app recipients displaying event summary and 3 action buttons: **Accept**, **Decline**, **Request Time Change** (1–2 slot picker), followed by an app install/deep-link banner.
10. **Profile & Reliability Screen (Tab 3):** Visual breakdown of **On-Time Completed** vs. **Retried** vs. **Failed**, time-of-day completion chart, and notification/account settings.

## 2.2 Core User Journeys

### Journey 1: Solo Task → 30-Min Check-In → Complete or Retry
```text
Today Hub (+ Add Task)
  └─► Set "Submit Report" for Tomorrow 10:00 AM (Check-in: 30m)
        ├─► [10:00 AM] Stage 1 Notification fires ("Time to start: Submit Report")
        └─► [10:30 AM] Stage 2 Check-In Notification fires ("Did you finish?")
              ├─► Tap "Completed" ──► Celebration Overlay ──► Profile (+1 On-Time)
              ├─► Tap "Retry Later" ──► Pick Tomorrow 2:00 PM ──► New T & T+30m alerts scheduled ──► Profile (+1 Retried)
              └─► Tap "Missed" / Window Expires ──► Marked Failed ──► Profile (+1 Failed)
```

### Journey 2: Targeted Squad Activity & Time Negotiation
```text
Plans Hub (+ New Activity)
  └─► Title: "Badminton Doubles", Tomorrow 10:00 AM, Max Spots: 4
        └─► Select Squad "Badminton 10" ──► Pick 4 Primary + 2 Bench ──► Send Targeted Invites
              ├─► Invitee 1 taps Accept ──► Roster updates to 1/4 Going
              ├─► Invitee 2 taps Decline ──► Owner gets 1-tap prompt: "Invite Bench #1?"
              └─► Invitee 3 taps Request Time Change (11:00 AM)
                    └─► Owner opens Event Detail ──► Taps "Approve 11:00 AM"
                          └─► Event updates to 11:00 AM ──► Push alerts sent to participants
```

### Journey 3: Post-Event Squad Creation (Zero-Friction List Building)
```text
Event Completes (or 4 players accept)
  └─► Prompt banner on Event Detail: "Save these 4 players as a Squad?"
        └─► User taps "Save" ──► Enters name "Thursday Court Crew" ──► Saved to My Squads
```

## 2.3 Navigation Architecture
* **Bottom Tab Bar:** `Today` | `Plans` | `Profile`
* **Deep Links & Universal Links:**
  * `app://task/:taskId/checkin` → Opens `Today Hub` with `Check-In Modal` active.
  * `https://<domain>/e/:inviteToken` → Opens `Event Detail` if app is installed; falls back to `Web RSVP Landing Page` in mobile browser.

---

# 3. TESTING-GUIDE.md

## 3.1 Test Environment & Tooling
* **Unit Tests:** Jest / Vitest (date/timezone math, check-in window calculations, state machine transitions, reliability stat aggregation).
* **Integration Tests:** Supabase local/test instance + API/Edge Function tests (RLS enforcement, scoped `invite_token` authorization, time-change approval, bench promotion, idempotent mutations).
* **E2E & Device Verification:** Maestro / Detox + physical iOS and Android devices (lock-screen notification actions, killed-app deep links, offline queue replay).

## 3.2 Feature Verification Matrix

| ID | Feature | Test Steps | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-01** | **Task Creation & Alerts** | Create task for `T = now + 2m`, check-in `1m` (test mode). | Stage 1 notification fires at `T`; Stage 2 check-in fires at `T + 1m` with action buttons. |
| **TC-02** | **On-Time Completion** | Tap **Completed** on Stage 2 notification or modal within grace window. | Task status → `completed`; celebration triggers; `completed_on_time` increments by 1; `task_attempt_logs` records 1 entry. |
| **TC-03** | **Retry Flow** | Tap **Retry Later**, select `T2 = now + 5m`, then complete at `T2`. | Attempt 1 logged as `retried`; Attempt 2 created at `T2`; new alerts fire at `T2` and `T2 + 1m`; completion increments `retried` history + completion count accurately. |
| **TC-04** | **Failed / Missed Flow** | Ignore task past check-in window expiration (or tap **Mark Missed**). | Task transitions to `failed`; `failed_missed` logged once; Profile reflects updated failed count. |
| **TC-05** | **Targeted Squad Invite** | Create Squad of 10; invite only 4 Primary + 2 Bench to an event. | Only those 4 Primary invitees receive active invites; uninvited 4 members have zero access to the event. |
| **TC-06** | **Gated Token Security** | Attempt to access `/e/:inviteToken` with an invalid or tampered token, or query other invitees' PII. | Invalid token returns `404/403`; valid token returns only safe event summary and that recipient's RSVP record. |
| **TC-07** | **Time Negotiation** | Invitee submits **Request Time Change** (`11:00 AM`); Owner taps **Approve**. | Event `scheduled_at` updates to `11:00 AM`; event status reflects time update; all active invitees receive notification. |
| **TC-08** | **Bench Promotion** | Primary invitee declines; Owner taps **Invite Next Bench Member**. | Bench #1 `event_invites` status moves from `bench` to `invited` and dispatches their scoped invite link/push. |

## 3.3 Edge Cases & Regression Checklist
* **Idempotency / Double-Tap:** Rapidly tap **Completed** or **Accept** twice while toggling Airplane Mode → Verify only one `task_attempt_logs` row and one RSVP update persist after reconnect.
* **App Force-Quit:** Create a task, force-close the app completely, wait for Stage 2 check-in alert, tap notification → Verify app launches directly into Check-In Modal for that `taskId`.
* **Timezone Shift:** Create a 10:00 AM task in `America/Toronto`, switch device timezone to `America/Vancouver` → Verify UTC timestamp remains intact and UI/notifications adjust cleanly without duplicating alerts.
* **Notification Permission Denied:** Revoke OS notification permission mid-session → Verify app displays a non-blocking banner guiding user to Settings instead of throwing unhandled exceptions.
* **Cancel / Delete Task:** Delete or reschedule a task before `T` → Verify previously scheduled Stage 1 and Stage 2 local notification IDs are cancelled so ghost alerts never fire.

## 3.4 Definition of Done (Per Feature Slice)
* [ ] All unit and integration tests pass.
* [ ] TypeScript type-check (`tsc --noEmit`) and linter pass with zero errors.
* [ ] Verified on at least one physical iOS and one physical Android device.
* [ ] `/docs` updated if any schema, API payload, or flow changed.

---

# 4. IMPLEMENTATION-PLAN.md

> **Agent Operating Instruction:** Implement one phase/task group at a time. Before writing code for each task, inspect `/docs`, state affected files and schema changes, and verify tests/lint/build after completion.

## Phase 1: Project Scaffold, Schema & Security Foundation
- [x] **1.1 Initialize Repo & Docs:** Set up Expo (TypeScript) mobile project, web RSVP route project/workspace, linting, formatting, and commit `/docs` (`PROJECT_SPECIFICATION.md`, `DATABASE.md`, and `AGENTS.md`). *(Web RSVP workspace deferred to 3.4; see AGENTS.md.)*
- [x] **1.2 Database Schema & Migrations:** Create PostgreSQL tables with UTC `timestamptz` columns and indexes:
  - `users` (`id`, `display_name`, `timezone`, `default_checkin_delay_mins`, `created_at`)
  - `tasks` (`id`, `user_id`, `title`, `notes`, `priority_tier`, `scheduled_at`, `checkin_delay_mins`, `checkin_due_at`, `status`, `attempt_number`, `parent_task_id`, `completed_at`, `created_at`)
  - `task_attempt_logs` (`id`, `task_id`, `user_id`, `attempt_number`, `scheduled_at`, `checkin_prompted_at`, `resolved_at`, `outcome`, `retry_target_at`, `idempotency_key`)
  - `squads` (`id`, `owner_id`, `name`, `created_at`) & `squad_members` (`id`, `squad_id`, `member_user_id`, `display_name`, `contact_ref`, `default_tier`)
  - `events` (`id`, `owner_id`, `title`, `description`, `location_text`, `scheduled_at`, `event_timezone`, `min_accepted_quorum`, `max_spots`, `status`, `created_at`)
  - `event_invites` (`id`, `event_id`, `invitee_user_id`, `invitee_display_name`, `invitee_contact_ref`, `invite_token`, `tier`, `rsvp_status`, `proposed_times`, `responded_at`)
  - `user_devices` (`id`, `user_id`, `platform`, `push_token`, `notifications_granted`, `last_seen_at`)
- [x] **1.3 Auth & RLS Policies:** Configure authentication and write strict RLS policies ensuring solo tasks/logs and squads are owner-only, while `event_invites` are scoped strictly to the event owner or matching invitee/token.

## Phase 2: Solo Accountability & 30-Minute Check-In Engine
- [x] **2.1 Task State Machine & Local Storage:** Implement pure TypeScript state transition functions (`scheduled` → `reminded` → `checkin_pending` → `completed` / `retried` / `failed`) and offline mutation queue with `idempotency_key`.
- [x] **2.2 Notification Scheduler Service:** Build wrapper around Expo Notifications that schedules both Stage 1 (`T`) and Stage 2 (`T + checkin_delay_mins`) local alerts with interactive categories (`COMPLETE`, `RETRY`, `MISSED`), cancels stale IDs on edit/delete, and reconciles overdue check-ins on app foreground.
- [x] **2.3 Today Hub & Add Task UI:** Build `Today Hub` screen, active check-in banner, and `Add/Edit Task` modal with default 30-minute check-in setting.
- [x] **2.4 Check-In Modal, Retry Picker & Celebration Overlay:** Build the 30-minute follow-up prompt, quick retry time presets + custom picker, and haptic celebration feedback screen.

## Phase 3: Targeted Squads, Social Micro-Scheduler & Time Negotiation
- [x] **3.1 Squads Management & Auto-Save Hook:** Build `My Squads` UI, contact/friend selection, Primary vs. Bench tiering, and the post-event *"Save these players as a Squad?"* prompt.
- [x] **3.2 Create Event & Gated Invite Generation:** Build `Create Activity` screen allowing selection of a specific subset of Squad members/contacts and generating per-invitee scoped `invite_token`s.
- [x] **3.3 Event Detail, Time Negotiation & Bench Promotion:** Build `Event Detail` view with real-time RSVP updates, owner **Approve/Reject Time Change** workflow, and 1-tap **Invite Next Bench Member** flow.
- [x] **3.4 Web RSVP Fallback & Push Alerts:** Build mobile-first `/e/:inviteToken` web page (Accept, Decline, Request Time Change) and server push triggers for invites, RSVPs, and approved time changes.

## Phase 4: Reliability Profile, QA & Store Submission
- [x] **4.1 Profile & Reliability Analytics:** Build `Profile` tab computing **Completed On-Time** vs. **Retried** vs. **Failed** counts/percentages, active streak, and best time-of-day completion insights.
- [ ] **4.2 Full Test Suite & Device QA:** Execute all cases in `TESTING-GUIDE.md` across iOS and Android devices (offline sync, timezone shifts, force-quit notifications, gated invite security). *(Prepared: automated coverage and device steps are in [QA.md](QA.md). Device runs pending.)*
- [ ] **4.3 Store Assets & Beta Release:** Configure App Store Connect and Google Play Console metadata, privacy disclosures, push certificates, and ship TestFlight / Internal Testing builds. *(Prepared: `eas.json`, permissions and privacy answers are in [STORE_RELEASE.md](STORE_RELEASE.md). Needs your Apple and Google accounts.)*
