import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing, isLocale } from './i18n/routing';
import { newNonce, pageCsp } from './lib/csp';
import { ACCESS_COOKIE, REFRESH_COOKIE, authMode, fetchUser, isAdmin, isExpired, refreshSession, sessionCookies } from './lib/auth-core';

const intl = createMiddleware(routing);

/** /{locale}/admin/... (the admin API is guarded in each route handler with requireAdmin). */
const isAdminPage = (path: string) => /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(path);

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
}

export default async function middleware(req: NextRequest) {
  const path = decodePath(req.nextUrl.pathname);

  // Refresh an expiring session before pages render (server components cannot save rotated tokens),
  // then reload the same URL so the page sees the new cookies.
  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value ?? '';
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value ?? '';
  if (req.method === 'GET' && refreshToken && (!accessToken || isExpired(accessToken))) {
    const session = await refreshSession(refreshToken);
    const res = NextResponse.redirect(req.nextUrl);
    for (const c of sessionCookies(session)) res.cookies.set(c.name, c.value, c.options);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  // Admin pages: Supabase user with app_metadata.role = 'admin' (contract, lead decision).
  if (isAdminPage(path)) {
    if (authMode() === 'off') return new NextResponse('Not found', { status: 404 });
    const user = await fetchUser(accessToken);
    if (!user) {
      const first = path.split('/')[1] ?? '';
      const locale = isLocale(first) ? first : routing.defaultLocale;
      const url = new URL(`/${locale}/signin`, req.url);
      url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(url);
    }
    if (!isAdmin(user)) return new NextResponse('Not found', { status: 404 });
  }

  // Every page gets its own script nonce. Next.js reads the policy from the request headers and puts
  // the nonce on the scripts it renders; the browser enforces the same policy from the response.
  const nonce = newNonce();
  const csp = pageCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = intl(new NextRequest(req, { headers }));
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Pages only (no API routes, Next internals, files, image redirects or feeds).
  matcher: ['/((?!api|_next|_vercel|img/|feeds/|sitemaps/|.*\\..*).*)'],
};
