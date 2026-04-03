import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { forceCloseTable } from '@/server/table-manager';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const ok = forceCloseTable(id);
  if (!ok) return NextResponse.json({ error: '桌子不存在或已关闭' }, { status: 404 });

  audit({
    userId: admin.userId,
    category: 'admin',
    action: 'force_close_table',
    targetId: id,
    detail: {},
    ip: req.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ success: true });
}
