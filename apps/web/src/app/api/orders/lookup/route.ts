import { NextResponse, type NextRequest } from 'next/server';
import { isLocale } from '@/i18n/routing';

/** Turns the lookup form into a clean /{locale}/orders/{id} URL. */
export function GET(req: NextRequest) {
  const l = req.nextUrl.searchParams.get('l') ?? 'en';
  const locale = isLocale(l) ? l : 'en';
  const id = (req.nextUrl.searchParams.get('id') ?? '').trim().toLowerCase();
  const safe = /^[0-9a-f-]{36}$/.test(id) ? id : 'not-found';
  return NextResponse.redirect(new URL(`/${locale}/orders/${safe}`, req.url));
}
