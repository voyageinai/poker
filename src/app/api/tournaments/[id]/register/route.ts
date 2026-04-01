import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getBotById } from '@/db/queries';
import { registerParticipant } from '@/server/tournament-runner';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: tournamentId } = await params;
  const body = await req.json() as { botId?: string };

  // Validate bot if specified
  if (body.botId) {
    const bot = getBotById(body.botId);
    if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    if (bot.status !== 'active') return NextResponse.json({ error: 'Bot is not active' }, { status: 400 });
  }

  const result = registerParticipant(tournamentId, user.userId, body.botId ?? null);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  audit({
    userId: user.userId,
    category: 'tournament',
    action: 'register',
    targetId: tournamentId,
    detail: { tournamentId, botId: body.botId ?? null, autoStarted: result.started },
  });

  return NextResponse.json({ ok: true, started: result.started });
}
