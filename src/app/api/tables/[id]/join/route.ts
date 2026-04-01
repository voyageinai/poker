import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getUserById, getTableById, updateUserChips, getBotById } from '@/db/queries';
import { getOrCreateTableManager } from '@/server/table-manager';
import { getStakeLevel, LEVEL_BOT_POOL, type StakeLevelId } from '@/lib/stake-levels';
import { SYSTEM_BOTS } from '@/lib/system-bots';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: tableId } = await params;
  const table = getTableById(tableId);
  if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 });

  const body = await req.json() as { buyin?: number; seatIndex?: number };
  const buyin = body.buyin ?? table.min_buyin;

  if (buyin < table.min_buyin || buyin > table.max_buyin) {
    return NextResponse.json(
      { error: `Buy-in must be between ${table.min_buyin} and ${table.max_buyin}` },
      { status: 400 },
    );
  }

  const dbUser = getUserById(user.userId);
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Level-based access control
  const level = table.level ? getStakeLevel(table.level) : null;
  if (level && dbUser.chips < level.minBalance) {
    return NextResponse.json(
      { error: `余额不足，该级别最低需要 ${level.minBalance} 筹码` },
      { status: 400 },
    );
  }

  if (dbUser.banned) return NextResponse.json({ error: '账号已被封禁' }, { status: 403 });
  if (dbUser.chips < buyin) return NextResponse.json({ error: '筹码不足' }, { status: 400 });

  const mgr = getOrCreateTableManager(tableId);
  if (!mgr) return NextResponse.json({ error: 'Could not load table' }, { status: 500 });

  try {
    const seat = mgr.joinHuman(user.userId, user.username, buyin, body.seatIndex);
    // Deduct buyin from user's account
    updateUserChips(user.userId, dbUser.chips - buyin);

    audit({
      userId: user.userId,
      category: 'chips',
      action: 'buyin',
      targetId: tableId,
      detail: { tableId, amount: buyin, balanceBefore: dbUser.chips, balanceAfter: dbUser.chips - buyin },
    });

    // Auto-fill empty seats with level-appropriate bots (shuffled)
    const pool = table.level ? LEVEL_BOT_POOL[table.level as StakeLevelId] ?? [] : [];
    const poolSet = new Set(pool);
    const activeBots = SYSTEM_BOTS
      .filter(b => poolSet.has(b.key) && (() => { const db_ = getBotById(b.botId); return db_ && db_.status === 'active'; })())
      .map(b => ({ botId: b.botId, userId: b.userId, name: b.name, binaryPath: b.binaryPath }));
    // Shuffle for variety
    for (let i = activeBots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [activeBots[i], activeBots[j]] = [activeBots[j], activeBots[i]];
    }
    mgr.autoFillBots(activeBots, table.min_buyin);

    return NextResponse.json({ seat });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
