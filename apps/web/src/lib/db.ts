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

const serviceHeaders = () => ({
  apikey: config.supabaseServiceKey,
  Authorization: `Bearer ${config.supabaseServiceKey}`,
  'Content-Type': 'application/json',
});

/** Service-role write (PATCH / DELETE / upsert POST). Returns the affected rows, or null on failure. */
export async function dbWrite<T = unknown>(
  method: 'PATCH' | 'DELETE' | 'POST',
  table: string,
  query: string,
  body?: object | object[],
  prefer = 'return=representation',
): Promise<T[] | null> {
  if (!hasSupabase()) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method,
      headers: { ...serviceHeaders(), Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[db] ${method} ${table} failed`, res.status, await res.text());
      return null;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : []) as T[];
  } catch (err) {
    console.error(`[db] ${method} ${table} error`, err);
    return null;
  }
}

/** Exact row count for `table?filter`, or null when Supabase is unavailable. */
export async function dbCount(table: string, filter = ''): Promise<number | null> {
  if (!hasSupabase()) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=id${filter ? `&${filter}` : ''}`, {
      method: 'HEAD',
      headers: { ...serviceHeaders(), Prefer: 'count=exact' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    const total = res.headers.get('content-range')?.split('/')[1];
    return res.ok && total && total !== '*' ? Number(total) : null;
  } catch {
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
