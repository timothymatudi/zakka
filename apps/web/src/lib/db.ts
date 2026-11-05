import 'server-only';
import { config, hasSupabase } from './config';

/**
 * Minimal Supabase PostgREST client (no SDK, keeps the bundle small).
 * Only used server-side with the service role key. Returns null when Supabase is not configured
 * or the call fails, so callers can fall back to mock storage.
 */
export async function dbInsert<T = unknown>(table: string, rows: object | object[]): Promise<T[] | null> {
  if (!hasSupabase()) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[db] insert ${table} failed`, res.status, await res.text());
      return null;
    }
    return (await res.json()) as T[];
  } catch (err) {
    console.error(`[db] insert ${table} error`, err);
    return null;
  }
}

export async function dbSelect<T = unknown>(table: string, query: string): Promise<T[] | null> {
  if (!hasSupabase()) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
      },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T[];
  } catch {
    return null;
  }
}
