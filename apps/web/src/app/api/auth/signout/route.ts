import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, signOutRemote } from '@/lib/auth-core';
import { sameOrigin, setSessionCookies } from '@/lib/auth';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 });
  const jar = await cookies();
  await signOutRemote(jar.get(ACCESS_COOKIE)?.value ?? '');
  const res = NextResponse.json({ ok: true });
  setSessionCookies(res.cookies, null);
  return res;
}
