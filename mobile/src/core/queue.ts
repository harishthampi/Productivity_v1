// Offline mutation queue. Every mutation is idempotent server-side (task upsert by client id,
// log insert ignored on duplicate idempotency_key, delete by id), so replaying after a crash is safe.

export type Mutation =
  | { key: string; op: 'upsert_task'; payload: Record<string, unknown> }
  | { key: string; op: 'delete_task'; payload: { id: string } }
  | { key: string; op: 'insert_log'; payload: Record<string, unknown> };

export const enqueue = (queue: Mutation[], m: Mutation): Mutation[] =>
  queue.some((q) => q.key === m.key) ? queue : [...queue, m];

/** The server refused this mutation for good (RLS, constraint). Retrying can never succeed, so it is dropped. */
export class PermanentError extends Error {}

/**
 * Sends in order. Stops at the first transient failure (e.g. offline) so later mutations never overtake earlier ones,
 * and skips permanent ones so a single bad row can't block the queue forever. Returns what is left.
 */
export async function flush(
  queue: Mutation[],
  send: (m: Mutation) => Promise<void>,
): Promise<Mutation[]> {
  for (let i = 0; i < queue.length; i++) {
    try {
      await send(queue[i]);
    } catch (e) {
      if (e instanceof PermanentError) {
        console.warn('Dropping mutation the server rejected', queue[i].op, e.message);
        continue;
      }
      return queue.slice(i);
    }
  }
  return [];
}
