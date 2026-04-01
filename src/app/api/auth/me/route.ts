import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getUserById, maybeRefreshChips } from '@/db/queries';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Trigger daily chip refresh (idempotent)
  const refresh = maybeRefreshChips(user.userId);

  const dbUser = getUserById(user.userId);
  if (!dbUser) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    userId: dbUser.id,
    username: dbUser.username,
    role: dbUser.role,
    chips: dbUser.chips,
    refreshed: refresh.refreshed,
  });
}
