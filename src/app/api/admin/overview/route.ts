import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import {
  countUsers, sumAllChips, recentCompletedHands,
  getTreasuryBalance, sumPlayerChips, sumSystemBotChips, totalRakeCollected,
  TOTAL_SUPPLY,
} from '@/db/queries';
import { getActiveTableCount, getOnlinePlayerCount, getInPlayChips } from '@/server/table-manager';

export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const treasury = getTreasuryBalance();
  const playerChips = sumPlayerChips();
  const botChips = sumSystemBotChips();
  const inPlay = getInPlayChips();

  return NextResponse.json({
    activeTables: getActiveTableCount(),
    onlinePlayers: getOnlinePlayerCount(),
    totalUsers: countUsers(),
    totalChips: sumAllChips(),
    recentHands: recentCompletedHands(10),
    // Economy breakdown
    economy: {
      totalSupply: TOTAL_SUPPLY,
      treasury,
      playerChips,
      botChips,
      inPlay,
      totalRake: totalRakeCollected(),
    },
  });
}
