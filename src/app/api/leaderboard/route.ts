import { NextResponse } from 'next/server';
import { listActiveBots } from '@/db/queries';

export async function GET() {
  const bots = listActiveBots(); // Already ordered by elo DESC
  return NextResponse.json(bots);
}
