import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminFromRequest } from '@/lib/auth';
import { listChipCodes, createChipCode, getTreasuryBalance } from '@/db/queries';
import { audit } from '@/db/audit';

export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const treasury = getTreasuryBalance();
  return NextResponse.json({ codes: listChipCodes(), treasury });
}

export async function POST(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { chips?: number; maxUses?: number; expiresIn?: number };

  if (typeof body.chips !== 'number' || body.chips <= 0) {
    return NextResponse.json({ error: 'chips must be a positive number' }, { status: 400 });
  }

  const chips = body.chips;
  const maxUses = body.maxUses ?? 1;
  const maxCost = chips * maxUses;
  const treasury = getTreasuryBalance();
  if (maxCost > treasury) {
    return NextResponse.json(
      { error: `国库余额不足: 最大消耗 ${maxCost.toLocaleString()} > 国库 ${treasury.toLocaleString()}` },
      { status: 400 },
    );
  }

  const code = nanoid(10).toUpperCase();
  const expiresAt = body.expiresIn ? Math.floor(Date.now() / 1000) + body.expiresIn : null;

  createChipCode(code, chips, admin.userId, maxUses, expiresAt);

  audit({
    userId: admin.userId,
    category: 'admin',
    action: 'create_code',
    detail: { code, chips, maxUses, expiresAt },
  });

  return NextResponse.json({ code, chips, maxUses, expiresAt });
}
