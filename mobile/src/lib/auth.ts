// Sign-in (Apple, Google, email code), sign-out and account deletion.
// A guest (anonymous) account is upgraded in place when possible, so nothing moves. If the identity already belongs
// to another account (returning user), we switch to it and carry this device's solo tasks over (see finish()).
import type { User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { AttemptLog, Task } from '../core/tasks';
import { resyncAllAlerts } from './notifications';
import { forgetThisDevice } from './social';
import {
  adoptForNewAccount,
  allTasks,
  mergeFromServer,
  setOnboarded,
  syncNow,
  wipeLocal,
} from './store';
import { supabase } from './sync';

WebBrowser.maybeCompleteAuthSession(); // only does something on web

const sb = () => {
  if (!supabase) throw new Error('Backend not configured');
  return supabase;
};
const currentUser = async () => (await sb().auth.getSession()).data.session?.user ?? null;
const ALREADY_USED = /already|exists|registered/i;

// ─── After any successful sign-in ───
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const toTask = ({ user_id: _u, ...t }: Record<string, unknown>) =>
  ({
    ...t,
    scheduled_at: iso(t.scheduled_at),
    checkin_due_at: iso(t.checkin_due_at),
    completed_at: iso(t.completed_at),
    created_at: iso(t.created_at),
  }) as Task;
const toLog = ({ user_id: _u, ...l }: Record<string, unknown>) =>
  ({
    ...l,
    scheduled_at: iso(l.scheduled_at),
    checkin_prompted_at: iso(l.checkin_prompted_at),
    resolved_at: iso(l.resolved_at),
    retry_target_at: iso(l.retry_target_at),
  }) as AttemptLog;

async function finish(before: User | null, nameHint?: string) {
  const user = (await sb().auth.getUser()).data.user;
  if (!user) throw new Error('Sign-in did not complete');
  if (before && before.id !== user.id) adoptForNewAccount();

  const name = nameHint || user.user_metadata?.full_name || user.user_metadata?.name;
  if (name)
    await sb()
      .from('users')
      .update({ display_name: name })
      .eq('id', user.id)
      .eq('display_name', '');

  // A returning user on a new phone gets their history back.
  const [tasks, logs] = await Promise.all([
    sb().from('tasks').select('*'),
    sb().from('task_attempt_logs').select('*'),
  ]);
  if (!tasks.error && !logs.error)
    mergeFromServer({ tasks: tasks.data.map(toTask), logs: logs.data.map(toLog) });

  setOnboarded();
  await resyncAllAlerts(allTasks());
  void syncNow();
}

// ─── Email: 6-digit code (needs {{ .Token }} in the Supabase email templates) ───
export type EmailMode = 'link' | 'signin';

export async function sendEmailCode(email: string): Promise<EmailMode> {
  const address = email.trim();
  if (!/^\S+@\S+\.\S+$/.test(address)) throw new Error('Enter a valid email');
  if ((await currentUser())?.is_anonymous) {
    const { error } = await sb().auth.updateUser({ email: address });
    if (!error) return 'link';
    if (!ALREADY_USED.test(error.message)) throw error;
  }
  const { error } = await sb().auth.signInWithOtp({ email: address });
  if (error) throw error;
  return 'signin';
}

export async function verifyEmailCode(email: string, code: string, mode: EmailMode) {
  const before = await currentUser();
  const { error } = await sb().auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: mode === 'link' ? 'email_change' : 'email',
  });
  if (error) throw error;
  await finish(before);
}

// ─── OAuth in the system browser (Google everywhere, Apple off iOS) ───
const parseParams = (url: string) => {
  const out: Record<string, string> = {};
  for (const part of url.split(/[?#]/).slice(1).join('&').split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
};

async function oauth(provider: 'google' | 'apple'): Promise<boolean> {
  const before = await currentUser();
  const redirectTo = Linking.createURL('auth-callback');
  const run = async (link: boolean) => {
    const opts = { provider, options: { redirectTo, skipBrowserRedirect: true } };
    const { data, error } = link
      ? await sb().auth.linkIdentity(opts)
      : await sb().auth.signInWithOAuth(opts);
    if (error) throw error;
    const res = await WebBrowser.openAuthSessionAsync(data.url!, redirectTo);
    if (res.type !== 'success') return { cancelled: true as const };
    const p = parseParams(res.url);
    if (p.error || p.error_code)
      return { error: `${p.error_code ?? p.error}: ${p.error_description ?? ''}` };
    if (!p.code) return { error: 'No sign-in code returned' };
    const ex = await sb().auth.exchangeCodeForSession(p.code);
    if (ex.error) throw ex.error;
    return { ok: true as const };
  };

  let r = await run(!!before?.is_anonymous);
  if ('error' in r && before?.is_anonymous && ALREADY_USED.test(r.error ?? ''))
    r = await run(false);
  if ('cancelled' in r) return false;
  if ('error' in r) throw new Error(r.error);
  await finish(before);
  return true;
}

export const signInWithGoogle = () => oauth('google');

/** Native Sign in with Apple on iOS (App Store guideline 4.8); browser flow elsewhere. */
export async function signInWithApple(): Promise<boolean> {
  if (Platform.OS !== 'ios') return oauth('apple');
  const before = await currentUser();
  const rawNonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let cred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
    throw e;
  }
  if (!cred.identityToken) throw new Error('Apple did not return a sign-in token');
  const creds = { provider: 'apple' as const, token: cred.identityToken, nonce: rawNonce };
  let { error } = before?.is_anonymous
    ? await sb().auth.linkIdentity(creds)
    : await sb().auth.signInWithIdToken(creds);
  if (error && before?.is_anonymous && ALREADY_USED.test(`${error.code} ${error.message}`)) {
    ({ error } = await sb().auth.signInWithIdToken(creds));
  }
  if (error) throw error;
  // Apple shares the name only on the very first sign-in.
  const name = cred.fullName ? AppleAuthentication.formatFullName(cred.fullName) : undefined;
  await finish(before, name);
  return true;
}

// ─── Leaving ───
async function clearDevice() {
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  wipeLocal();
}

export async function signOut() {
  await forgetThisDevice().catch(() => {}); // stop pushes for this account reaching this phone
  await sb()
    .auth.signOut()
    .catch(() => {});
  await clearDevice();
}

/** Permanently deletes the account and all its server data, then this device's copy. */
export async function deleteAccount() {
  if (supabase && (await currentUser())) {
    const { error } = await sb().rpc('delete_my_account');
    if (error) throw new Error(error.message);
    await sb()
      .auth.signOut({ scope: 'local' })
      .catch(() => {});
  }
  await clearDevice();
}

export function useAuthUser() {
  const [user, setUser] = useState<User | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}

export const accountLabel = (u: User) =>
  u.is_anonymous
    ? 'Guest'
    : (u.email ?? (u.app_metadata?.provider === 'apple' ? 'Apple ID' : 'Signed in'));
