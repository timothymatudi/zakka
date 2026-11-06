import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/** /{locale}/admin/... and /api/admin/... */
const isAdminPath = (path: string) => /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(path) || path.startsWith('/api/admin/');

/**
 * Admin gate (HTTP Basic, password in ADMIN_PASSWORD) until Supabase admin roles land.
 * With no password set, admin is reachable only in development.
 */
function adminGate(req: NextRequest): NextResponse | null {
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) {
    return process.env.NODE_ENV === 'development' ? null : new NextResponse('Admin is disabled', { status: 404 });
  }
  const header = req.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Basic ') ? atob(header.slice(6)).split(':').slice(1).join(':') : '';
  if (supplied.length === password.length && supplied === password) return null;
  return new NextResponse('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Zakka admin"' } });
}

export default function middleware(req: NextRequest) {
  const path = decodeURIComponent(req.nextUrl.pathname).toLowerCase();
  if (isAdminPath(path)) {
    const blocked = adminGate(req);
    if (blocked) return blocked;
  }
  return path.startsWith('/api/') ? NextResponse.next() : intl(req);
}

export const config = {
  // Pages (no API routes, Next internals or files), plus the admin API.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/api/admin/:path*'],
};
