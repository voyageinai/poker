import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { createUser, getUserByUsername, countUsers, getInviteCode, consumeInviteCode } from '@/db/queries';
import { signToken } from '@/lib/auth';
import { AUTH_COOKIE_NAME, getAuthCookiePath } from '@/lib/runtime-config';
import { audit } from '@/db/audit';

export async function POST(req: NextRequest) {
  const { username, password, inviteCode } = await req.json() as {
    username?: string;
    password?: string;
    inviteCode?: string;
  };

  if (!username || !password) {
    return NextResponse.json({ error: 'username and password required' }, { status: 400 });
  }

  if (getUserByUsername(username)) {
    return NextResponse.json({ error: 'Username taken' }, { status: 409 });
  }

  // Validate invite code
  const envCode = process.env.INVITE_CODE;
  let codeValid = inviteCode === envCode;

  if (!codeValid && inviteCode) {
    const code = getInviteCode(inviteCode);
    if (code && !code.used_by && (!code.expires_at || code.expires_at > Date.now() / 1000)) {
      codeValid = true;
    }
  }

  if (!codeValid) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 403 });
  }

  const id = nanoid();
  const role = countUsers() === 0 ? 'admin' : 'user';
  const passwordHash = await bcrypt.hash(password, 10);

  createUser(id, username, passwordHash, role);

  if (inviteCode && inviteCode !== envCode) {
    consumeInviteCode(inviteCode, id);
  }

  audit({
    userId: id,
    category: 'account',
    action: 'register',
    detail: { username, role, inviteCode: inviteCode !== envCode ? inviteCode : undefined },
  });

  const token = signToken({ userId: id, username, role });
  const res = NextResponse.json({ ok: true, username, role });
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
