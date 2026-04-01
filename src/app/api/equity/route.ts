import { NextRequest, NextResponse } from 'next/server';
import { monteCarloEquity } from '@/server/poker/hand-eval';
import type { Card } from '@/lib/types';

/**
 * POST /api/equity
 * Body: { hands: [[Card, Card], ...], board: Card[], iterations?: number }
 * Returns: { equities: number[] }
 *
 * Called by the table UI to show real-time win probabilities.
 * Only computes equity for the requesting player's known cards vs unknown opponents.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    hands: Array<[Card, Card]>;
    board?: Card[];
    iterations?: number;
  };

  if (!body.hands || body.hands.length < 1) {
    return NextResponse.json({ error: 'At least one hand required' }, { status: 400 });
  }

  const result = monteCarloEquity(
    body.hands,
    body.board ?? [],
    [],
    body.iterations ?? 2000,
  );

  return NextResponse.json(result);
}
