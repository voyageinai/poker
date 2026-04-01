/**
 * Hand evaluation and equity calculation.
 *
 * pokersolver expects cards in format: "Ah", "Td", "2c" etc.
 * which matches our Card type exactly.
 */
import { Hand } from 'pokersolver';
import type { Card } from '@/lib/types';
import { freshDeck } from './deck';

export interface HandResult {
  name: string;   // e.g. "Flush, Ace High"
  rank: number;   // 9 = Royal Flush ... higher = stronger (per pokersolver)
  cards: Card[];  // best 5-card hand
}

/** Evaluate the best 5-card hand from hole + board. */
export function evaluateHand(holeCards: [Card, Card], board: Card[]): HandResult {
  const allCards = [...holeCards, ...board];
  const solved = Hand.solve(allCards);
  return {
    name: solved.name,
    rank: solved.rank,
    cards: solved.cards.map((c: { value: string; suit: string }) => `${c.value}${c.suit}`) as Card[],
  };
}

/**
 * Compare multiple hands at showdown.
 * Returns winners (may be multiple in case of tie).
 */
export function findWinners(
  contestants: Array<{ seat: number; holeCards: [Card, Card] }>,
  board: Card[],
): number[] {
  const hands = contestants.map(({ seat, holeCards }) => {
    const solved = Hand.solve([...holeCards, ...board]) as Hand & { _seat: number };
    solved._seat = seat;
    return solved;
  });
  const winners = Hand.winners(hands) as Array<Hand & { _seat: number }>;
  return winners.map(w => w._seat);
}

// ─── Equity / Monte Carlo ──────────────────────────────────────────────────────

export interface EquityResult {
  /** win probability 0–1 for each seat in the same order as `hands` */
  equities: number[];
}

/**
 * Monte Carlo equity estimation.
 * @param hands - each player's hole cards
 * @param board - already-dealt community cards (0–4)
 * @param dead  - cards to exclude (mucked hands, burn cards)
 * @param iterations - simulation count; 2000 is fast and accurate enough for UI
 */
export function monteCarloEquity(
  hands: Array<[Card, Card]>,
  board: Card[],
  dead: Card[] = [],
  iterations = 2000,
): EquityResult {
  const n = hands.length;
  const wins = new Array(n).fill(0);
  const ties = new Array(n).fill(0);

  const usedCards = new Set<Card>([...hands.flat(), ...board, ...dead]);
  const remaining = freshDeck().filter(c => !usedCards.has(c));

  const boardNeeded = 5 - board.length;

  for (let i = 0; i < iterations; i++) {
    // Fast Fisher-Yates partial shuffle for boardNeeded cards
    const deck = [...remaining];
    const drawn: Card[] = [];
    for (let j = 0; j < boardNeeded; j++) {
      const idx = j + Math.floor(Math.random() * (deck.length - j));
      [deck[j], deck[idx]] = [deck[idx], deck[j]];
      drawn.push(deck[j]);
    }

    const simBoard = [...board, ...drawn] as Card[];
    type TaggedHand = Hand & { _idx: number };
    const solved = hands.map((h, idx) => {
      const sh = Hand.solve([...h, ...simBoard]) as TaggedHand;
      sh._idx = idx;
      return sh;
    });
    const winnerHands = Hand.winners(solved) as TaggedHand[];

    if (winnerHands.length === 1) {
      wins[winnerHands[0]._idx]++;
    } else {
      for (const w of winnerHands) {
        ties[w._idx]++;
      }
    }
  }

  const equities = hands.map((_, i) => (wins[i] + ties[i] / hands.length) / iterations);
  return { equities };
}
