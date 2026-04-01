import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByUsername, maybeRefreshChips } from '@/db/queries';
import { signToken } from '@/lib/auth';
import { AUTH_COOKIE_NAME, getAuthCookiePath } from '@/lib/runtime-config';
import { audit } from '@/db/audit';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json() as { username?: string; password?: string };
  if (!username || !password) {
    return NextResponse.json({ error: 'username and password required' }, { status: 400 });
  }

  const user = getUserByUsername(username);
  if (!user) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

  if (user.banned) return NextResponse.json({ error: '账号已被封禁' }, { status: 403 });

  // Daily chip refresh on login
  const refresh = maybeRefreshChips(user.id);
  const currentChips = refresh.refreshed ? refresh.newBalance : user.chips;

  audit({
    userId: user.id,
    category: 'account',
    action: 'login',
    detail: { username: user.username },
  });

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  const res = NextResponse.json({ ok: true, username: user.username, role: user.role, chips: currentChips });
  const isSecure = req.headers.get('x-forwarded-proto') === 'https' || req.url.startsWith('https');
  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 7 * 86400,
    path: getAuthCookiePath(),
  });
  return res;
}
