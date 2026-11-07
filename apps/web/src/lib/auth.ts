import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  fetchUser,
  isAdmin,
  isExpired,
  refreshSession,
  sessionCookies,
  type AuthSession,
  type AuthUser,
} from './auth-core';
import { config, hasSupabase } from './config';
import { dbInsert, dbSelect, dbWrite } from './db';

export interface Session {
  user: AuthUser;
  accessToken: string;
}

/**
 * Current user for server components (read-only: never refreshes, because a rotated refresh token
 * could not be saved from here). Middleware refreshes expiring tokens before pages render.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value ?? '';
  const user = await fetchUser(accessToken);
  return user ? { user, accessToken } : null;
}

/** For route handlers: also refreshes an expired session and saves the new cookies. */
export async function getSessionForRoute(): Promise<Session | null> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value ?? '';
  if (accessToken && !isExpired(accessToken)) {
    const user = await fetchUser(accessToken);
    if (user) return { user, accessToken };
  }
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;
  const session = await refreshSession(refreshToken);
  setSessionCookies(jar, session);
  return session ? { user: session.user, accessToken: session.access_token } : null;
}

type Jar = Awaited<ReturnType<typeof cookies>>;
export function setSessionCookies(jar: Jar | NextResponse['cookies'], session: AuthSession | null) {
  for (const c of sessionCookies(session)) jar.set(c.name, c.value, c.options);
}

/**
 * Rejects cross-site writes. Cookies are SameSite=Lax already; this also covers same-site subdomains.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    return new URL(origin).host === new URL(req.url).host || origin === config.webBaseUrl;
  } catch {
    return false;
  }
}

/** Route-handler guard for /api/admin/*. Returns the admin session, or the error response to send. */
export async function requireAdmin(req: Request): Promise<Session | NextResponse> {
  if (req.method !== 'GET' && !sameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 });
  const session = await getSessionForRoute();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!isAdmin(session.user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return session;
}

// ---- customers row ----------------------------------------------------------------------------------

export interface CustomerPrefs {
  id: string;
  email: string | null;
  phone_e164: string | null;
  locale: string | null;
  country_code: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  marketing_opt_in: boolean;
}

export const CUSTOMER_COLUMNS = 'id,email,phone_e164,locale,country_code,whatsapp_opt_in,whatsapp_opt_in_at,marketing_opt_in';

/**
 * Makes sure the signed-in user has a `customers` row (service role: customers cannot insert their own).
 * An existing row with the same email and no auth user (e.g. from a guest checkout) is linked instead.
 */
export async function ensureCustomer(user: AuthUser, defaults: { locale?: string; country_code?: string }): Promise<void> {
  if (!hasSupabase()) return;
  const uid = encodeURIComponent(user.id);
  const existing = await dbSelect<{ id: string }>('customers', `auth_user_id=eq.${uid}&select=id`);
  if (!existing || existing.length) return;
  if (user.email) {
    const email = encodeURIComponent(user.email.toLowerCase());
    const linked = await dbWrite('PATCH', 'customers', `email=eq.${email}&auth_user_id=is.null`, { auth_user_id: user.id });
    if (linked?.length) return;
  }
  await dbInsert('customers', {
    auth_user_id: user.id,
    email: user.email?.toLowerCase() ?? null,
    locale: defaults.locale ?? null,
    country_code: defaults.country_code ?? null,
  });
}

/** PostgREST call as the signed-in user (anon key + user JWT), so RLS and column grants apply. */
export async function asUser<T>(session: Session, method: 'GET' | 'PATCH', path: string, body?: object): Promise<T[] | null> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[auth] ${method} ${path.split('?')[0]} as user failed`, res.status, await res.text());
      return null;
    }
    return (await res.json()) as T[];
  } catch (err) {
    console.error('[auth] as-user request error', err);
    return null;
  }
}

export async function getOwnCustomer(session: Session): Promise<CustomerPrefs | null> {
  const rows = await asUser<CustomerPrefs>(session, 'GET', `customers?auth_user_id=eq.${encodeURIComponent(session.user.id)}&select=${CUSTOMER_COLUMNS}`);
  return rows?.[0] ?? null;
}
