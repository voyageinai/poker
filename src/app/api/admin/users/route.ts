import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { listAllUsers } from '@/db/queries';

export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const search = req.nextUrl.searchParams.get('search') ?? undefined;
  const users = listAllUsers(search).map(({ password_hash: _pw, ...rest }) => rest);

  return NextResponse.json(users);
}
