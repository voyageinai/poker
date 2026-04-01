import type { PotState, SidePot } from '@/lib/types';

export interface BetEntry {
  seat: number;
  totalBet: number;
  isAllIn?: boolean;
  folded?: boolean;
}

/**
 * Build the pot structure from per-player total bets.
 *
 * Algorithm:
 *   Sort all-in amounts ascending. For each "level", calculate how much
 *   each player contributed at that level and which players are eligible.
 *   Folded players contribute chips but are never eligible.
 */
export function buildPots(bets: BetEntry[]): PotState {
  if (bets.length === 0) return { main: 0, sides: [], total: 0 };

  const total = bets.reduce((acc, b) => acc + b.totalBet, 0);

  // Levels are defined by all-in amounts (unique, sorted ascending)
  const allInAmounts = [
    ...new Set(
      bets.filter(b => b.isAllIn && !b.folded).map(b => b.totalBet),
    ),
  ].sort((a, b) => a - b);

  // If no all-ins, everything goes into one main pot
  if (allInAmounts.length === 0) {
    const eligible = bets.filter(b => !b.folded).map(b => b.seat);
    return { main: total, sides: [], total };
  }

  const pots: Array<{ amount: number; eligible: number[] }> = [];
  let previousLevel = 0;

  for (const level of allInAmounts) {
    const contribution = level - previousLevel;
    // Every player (including folded) contributed up to this level if their bet >= level
    let potAmount = 0;
    const eligible: number[] = [];

    for (const b of bets) {
      const contrib = Math.min(Math.max(b.totalBet - previousLevel, 0), contribution);
      potAmount += contrib;
      // Eligible: not folded AND their total bet >= this level
      if (!b.folded && b.totalBet >= level) {
        eligible.push(b.seat);
      }
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligible });
    }
    previousLevel = level;
  }

  // Remainder above the highest all-in level
  const remainderContrib = bets.reduce((acc, b) => {
    return acc + Math.max(b.totalBet - previousLevel, 0);
  }, 0);

  if (remainderContrib > 0) {
    const eligible = bets
      .filter(b => !b.folded && b.totalBet > previousLevel)
      .map(b => b.seat);
    pots.push({ amount: remainderContrib, eligible });
  }

  // First pot is "main", rest are "sides"
  const [mainPot, ...sidePots] = pots;
  return {
    main: mainPot?.amount ?? 0,
    sides: sidePots as SidePot[],
    total,
  };
}

/**
 * Distribute pots to winners.
 *
 * @param pot - pot structure from buildPots
 * @param stacks - current chip stacks per seat (before awarding)
 * @param winnersBySeat - callback: given eligible seats, return winner seat(s).
 *   Called once for main pot, once for each side pot.
 *   Caller is responsible for hand comparison logic.
 * @returns new stacks after awarding
 */
export function awardPots(
  pot: PotState,
  stacks: Record<number, number>,
  winnersBySeat: (eligible: number[]) => number[],
): Record<number, number> {
  const result = { ...stacks };

  function award(amount: number, eligible: number[]): void {
    const winners = winnersBySeat(eligible);
    if (winners.length === 0) return;

    const share = Math.floor(amount / winners.length);
    const remainder = amount - share * winners.length;

    for (const seat of winners) {
      result[seat] = (result[seat] ?? 0) + share;
    }
    // Odd chip goes to first winner (lowest seat index, deterministic)
    if (remainder > 0) {
      const firstWinner = [...winners].sort((a, b) => a - b)[0];
      result[firstWinner] = (result[firstWinner] ?? 0) + remainder;
    }
  }

  // Main pot — all eligible seats
  const mainEligible = pot.sides.length === 0
    ? Object.keys(stacks).map(Number)
    : undefined;

  // If there are side pots, main pot eligible was tracked in buildPots.
  // We reconstruct eligible for main as all seats not in any later side pot exclusively.
  // Actually: since buildPots returns sides with their eligible, and awardPots is called
  // with the pot state, we need the main pot's eligible list too.
  // Design: extend PotState to carry main eligible, or pass separately.
  // For simplicity: award main to all non-folded seats (caller must pass correct eligible).
  // We use mainEligible fallback (all seats) when there are no side pots.
  const allSeats = Object.keys(stacks).map(Number);
  award(pot.main, mainEligible ?? allSeats);

  for (const side of pot.sides) {
    award(side.amount, side.eligible);
  }

  return result;
}

/**
 * Extended buildPots that also tracks main pot eligible seats.
 * This is the version callers should use.
 */
export interface PotStateWithEligible extends PotState {
  mainEligible: number[];
}

export function buildPotsWithEligible(bets: BetEntry[]): PotStateWithEligible {
  if (bets.length === 0) {
    return { main: 0, sides: [], total: 0, mainEligible: [] };
  }

  const total = bets.reduce((acc, b) => acc + b.totalBet, 0);
  const allInAmounts = [
    ...new Set(
      bets.filter(b => b.isAllIn && !b.folded).map(b => b.totalBet),
    ),
  ].sort((a, b) => a - b);

  if (allInAmounts.length === 0) {
    const eligible = bets.filter(b => !b.folded).map(b => b.seat);
    return { main: total, sides: [], total, mainEligible: eligible };
  }

  const pots: Array<{ amount: number; eligible: number[] }> = [];
  let previousLevel = 0;

  for (const level of allInAmounts) {
    const contribution = level - previousLevel;
    let potAmount = 0;
    const eligible: number[] = [];

    for (const b of bets) {
      const contrib = Math.min(Math.max(b.totalBet - previousLevel, 0), contribution);
      potAmount += contrib;
      if (!b.folded && b.totalBet >= level) eligible.push(b.seat);
    }

    if (potAmount > 0) pots.push({ amount: potAmount, eligible });
    previousLevel = level;
  }

  const remainderContrib = bets.reduce(
    (acc, b) => acc + Math.max(b.totalBet - previousLevel, 0),
    0,
  );
  if (remainderContrib > 0) {
    const eligible = bets
      .filter(b => !b.folded && b.totalBet > previousLevel)
      .map(b => b.seat);
    pots.push({ amount: remainderContrib, eligible });
  }

  const [mainPot, ...sidePots] = pots;
  return {
    main: mainPot?.amount ?? 0,
    mainEligible: mainPot?.eligible ?? [],
    sides: sidePots as SidePot[],
    total,
  };
}

/**
 * Award pots using the extended pot state that includes mainEligible.
 */
export function awardPotsWithEligible(
  pot: PotStateWithEligible,
  stacks: Record<number, number>,
  winnersBySeat: (eligible: number[]) => number[],
): Record<number, number> {
  const result = { ...stacks };

  function award(amount: number, eligible: number[]): void {
    const winners = winnersBySeat(eligible);
    if (winners.length === 0) return;
    const share = Math.floor(amount / winners.length);
    const remainder = amount - share * winners.length;
    for (const seat of winners) result[seat] = (result[seat] ?? 0) + share;
    if (remainder > 0) {
      const firstWinner = [...winners].sort((a, b) => a - b)[0];
      result[firstWinner] = (result[firstWinner] ?? 0) + remainder;
    }
  }

  award(pot.main, pot.mainEligible);
  for (const side of pot.sides) award(side.amount, side.eligible);
  return result;
}
