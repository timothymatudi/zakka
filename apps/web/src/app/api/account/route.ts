import { NextResponse } from 'next/server';
import { isLocale } from '@/i18n/routing';
import { COUNTRY_CODES, COUNTRY_COOKIE } from '@/lib/markets';

interface Body {
  locale?: string;
  country?: string;
  phone?: string;
  whatsapp_opt_in?: boolean;
  marketing_opt_in?: boolean;
}

/**
 * Saves preferences. Mock: cookies only.
 * TODO(live, needs auth): update the signed-in customer's own row via Supabase with the user's JWT.
 * Per the contract, customers may only update locale, country_code, whatsapp_opt_in,
 * whatsapp_opt_in_at and marketing_opt_in. whatsapp_opt_in_at is stamped when opting in.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const country = (body.country ?? '').toUpperCase();
  const update = {
    locale: body.locale && isLocale(body.locale) ? body.locale : undefined,
    country_code: COUNTRY_CODES.includes(country) ? country : undefined,
    whatsapp_opt_in: body.whatsapp_opt_in === true,
    whatsapp_opt_in_at: body.whatsapp_opt_in === true ? new Date().toISOString() : null,
    marketing_opt_in: body.marketing_opt_in === true,
  };
  const res = NextResponse.json({ ok: true, mode: 'mock', saved: update });
  if (update.country_code) {
    res.cookies.set(COUNTRY_COOKIE, update.country_code, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  }
  return res;
}
