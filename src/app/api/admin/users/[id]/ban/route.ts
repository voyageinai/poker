import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getUserById, updateUserBanned } from '@/db/queries';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  if (admin.userId === id) {
    return NextResponse.json({ error: 'Cannot ban yourself' }, { status: 400 });
  }

  const user = getUserById(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const newBanned = user.banned ? 0 : 1;
  updateUserBanned(id, newBanned);

  audit({
    userId: admin.userId,
    category: 'admin',
    action: newBanned ? 'ban_user' : 'unban_user',
    targetId: id,
    detail: { targetUsername: user.username },
  });

  return NextResponse.json({ ok: true, banned: newBanned === 1 });
}
