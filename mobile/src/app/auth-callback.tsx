import { Redirect } from 'expo-router';

// OAuth returns to pulseplan://auth-callback. The browser session in lib/auth.ts reads the code;
// if Android also routes the link into the app, just go home.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
