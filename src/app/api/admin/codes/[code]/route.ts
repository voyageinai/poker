import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { revokeChipCode } from '@/db/queries';
import { audit } from '@/db/audit';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { code } = await params;
  revokeChipCode(code);

  audit({
    userId: admin.userId,
    category: 'admin',
    action: 'revoke_code',
    detail: { code },
  });

  return NextResponse.json({ ok: true });
}
