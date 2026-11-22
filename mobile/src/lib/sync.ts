import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import type { Mutation } from '../core/queue';

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
        },
      })
    : null;

export async function ensureSession() {
  if (!supabase) throw new Error('Backend not configured');
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  // shortcut: anonymous auth until onboarding (Apple/Google/magic link) links a real identity.
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

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
  if (error) throw error;
}
