import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getBotById, getEloHistory } from '@/db/queries';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bot = getBotById(id);
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const user = getUserFromRequest(req);
  // Hide binary path from non-owners
  if (user?.userId !== bot.user_id && user?.role !== 'admin') {
    return NextResponse.json({ ...bot, binary_path: undefined });
  }

  const eloHistory = getEloHistory(id, 50);
  return NextResponse.json({ ...bot, eloHistory });
}
