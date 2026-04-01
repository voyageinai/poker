import { NextRequest, NextResponse } from 'next/server';
import { getTournamentById, getTournamentEntries } from '@/db/queries';
import { getActiveTournament } from '@/server/tournament-runner';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tourney = getTournamentById(id);
  if (!tourney) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const entries = getTournamentEntries(id);
  const active = getActiveTournament(id);

  return NextResponse.json({
    ...tourney,
    blindSchedule: JSON.parse(tourney.blind_schedule),
    entries,
    currentLevel: active?.currentLevel ?? null,
    playersRemaining: active?.playersRemaining ?? null,
    tableId: active?.tableId ?? null,
  });
}
