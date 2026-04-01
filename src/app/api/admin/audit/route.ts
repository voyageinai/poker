import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { queryAuditLogs } from '@/db/audit';
import { getUserByUsername } from '@/db/queries';

export async function GET(req: NextRequest) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);

  // Support searching by username → resolve to userId
  let userId = url.searchParams.get('userId') ?? undefined;
  const username = url.searchParams.get('username');
  if (username && !userId) {
    const u = getUserByUsername(username);
    if (u) userId = u.id;
    else return NextResponse.json({ rows: [], total: 0 });
  }

  const result = queryAuditLogs({
    category: url.searchParams.get('category') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    userId,
    targetId: url.searchParams.get('targetId') ?? undefined,
    from: url.searchParams.has('from') ? Number(url.searchParams.get('from')) : undefined,
    to: url.searchParams.has('to') ? Number(url.searchParams.get('to')) : undefined,
    page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
    pageSize: url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
  });

  return NextResponse.json(result);
}
