import { NextRequest, NextResponse } from 'next/server';
import { getTableById, getHandsByTable } from '@/db/queries';
import { getUserFromRequest } from '@/lib/auth';
import { getOrCreateTableManager } from '@/server/table-manager';
import { toClientState } from '@/server/poker/state-machine';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const table = getTableById(id);
  if (!table) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const mgr = getOrCreateTableManager(id);
  const state = mgr?.getState();
  const recentHands = getHandsByTable(id, 10);
  const user = getUserFromRequest(req);

  return NextResponse.json({
    table,
    state: state ? toClientState(state, user?.userId ?? null) : null,
    recentHands,
  });
}
