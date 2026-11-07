import { NextResponse } from 'next/server';
import { isLocale } from '@/i18n/routing';
import { COUNTRY_CODES, COUNTRY_COOKIE } from '@/lib/markets';
import { CUSTOMER_COLUMNS, asUser, ensureCustomer, getOwnCustomer, getSessionForRoute, sameOrigin, type CustomerPrefs } from '@/lib/auth';
import { hasSupabase } from '@/lib/config';

interface Body {
  locale?: string;
  country?: string;
  whatsapp_opt_in?: boolean;
  marketing_opt_in?: boolean;
}

/**
 * Saves preferences. Signed in with Supabase: updates the customer's own row with their JWT, so RLS and the
 * column grants apply (only locale, country_code, whatsapp_opt_in, whatsapp_opt_in_at, marketing_opt_in).
 * Otherwise (guest or mock): cookies only.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const country = (body.country ?? '').toUpperCase();
  const prefs = {
    locale: body.locale && isLocale(body.locale) ? body.locale : undefined,
    country_code: COUNTRY_CODES.includes(country) ? country : undefined,
    whatsapp_opt_in: body.whatsapp_opt_in === true,
    marketing_opt_in: body.marketing_opt_in === true,
  };

  let mode: 'db' | 'cookie' = 'cookie';
  const session = await getSessionForRoute();
  if (session && hasSupabase()) {
    let current = await getOwnCustomer(session);
    if (!current) {
      await ensureCustomer(session.user, { locale: prefs.locale, country_code: prefs.country_code });
      current = await getOwnCustomer(session);
    }
    if (!current) return NextResponse.json({ error: 'save_failed' }, { status: 502 });
    const update: Partial<CustomerPrefs> = { ...prefs };
    // Keep the original opt-in time; stamp it only when the customer opts in now, clear it on opt-out.
    if (!prefs.whatsapp_opt_in) update.whatsapp_opt_in_at = null;
    else if (!current.whatsapp_opt_in || !current.whatsapp_opt_in_at) update.whatsapp_opt_in_at = new Date().toISOString();
    for (const k of Object.keys(update) as (keyof typeof update)[]) if (update[k] === undefined) delete update[k];
    const saved = await asUser<CustomerPrefs>(
      session,
      'PATCH',
      `customers?id=eq.${current.id}&select=${CUSTOMER_COLUMNS}`,
      update,
    );
    if (!saved?.length) return NextResponse.json({ error: 'save_failed' }, { status: 502 });
    mode = 'db';
  }

  const res = NextResponse.json({ ok: true, mode, saved: prefs });
  if (prefs.country_code) {
    res.cookies.set(COUNTRY_COOKIE, prefs.country_code, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  }
  return res;
}
