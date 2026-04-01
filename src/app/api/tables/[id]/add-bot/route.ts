import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getBotById, getTableById } from '@/db/queries';
import { getOrCreateTableManager } from '@/server/table-manager';
import { isSystemBotRecord } from '@/lib/system-bots';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: tableId } = await params;
  const table = getTableById(tableId);
  if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 });

  const body = await req.json() as { botId?: string; buyin?: number; seatIndex?: number };
  if (!body.botId) return NextResponse.json({ error: 'botId required' }, { status: 400 });

  const bot = getBotById(body.botId);
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  if (bot.status !== 'active') return NextResponse.json({ error: `Bot status is "${bot.status}", must be "active"` }, { status: 400 });
  if (!isSystemBotRecord(bot) && bot.user_id !== user.userId && user.role !== 'admin') {
    return NextResponse.json({ error: 'You can only seat your own bots' }, { status: 403 });
  }

  const buyin = body.buyin ?? table.min_buyin;
  if (buyin < table.min_buyin || buyin > table.max_buyin) {
    return NextResponse.json({ error: `Buy-in must be between ${table.min_buyin} and ${table.max_buyin}` }, { status: 400 });
  }

  const mgr = getOrCreateTableManager(tableId);
  if (!mgr) return NextResponse.json({ error: 'Could not load table' }, { status: 500 });

  try {
    const seat = mgr.joinBot(bot.user_id, bot.id, bot.name, bot.binary_path, buyin, body.seatIndex);
    return NextResponse.json({ seat, botId: bot.id, botName: bot.name });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
