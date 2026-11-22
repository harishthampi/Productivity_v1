# Store release (task 4.3)

The repo is configured for release. The remaining steps need your Apple and Google accounts.

## Already set up
- **Identifiers:** `app.json` uses bundle identifier and package `com.pulseplan.app`. **This is a placeholder: change it to a reverse domain you own before the first build.** It can't be changed after release.
- **Build profiles:** `eas.json` has `development` (dev client), `preview` (internal install) and `production` (store build, build number increments automatically).
- **Permissions:**
  - Contacts is read-only, with a usage description. `WRITE_CONTACTS` is blocked on Android.
  - Notifications are local, plus push once an EAS project exists.
  - `SCHEDULE_EXACT_ALARM` is declared for on-time reminders on Android 12–13.
- `ITSAppUsesNonExemptEncryption: false` (the app only uses standard HTTPS).

## Steps
1. **EAS project:** `cd mobile && npx eas-cli@latest login && npx eas-cli@latest init`. This writes `extra.eas.projectId` into `app.json`, which also enables push.
2. **Push credentials:** run `npx eas-cli@latest credentials`. For iOS, let EAS create the APNs key. For Android, upload the FCM V1 service-account JSON from Firebase.
3. **Backend:** create a production Supabase project, run `npx supabase db push`, and turn on anonymous sign-ins. Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_WEB_URL` as EAS environment variables (`npx eas-cli@latest env:create`).
4. **Web RSVP page:** run `npx expo export --platform web` and deploy `dist/` to any static host, rewriting `/*` to `/index.html`. Use its URL as `EXPO_PUBLIC_WEB_URL`.
5. **Build:** `npx eas-cli@latest build --profile production --platform all`.
6. **Beta:** `npx eas-cli@latest submit --platform ios` sends the build to TestFlight. `--platform android` sends it to Play Internal testing. For Android, create the app in Play Console first and upload the first build by hand.

## Store listing inputs
- **Name / subtitle:** PulsePlan. Suggested subtitle: "Reminders that check in".
- **Category:** Productivity.
- **Screenshots:** Today with a check-in banner, the check-in screen, the celebration, Plans, Event detail and Profile. You need 6.7" and 6.5" iPhone sizes, plus a phone size for Play.
- **Privacy policy URL:** required by both stores. Write one that covers the data below.

## Privacy answers (App Store "App Privacy" / Play "Data safety")
| Data | Collected? | Linked to user | Purpose | Notes |
| --- | --- | --- | --- | --- |
| Contact info (names, phone/email of people **you invite**) | Yes | Yes | App functionality | Only contacts you pick, stored on your squads and invites. Visible to you; the invitee sees only their own invite. |
| User content (task titles/notes, event details) | Yes | Yes | App functionality | Task data stays private to you. Event title, time and place are shown to your invitees. |
| Identifiers (push token, anonymous account id) | Yes | Yes | App functionality | Used to send reminders and invite updates. |
| Usage data, diagnostics, location, tracking | No | – | – | No analytics SDK. No tracking. |

Data isn't sold or used for advertising. Data is encrypted in transit (HTTPS to Supabase). **Account deletion:** both stores now require in-app account deletion. It isn't built yet; add it before the public (non-beta) release.

## Before going public (not needed for TestFlight / internal testing)
- Real sign-in (Apple, Google, magic link). Anonymous accounts are lost on reinstall.
- In-app account deletion.
- An app icon and splash screen. The current ones are Expo's defaults in `mobile/assets/`.
