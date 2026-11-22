import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import { PermanentError, type Mutation } from '../core/queue';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// No env → local-only mode: mutations stay queued until a backend is configured.
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: globalThis.localStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce', // OAuth returns a ?code= to the app, exchanged in lib/auth.ts
        },
      })
    : null;

export async function ensureSession() {
  if (!supabase) throw new Error('Backend not configured');
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  // Guests get an anonymous account; signing in later links a real identity to it (lib/auth.ts).
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

// Postgres classes 22 (bad data), 23 (constraint) and 42 (RLS/permission) never succeed on retry.
const isPermanent = (code?: string) => !!code && /^(22|23|42)/.test(code);

export async function send(m: Mutation) {
  await ensureSession();
  const db = supabase!;
  const { error } =
    m.op === 'upsert_task'
      ? await db.from('tasks').upsert(m.payload)
      : m.op === 'insert_log'
        ? await db
            .from('task_attempt_logs')
            .upsert(m.payload, { onConflict: 'idempotency_key', ignoreDuplicates: true })
        : await db.from('tasks').delete().eq('id', m.payload.id);
  if (error) throw isPermanent(error.code) ? new PermanentError(error.message) : error;
}
