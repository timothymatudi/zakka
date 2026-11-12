import { NextResponse } from 'next/server';
import { EMAIL_RE, authMode, sendEmailOtp } from '@/lib/auth-core';
import { sameOrigin } from '@/lib/auth';
import { tooMany } from '@/lib/rate-limit';

/** Step 1 of sign-in: email a one-time code. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 });
  const limited = tooMany(req, 'otp', 5);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  const res = await sendEmailOtp(email);
  if (res.ok) return NextResponse.json({ ok: true, mode: authMode() });
  const error = res.status === 429 ? 'rate_limited' : authMode() === 'off' ? 'auth_disabled' : 'send_failed';
  return NextResponse.json({ error }, { status: res.status === 429 ? 429 : 502 });
}
