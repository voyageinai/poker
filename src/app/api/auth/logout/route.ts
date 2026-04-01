import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getAuthCookiePath } from '@/lib/runtime-config';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 0,
    path: getAuthCookiePath(),
  });
  return res;
}
