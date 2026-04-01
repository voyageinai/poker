import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getUserFromRequest } from '@/lib/auth';
import { createTournament, listTournaments } from '@/db/queries';
import { DEFAULT_BLIND_SCHEDULE } from '@/server/tournament-runner';
import { audit } from '@/db/audit';
import type { BlindLevel } from '@/lib/types';

export async function GET() {
  return NextResponse.json(listTournaments());
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    name?: string;
    buyin?: number;
    startingChips?: number;
    maxPlayers?: number;
    blindSchedule?: BlindLevel[];
  };

  const maxPlayers = Math.min(Math.max(body.maxPlayers ?? 6, 2), 9);

  const id = nanoid();
  createTournament({
    id,
    name: body.name ?? `SNG ${maxPlayers}-max`,
    buyin: body.buyin ?? 100,
    starting_chips: body.startingChips ?? 3000,
    max_players: maxPlayers,
    blind_schedule: JSON.stringify(body.blindSchedule ?? DEFAULT_BLIND_SCHEDULE),
    created_by: user.userId,
  });

  audit({
    userId: user.userId,
    category: 'tournament',
    action: 'create',
    targetId: id,
    detail: { name: body.name ?? `SNG ${maxPlayers}-max`, buyin: body.buyin ?? 100, maxPlayers },
  });

  return NextResponse.json({ id }, { status: 201 });
}
