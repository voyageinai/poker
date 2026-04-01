import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import { getUserFromRequest } from '@/lib/auth';
import { createBot, getBotsByUser, listActiveBots, updateBotStatus } from '@/db/queries';
import { validateBot } from '@/server/bot-validator';
import { isSystemBotRecord } from '@/lib/system-bots';
import { audit } from '@/db/audit';

const BOT_DIR = path.join(process.cwd(), 'data', 'bots');
const MAX_SIZE_MB = parseInt(process.env.BOT_UPLOAD_MAX_SIZE_MB ?? '50', 10);

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  const url = new URL(req.url);

  if (url.searchParams.get('scope') === 'mine' && user) {
    return NextResponse.json(getBotsByUser(user.userId));
  }

  if (url.searchParams.get('scope') === 'seatable' && user) {
    const seatable = [
      ...getBotsByUser(user.userId).filter(bot => bot.status === 'active'),
      ...listActiveBots().filter(bot => isSystemBotRecord(bot)),
    ];

    const deduped = [...new Map(seatable.map(bot => [bot.id, bot])).values()]
      .sort((a, b) => {
        const aSystem = isSystemBotRecord(a) ? 0 : 1;
        const bSystem = isSystemBotRecord(b) ? 0 : 1;
        return aSystem - bSystem || b.elo - a.elo;
      });

    return NextResponse.json(deduped);
  }

  return NextResponse.json(listActiveBots());
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const name = form.get('name') as string | null;
  const description = (form.get('description') as string | null) ?? '';

  if (!file || !name) {
    return NextResponse.json({ error: 'file and name required' }, { status: 400 });
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File too large (max ${MAX_SIZE_MB}MB)` }, { status: 413 });
  }

  const botId = nanoid();
  await mkdir(path.join(BOT_DIR, user.userId), { recursive: true });
  const binaryPath = path.join(BOT_DIR, user.userId, botId);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(binaryPath, buffer, { mode: 0o755 });

  // Register as validating
  createBot({
    id: botId,
    user_id: user.userId,
    name,
    description,
    binary_path: binaryPath,
    status: 'validating',
  });

  audit({
    userId: user.userId,
    category: 'account',
    action: 'upload_bot',
    detail: { botId, botName: name },
  });

  // Async validation (don't block the response)
  validateBot(binaryPath).then(result => {
    const status = result.ok ? 'active' : 'invalid';
    updateBotStatus(botId, status);
    audit({
      userId: user.userId,
      category: 'account',
      action: 'bot_validated',
      targetId: botId,
      detail: { botId, botName: name, status, error: result.ok ? undefined : result.error },
    });
    if (!result.ok) console.warn(`[Bot ${botId}] Validation failed: ${result.error}`);
  });

  return NextResponse.json({ id: botId, status: 'validating' }, { status: 201 });
}
