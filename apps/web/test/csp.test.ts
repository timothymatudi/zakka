import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { freshEnv } from './helpers';

const visit = async (path: string) => {
  const { default: middleware } = await import('@/middleware');
  return middleware(new NextRequest(`http://localhost:3000${path}`));
};
const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

describe('content security policy', () => {
  it('gives every page response its own script nonce', async () => {
    freshEnv({ NODE_ENV: 'production' });
    const a = (await visit('/en/search')).headers.get('content-security-policy');
    const b = (await visit('/en/search')).headers.get('content-security-policy');
    expect(nonceOf(a)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(nonceOf(b)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it('does not allow inline scripts or eval in production', async () => {
    freshEnv({ NODE_ENV: 'production' });
    const csp = (await visit('/en'))!.headers.get('content-security-policy')!;
    const scripts = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('passes the same nonce to the page through the request headers', async () => {
    freshEnv({ NODE_ENV: 'production' });
    const res = await visit('/en');
    // Next.js forwards overridden request headers as x-middleware-request-<name>.
    const forwarded = res.headers.get('x-middleware-request-content-security-policy');
    expect(nonceOf(forwarded)).toBe(nonceOf(res.headers.get('content-security-policy')));
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(forwarded));
  });

  it('allows eval only in development (React needs it for debugging)', async () => {
    freshEnv({ NODE_ENV: 'development' });
    expect((await visit('/en')).headers.get('content-security-policy')).toContain("'unsafe-eval'");
  });
});
