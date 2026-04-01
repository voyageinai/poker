import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { listAllBotsWithOwner } from '@/db/queries';

export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json(listAllBotsWithOwner());
}
