import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { STAKE_LEVELS, getStakeLevel, type StakeLevelId } from '@/lib/stake-levels';
import { getOrCreateTableForLevel, getLevelPlayerCounts } from '@/server/table-manager';

/**
 * GET /api/tables — Return per-level aggregate info for the lobby.
 */
export async function GET() {
  const counts = getLevelPlayerCounts();
  const levels = STAKE_LEVELS.map(level => ({
    ...level,
    playerCount: counts[level.id] ?? 0,
  }));
  return NextResponse.json(levels);
}

/**
 * POST /api/tables — Find or create a table for the given stake level.
 * Body: { level: StakeLevelId }
 * Returns: { id: string }
 */
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { level?: string };
  const levelId = body.level as StakeLevelId;

  if (!levelId || !getStakeLevel(levelId)) {
    return NextResponse.json({ error: '无效的级别' }, { status: 400 });
  }

  try {
    const tableId = getOrCreateTableForLevel(levelId, user.userId);
    return NextResponse.json({ id: tableId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
