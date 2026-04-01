import { NextRequest, NextResponse } from 'next/server';
import { getHandsByTable } from '@/db/queries';

export async function GET(req: NextRequest) {
  const tableId = new URL(req.url).searchParams.get('tableId');
  if (!tableId) return NextResponse.json({ error: 'tableId required' }, { status: 400 });

  const hands = getHandsByTable(tableId, 50);
  return NextResponse.json(hands);
}
