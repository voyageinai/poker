import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getUserById, updateUserRole } from '@/db/queries';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json() as { role?: string };
  const role = body.role;

  if (role !== 'admin' && role !== 'user') {
    return NextResponse.json({ error: 'role must be "admin" or "user"' }, { status: 400 });
  }

  if (admin.userId === id && role === 'user') {
    return NextResponse.json({ error: 'Cannot demote yourself' }, { status: 400 });
  }

  const user = getUserById(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  updateUserRole(id, role);

  audit({
    userId: admin.userId,
    category: 'admin',
    action: 'change_role',
    targetId: id,
    detail: { targetUsername: user.username, from: user.role, to: role },
  });

  return NextResponse.json({ ok: true, role });
}
