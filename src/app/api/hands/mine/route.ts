import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getHandsByUserId, getPlayerStats } from '@/db/queries';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : 1;
  const pageSize = url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : 30;

  const hands = getHandsByUserId(user.userId, { page, pageSize });
  const stats = getPlayerStats(user.userId);

  return NextResponse.json({ ...hands, stats });
}
