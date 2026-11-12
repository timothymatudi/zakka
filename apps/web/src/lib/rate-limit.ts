import 'server-only';
import { NextResponse } from 'next/server';

interface Bucket {
  count: number;
  reset: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/**
 * The caller's address as reported by the proxy in front of the app. Only as trustworthy as that proxy:
 * without one, a client can send any `x-forwarded-for` it likes.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Fixed-window limiter held in this server process. It slows down abuse from one address; it is not a
 * shared limit, so with several instances each one counts on its own. Put a shared store (or the host's
 * own rate limiting) in front for a hard guarantee.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfter: number } {
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count <= limit) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.reset - now) / 1000)) };
}

/** A 429 response when `name` was called more than `limit` times per minute from this address, else null. */
export function tooMany(req: Request, name: string, limit: number): NextResponse | null {
  const hit = rateLimit(`${name}:${clientIp(req)}`, limit, 60_000);
  if (hit.ok) return null;
  return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(hit.retryAfter) } });
}
