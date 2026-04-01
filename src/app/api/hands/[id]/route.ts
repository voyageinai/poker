import { NextRequest, NextResponse } from 'next/server';
import { getHandById, getHandPlayers, getHandActions, getUserById, getBotById } from '@/db/queries';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const hand = getHandById(id);
  if (!hand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const players = getHandPlayers(id);
  const actions = getHandActions(id);

  // Build a name map: seat_index → display name
  const nameMap: Record<number, string> = {};
  const kindMap: Record<number, 'human' | 'bot'> = {};
  for (const p of players) {
    if (p.bot_id) {
      const bot = getBotById(p.bot_id);
      nameMap[p.seat_index] = bot?.name ?? p.user_id.slice(0, 8);
      kindMap[p.seat_index] = 'bot';
    } else {
      const user = getUserById(p.user_id);
      nameMap[p.seat_index] = user?.username ?? p.user_id.slice(0, 8);
      kindMap[p.seat_index] = 'human';
    }
  }

  return NextResponse.json({
    hand,
    players,
    actions,
    nameMap,
    kindMap,
  });
}
