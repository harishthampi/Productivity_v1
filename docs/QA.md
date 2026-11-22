# QA checklist (task 4.2)

Automated checks run on every change:

```bash
npm run test:db                                              # repo root: schema, RLS, RPCs, push triggers (PGlite)
cd mobile && npm test && npm run typecheck && npm run lint   # state machine, queue, stats
```

Everything below needs **physical devices**: one iPhone and one Android phone, each on a **development build**. Expo Go can't do push and may not show notification action buttons.

```bash
cd mobile
npx eas-cli@latest build --profile development --platform all   # install the result on both phones
npx expo start --dev-client
```

Backend: a Supabase project with both migrations applied (`npx supabase db push`) and anonymous sign-ins on, plus `mobile/.env` filled in.

## Feature matrix

"Auto" means an automated test already covers the server or logic side; the device step checks the rest.

| ID | Auto coverage | Device steps | Pass when |
| --- | --- | --- | --- |
| TC-01 | `createTask` due time; alerts scheduled at T and T+delay | Add a task 2 min ahead with a 15m check-in. Lock the phone. | The start alert fires at T. The check-in alert fires at T+15m with **Completed / Retry Later / Mark Missed** buttons. |
| TC-02 | on-time vs late cutoff; one log per resolve | Tap **Completed** on the lock-screen check-in. | App opens to the celebration. Profile shows On time +1. The task appears under "Resolved today". |
| TC-03 | retry logs attempt 1, schedules attempt 2 | Tap **Retry Later**, then **+1 hr**. | The task shows "attempt 2" at the new time and both alerts fire again. Profile shows Retried +1. |
| TC-04 | `isExpired` after 60 min grace; miss → failed | Ignore a check-in for 61+ min, then open the app. | The task shows as Missed and Profile shows Missed +1, counted once. |
| TC-05 | `rls.test.mjs` TC-05 | Squad of 10: set 4 Primary, 2 Bench, 4 Not invited. Create the activity. | Only the 6 chosen people appear on the roster. Only the 4 Primary people get shareable links. |
| TC-06 | `rls.test.mjs` TC-06 | Open `<web>/e/garbage` in a phone browser. | It shows "Invite not found". A valid link shows only the title, time, place, organizer and your own reply. |
| TC-07 | `social.test.mjs` TC-07 | Guest requests 11:00 on the web page. Host taps **Approve 11:00**. | The event moves to 11:00, other guests show "Waiting for reply", and guests with the app get a "moved" push. |
| TC-08 | `social.test.mjs` TC-08 | A Primary guest declines. Host taps **Invite Next Bench Member**. | Bench #1 moves to "Waiting for reply" and gets a push if they have the app. Their link now works. |

## Edge cases

| Case | Steps | Pass when |
| --- | --- | --- |
| Double tap / offline | Airplane mode on. Tap **Done** twice quickly. Airplane mode off and reopen the app. | One log row on the server (check `task_attempt_logs` in the Supabase table editor). Stats move by 1. |
| Force-quit | Create a task, swipe the app away, wait for the check-in alert, tap it. | The app launches straight into that task's check-in. |
| Timezone shift | Create a 10:00 task in Toronto time, then switch the phone to Vancouver time. | The task shows 7:00 and only one set of alerts fires. Alerts are absolute times and get rebuilt on every app open. |
| Permission denied | Turn notifications off in OS settings and return to the app. | The yellow banner shows on Today with no crash. Tapping it opens Settings. |
| Delete before T | Create a task 3 min ahead, then delete it. | No alerts fire. |
| Spots full | `max_spots = 1`. Two guests accept at about the same time. | One gets "event is full". |

## Sign-in and deletion
| Case | Steps | Pass when |
| --- | --- | --- |
| Guest upgrade keeps data | Skip, add 2 tasks and a squad, then Profile → Sign in with Google. | Same tasks, stats and squad afterwards. The account label shows the email. |
| Returning user, new phone | Sign in on phone A and add tasks. On phone B, add 1 task as a guest, then sign in with the same account. | Phone B shows A's tasks plus its own. B's task appears on A after a refresh. Nothing is duplicated. |
| Email code | Enter an email, then the 6-digit code. | Signed in. A wrong code shows an error and no crash. |
| Apple (iPhone) | Tap the Apple button and cancel. Tap it again and complete. | Cancel does nothing. Completing signs in, and the name fills on the first sign-in. |
| Sign out | Profile → Sign out. | The phone is cleared and back on the welcome screen. Signing in again restores the data. |
| Delete account | Profile → Delete account → Delete. | Back on the welcome screen. Signing in with the same identity starts empty. A friend's event still lists you by name. |

## Known gaps to check on devices
- **Android 14+ timing:** exact alarms are off by default, so alerts can arrive a few minutes late. Note how late they arrive.
- **iOS 64-alert cap:** iOS holds at most 64 pending notifications. Test with 30+ upcoming tasks.
- **Web page check:** the web RSVP page (`npx expo export --platform web`, then serve `dist/`) has not been checked in a real browser yet.
