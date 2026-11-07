import { NextResponse } from 'next/server';
import { EMAIL_RE, verifyEmailOtp } from '@/lib/auth-core';
import { ensureCustomer, sameOrigin, setSessionCookies } from '@/lib/auth';
import { isLocale } from '@/i18n/routing';
import { COUNTRY_CODES, COUNTRY_COOKIE } from '@/lib/markets';

/** Step 2 of sign-in: swap the emailed code for a session (httpOnly cookies) and make sure a customer row exists. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; code?: unknown; locale?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!EMAIL_RE.test(email) || !/^\d{6,10}$/.test(code)) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });

  const session = await verifyEmailOtp(email, code);
  if (!session) return NextResponse.json({ error: 'invalid_code' }, { status: 401 });

  const locale = typeof body?.locale === 'string' && isLocale(body.locale) ? body.locale : undefined;
  const cookieCountry = req.headers.get('cookie')?.match(new RegExp(`(?:^|; )${COUNTRY_COOKIE}=([A-Z]{2})`))?.[1];
  await ensureCustomer(session.user, {
    locale,
    country_code: cookieCountry && COUNTRY_CODES.includes(cookieCountry) ? cookieCountry : undefined,
  });

  const res = NextResponse.json({ ok: true, admin: session.user.app_metadata?.role === 'admin' });
  setSessionCookies(res.cookies, session);
  return res;
}
