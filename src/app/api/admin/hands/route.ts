import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getAdminHands } from '@/db/queries';

export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : 1;
  const pageSize = url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : 30;

  const result = getAdminHands({ page, pageSize });
  return NextResponse.json(result);
}
