import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/auth';
import { getBotById, updateBotStatus } from '@/db/queries';
import { audit } from '@/db/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = getAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const bot = getBotById(id);
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  const newStatus = bot.status === 'active' ? 'disabled' : 'active';
  updateBotStatus(id, newStatus);

  audit({
    userId: admin.userId,
    category: 'admin',
    action: 'toggle_bot',
    targetId: id,
    detail: { botName: bot.name, from: bot.status, to: newStatus },
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
