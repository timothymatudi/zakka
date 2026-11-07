/**
 * Supabase Auth over its REST API (no SDK). Runs in middleware (edge) and on the server, so it must not
 * import `server-only` modules and reads env vars directly.
 *
 * Sign-in is an email one-time code: POST /auth/v1/otp sends it, POST /auth/v1/verify swaps it for a session.
 * The access and refresh tokens live in httpOnly cookies. The user (and `app_metadata.role`) is always read
 * back from GET /auth/v1/user, never trusted from the cookie, because app_metadata is only writable by Supabase.
 *
 * Mock mode (SUPABASE_URL or SUPABASE_ANON_KEY empty, and not production): any email signs in with the code
 * 000000. Emails starting with `admin@` get the admin role. In production without Supabase, sign-in is off.
 */

export const ACCESS_COOKIE = 'zk_at';
export const REFRESH_COOKIE = 'zk_rt';
export const MOCK_CODE = '000000';
const MOCK_PREFIX = 'mock.';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export interface AuthUser {
  id: string;
  email: string | null;
  app_metadata?: { role?: string };
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
}

const trimSlash = (v: string | undefined) => (v ?? '').replace(/\/+$/, '');
const supabaseUrl = () => trimSlash(process.env.SUPABASE_URL);
const anonKey = () => process.env.SUPABASE_ANON_KEY ?? '';

export type AuthMode = 'supabase' | 'mock' | 'off';
export function authMode(): AuthMode {
  if (supabaseUrl() && anonKey()) return 'supabase';
  return process.env.NODE_ENV === 'production' ? 'off' : 'mock';
}

export const isAdmin = (user: AuthUser | null | undefined) => user?.app_metadata?.role === 'admin';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function gotrue<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(`${supabaseUrl()}/auth/v1${path}`, {
      ...init,
      headers: {
        apikey: anonKey(),
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 503, data: null };
  }
}

// ---- mock -------------------------------------------------------------------------------------------

function mockUser(email: string): AuthUser {
  // Stable fake uuid derived from the email, so the mock user keeps the same id across sign-ins.
  let h = 0x811c9dc5;
  for (const ch of email) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return {
    id: `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`,
    email,
    app_metadata: email.startsWith('admin@') ? { role: 'admin' } : {},
  };
}

function mockSession(email: string): AuthSession {
  const token = MOCK_PREFIX + btoa(email);
  return { access_token: token, refresh_token: token, expires_in: 60 * 60 * 24, user: mockUser(email) };
}

function mockEmail(token: string): string | null {
  if (authMode() !== 'mock' || !token.startsWith(MOCK_PREFIX)) return null;
  try {
    const email = atob(token.slice(MOCK_PREFIX.length));
    return EMAIL_RE.test(email) ? email : null;
  } catch {
    return null;
  }
}

// ---- API --------------------------------------------------------------------------------------------

/** Sends a one-time sign-in code by email. Creates the auth user on first sign-in. */
export async function sendEmailOtp(email: string): Promise<{ ok: boolean; status: number }> {
  const mode = authMode();
  if (mode === 'off') return { ok: false, status: 503 };
  if (mode === 'mock') return { ok: true, status: 200 };
  const res = await gotrue('/otp', { method: 'POST', body: JSON.stringify({ email, create_user: true }) });
  return { ok: res.ok, status: res.status };
}

export async function verifyEmailOtp(email: string, code: string): Promise<AuthSession | null> {
  const mode = authMode();
  if (mode === 'off') return null;
  if (mode === 'mock') return code === MOCK_CODE ? mockSession(email) : null;
  const res = await gotrue<AuthSession>('/verify', { method: 'POST', body: JSON.stringify({ email, token: code, type: 'email' }) });
  return res.ok && res.data?.access_token ? res.data : null;
}

export async function refreshSession(refreshToken: string): Promise<AuthSession | null> {
  const email = mockEmail(refreshToken);
  if (email) return mockSession(email);
  if (authMode() !== 'supabase') return null;
  const res = await gotrue<AuthSession>('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return res.ok && res.data?.access_token ? res.data : null;
}

/** Short cache so one page render does not call GoTrue once per component. */
const userCache = new Map<string, { user: AuthUser | null; until: number }>();
const USER_CACHE_MS = 30_000;

/** Looks the token's user up on Supabase (authoritative). Null when the token is invalid or expired. */
export async function fetchUser(accessToken: string): Promise<AuthUser | null> {
  if (!accessToken) return null;
  const email = mockEmail(accessToken);
  if (email) return mockUser(email);
  if (authMode() !== 'supabase' || accessToken.startsWith(MOCK_PREFIX)) return null;
  if (isExpired(accessToken, 0)) return null;
  const hit = userCache.get(accessToken);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await gotrue<AuthUser>('/user', { token: accessToken });
  const user = res.ok && res.data?.id ? res.data : null;
  // Do not cache outages as "signed out".
  if (res.ok || res.status === 401 || res.status === 403) {
    if (userCache.size > 500) userCache.clear();
    userCache.set(accessToken, { user, until: Date.now() + USER_CACHE_MS });
  }
  return user;
}

export async function signOutRemote(accessToken: string): Promise<void> {
  userCache.delete(accessToken);
  if (authMode() !== 'supabase' || !accessToken || accessToken.startsWith(MOCK_PREFIX)) return;
  await gotrue('/logout', { method: 'POST', token: accessToken });
}

/** Reads `exp` from a JWT without verifying it. Only used to decide when to refresh. */
export function isExpired(token: string, skewSeconds = 60): boolean {
  if (token.startsWith(MOCK_PREFIX)) return false;
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return !json.exp || json.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}

export interface CookieSpec {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/'; maxAge: number };
}

/** Cookies that store a session (or clear it when `session` is null). */
export function sessionCookies(session: AuthSession | null): CookieSpec[] {
  const base = { httpOnly: true as const, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' as const };
  return [
    { name: ACCESS_COOKIE, value: session?.access_token ?? '', options: { ...base, maxAge: session ? Math.max(60, session.expires_in) : 0 } },
    { name: REFRESH_COOKIE, value: session?.refresh_token ?? '', options: { ...base, maxAge: session ? REFRESH_MAX_AGE : 0 } },
  ];
}

/** Only same-site relative paths are allowed as post-sign-in destinations. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
