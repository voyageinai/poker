import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getUserById, updateUserChips, deductTreasury, creditTreasury, getTreasuryBalance } from '@/db/queries';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json() as { amount?: number };
  const amount = body.amount;

  if (typeof amount !== 'number') {
    return NextResponse.json({ error: 'amount must be a number' }, { status: 400 });
  }

  const user = getUserById(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const newChips = Math.max(0, user.chips + amount);
  const diff = newChips - user.chips;
  const treasuryBefore = getTreasuryBalance();

  if (diff > 0) {
    // Giving chips → deduct from treasury
    if (!deductTreasury(diff)) {
      return NextResponse.json(
        { error: `国库余额不足 (当前: ${treasuryBefore.toLocaleString()})` },
        { status: 400 },
      );
    }
  } else if (diff < 0) {
    // Taking chips → credit to treasury
    creditTreasury(-diff);
  }

  updateUserChips(id, newChips);

  audit({
    userId: admin.userId,
    category: 'admin',
    action: 'adjust_chips',
    targetId: id,
    detail: {
      targetUsername: user.username,
      amount: diff,
      before: user.chips,
      after: newChips,
      treasuryBefore,
      treasuryAfter: getTreasuryBalance(),
    },
  });

  return NextResponse.json({ ok: true, chips: newChips });
}
