import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getTableManager } from '@/server/table-manager';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: tableId } = await params;
  const mgr = getTableManager(tableId);
  mgr?.leave(user.userId);
  return NextResponse.json({ ok: true });
}
