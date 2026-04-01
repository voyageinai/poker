/**
 * Elo rating for poker bots.
 *
 * Unlike chess (1v1), poker hands have multiple participants.
 * We use pairwise Elo: for an N-player hand, each pair of bots
 * exchange rating points based on who profited more.
 *
 * K = 32 (same as the chess platform).
 */

const K = 32;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface EloEntry {
  /** Use participantId for generic identification (botId or userId) */
  participantId: string;
  /** @deprecated Use participantId instead */
  botId?: string;
  currentElo: number;
  /** Net chips won/lost this hand (positive = profit) */
  chipResult: number;
}

export interface EloUpdate {
  participantId: string;
  /** @deprecated Use participantId instead */
  botId?: string;
  newElo: number;
  delta: number;
}

/**
 * Calculate Elo updates for all bots in a hand.
 * Each pair of bots is compared: the one with higher chipResult
 * gets score=1, lower gets 0, equal gets 0.5 (draw).
 * Rating change is the sum of pairwise deltas.
 */
export function calculateEloUpdates(entries: EloEntry[]): EloUpdate[] {
  if (entries.length < 2) return entries.map(e => ({ participantId: e.participantId, botId: e.botId, newElo: e.currentElo, delta: 0 }));

  const deltas = new Map<string, number>();
  for (const e of entries) deltas.set(e.participantId, 0);

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const expected = expectedScore(a.currentElo, b.currentElo);

      let actual: number;
      if (a.chipResult > b.chipResult) actual = 1;
      else if (a.chipResult < b.chipResult) actual = 0;
      else actual = 0.5;

      // Scale K by number of opponents so total K is consistent
      const k = K / (entries.length - 1);
      const deltaA = k * (actual - expected);
      const deltaB = k * ((1 - actual) - (1 - expected));

      deltas.set(a.participantId, (deltas.get(a.participantId) ?? 0) + deltaA);
      deltas.set(b.participantId, (deltas.get(b.participantId) ?? 0) + deltaB);
    }
  }

  return entries.map(e => {
    const delta = Math.round(deltas.get(e.participantId) ?? 0);
    return { participantId: e.participantId, botId: e.botId, newElo: e.currentElo + delta, delta };
  });
}
