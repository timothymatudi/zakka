import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { cookieJar, freshEnv, jsonRequest, mockToken } from './helpers';

const ORIGIN = 'http://localhost:3000';

describe('auth mode', () => {
  it('is mock in development and off in production without Supabase', async () => {
    freshEnv({ NODE_ENV: 'development' });
    expect((await import('@/lib/auth-core')).authMode()).toBe('mock');
    freshEnv({ NODE_ENV: 'production' });
    expect((await import('@/lib/auth-core')).authMode()).toBe('off');
  });

  it('is supabase when the URL and anon key are set', async () => {
    freshEnv({ NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    expect((await import('@/lib/auth-core')).authMode()).toBe('supabase');
  });

  it('never accepts a mock token in production', async () => {
    freshEnv({ NODE_ENV: 'production' });
    const { fetchUser, verifyEmailOtp } = await import('@/lib/auth-core');
    expect(await fetchUser(mockToken('admin@zakka.test'))).toBeNull();
    expect(await verifyEmailOtp('admin@zakka.test', '000000')).toBeNull();
    freshEnv({ NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    expect(await (await import('@/lib/auth-core')).fetchUser(mockToken('admin@zakka.test'))).toBeNull();
  });
});

describe('auth helpers', () => {
  beforeEach(() => freshEnv({ NODE_ENV: 'development' }));

  it('safeNext only allows same-site paths', async () => {
    const { safeNext } = await import('@/lib/auth-core');
    expect(safeNext('/en/orders', '/en')).toBe('/en/orders');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'orders', '', null, undefined]) {
      expect(safeNext(bad, '/en')).toBe('/en');
    }
  });

  it('isExpired reads the token expiry and treats garbage as expired', async () => {
    const { isExpired } = await import('@/lib/auth-core');
    const jwt = (exp: number) => `h.${btoa(JSON.stringify({ exp }))}.s`;
    const now = Math.floor(Date.now() / 1000);
    expect(isExpired(jwt(now + 3600))).toBe(false);
    expect(isExpired(jwt(now + 30))).toBe(true); // inside the 60s refresh margin
    expect(isExpired(jwt(now - 10))).toBe(true);
    expect(isExpired('not-a-token')).toBe(true);
  });

  it('session cookies are httpOnly, and secure in production', async () => {
    const { sessionCookies } = await import('@/lib/auth-core');
    for (const c of sessionCookies(null)) expect(c.options).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 0, secure: false });
    freshEnv({ NODE_ENV: 'production' });
    for (const c of (await import('@/lib/auth-core')).sessionCookies(null)) expect(c.options.secure).toBe(true);
  });
});

describe('sign-in by email code (mock mode)', () => {
  beforeEach(() => freshEnv({ NODE_ENV: 'development' }));
  const verify = async (payload: unknown, headers?: Record<string, string>) => {
    const { POST } = await import('@/app/api/auth/verify/route');
    return POST(jsonRequest(`${ORIGIN}/api/auth/verify`, payload, headers));
  };

  it('rejects a wrong code and sets no session', async () => {
    const res = await verify({ email: 'sam@zakka.test', code: '123456' });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects malformed input', async () => {
    expect((await verify({ email: 'not-an-email', code: '000000' })).status).toBe(400);
    expect((await verify({ email: 'sam@zakka.test', code: 'abc' })).status).toBe(400);
  });

  it('rejects another site', async () => {
    expect((await verify({ email: 'sam@zakka.test', code: '000000' }, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('signs in with the right code and marks only admin@ as admin', async () => {
    const res = await verify({ email: 'sam@zakka.test', code: '000000' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, admin: false });
    expect(res.headers.get('set-cookie')).toMatch(/zk_at=mock\./);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(await (await verify({ email: 'admin@zakka.test', code: '000000' })).json()).toEqual({ ok: true, admin: true });
  });

  it('is switched off in production without Supabase', async () => {
    freshEnv({ NODE_ENV: 'production' });
    expect((await verify({ email: 'admin@zakka.test', code: '000000' })).status).toBe(401);
  });
});

describe('admin API gate (requireAdmin)', () => {
  beforeEach(() => freshEnv({ NODE_ENV: 'development' }));
  const gate = async (init: RequestInit = {}) => {
    const { requireAdmin } = await import('@/lib/auth');
    const out = await requireAdmin(new Request(`${ORIGIN}/api/admin/markup-rules`, init));
    return out instanceof NextResponse ? out.status : 'allowed';
  };

  it('401 when signed out, 403 for a customer, allowed for an admin', async () => {
    expect(await gate()).toBe(401);
    cookieJar.set('zk_at', mockToken('sam@zakka.test'));
    expect(await gate()).toBe(403);
    cookieJar.set('zk_at', mockToken('admin@zakka.test'));
    expect(await gate()).toBe('allowed');
  });

  it('403 for an admin write coming from another site', async () => {
    cookieJar.set('zk_at', mockToken('admin@zakka.test'));
    expect(await gate({ method: 'POST', headers: { origin: 'https://evil.example' } })).toBe(403);
    expect(await gate({ method: 'POST', headers: { origin: ORIGIN } })).toBe('allowed');
  });
});

describe('admin page gate (middleware)', () => {
  const visit = async (path: string, email?: string) => {
    const { default: middleware } = await import('@/middleware');
    const headers = email ? { cookie: `zk_at=${mockToken(email)}` } : undefined;
    return middleware(new NextRequest(`${ORIGIN}${path}`, { headers }));
  };

  it('sends a signed-out visitor to sign-in and remembers where they were going', async () => {
    freshEnv({ NODE_ENV: 'development' });
    const res = await visit('/de/admin/orders?page=2');
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/de/signin');
    expect(to.searchParams.get('next')).toBe('/de/admin/orders?page=2');
  });

  it('hides admin pages from a signed-in customer', async () => {
    freshEnv({ NODE_ENV: 'development' });
    expect((await visit('/en/admin', 'sam@zakka.test')).status).toBe(404);
    expect((await visit('/en/ADMIN/orders', 'sam@zakka.test')).status).toBe(404);
    expect((await visit('/en/%61dmin', 'sam@zakka.test')).status).toBe(404);
  });

  it('lets an admin through', async () => {
    freshEnv({ NODE_ENV: 'development' });
    const res = await visit('/en/admin', 'admin@zakka.test');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('hides admin pages entirely in production without Supabase', async () => {
    freshEnv({ NODE_ENV: 'production' });
    expect((await visit('/en/admin', 'admin@zakka.test')).status).toBe(404);
  });

  it('leaves ordinary pages alone', async () => {
    freshEnv({ NODE_ENV: 'development' });
    expect((await visit('/en/search')).status).toBe(200);
  });
});
