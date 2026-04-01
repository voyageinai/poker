import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { redeemChipCode } from '@/db/queries';
import { audit } from '@/db/audit';

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { code?: string };
  if (typeof body.code !== 'string' || !body.code.trim()) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const code = body.code.trim().toUpperCase();
  const result = redeemChipCode(code, user.userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  audit({
    userId: user.userId,
    category: 'chips',
    action: 'redeem_code',
    detail: { code, chips: result.chips },
  });

  return NextResponse.json({ ok: true, chips: result.chips });
}
