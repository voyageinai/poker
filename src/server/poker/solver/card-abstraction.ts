/**
 * Card Abstraction (Hand Clustering) for Postflop CFR Solver
 *
 * Groups strategically similar hands into "buckets" so the solver can work
 * with a tractable number of information sets. Uses EHS (Expected Hand Strength)
 * bucketing: compute equity via the fast evaluator, then map to a bucket.
 *
 * Street-specific strategies:
 * - River: deterministic hand rank via eval7 (no simulation needed)
 * - Turn: MC equity with remaining 1 card (46 rollouts or enumeration)
 * - Flop: MC equity with remaining 2 cards (1081 rollouts or sampling)
 *
 * All evaluation uses the fast lookup-table evaluator (~100x faster than pokersolver).
 */

import { encodeCard, eval7, fastMonteCarloEquity } from '../fast-eval';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of buckets per street */
export const RIVER_BUCKETS = 200;
export const TURN_BUCKETS = 500;
export const FLOP_BUCKETS = 1000;

/** Max hand rank from fast-eval (royal flush) */
const MAX_RANK = 7462;

// ─── Full deck enumeration ──────────────────────────────────────────────────

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['h', 'd', 'c', 's'] as const;

/** All 52 card strings, pre-built once at module load */
const ALL_CARDS: string[] = [];
for (const r of RANKS) {
  for (const s of SUITS) {
    ALL_CARDS.push(`${r}${s}`);
  }
}

/** Pre-encoded card lookup for fast access */
const ENCODED: Map<string, number> = new Map();
for (const c of ALL_CARDS) {
  ENCODED.set(c, encodeCard(c));
}

function getEncoded(card: string): number {
  const e = ENCODED.get(card);
  if (e === undefined) throw new Error(`Invalid card: ${card}`);
  return e;
}

// ─── River Bucketing (Deterministic) ────────────────────────────────────────

/**
 * Compute the river bucket for a hand. On the river all 5 community cards are
 * known, so hand strength is deterministic — no simulation needed.
 *
 * Maps the 7-card hand rank (1..7462) to a bucket (0..RIVER_BUCKETS-1).
 * Uses linear mapping: bucket = floor((rank - 1) / 7462 * RIVER_BUCKETS).
 *
 * @param holeCards - Player's 2 hole cards
 * @param board     - Exactly 5 community cards
 * @returns Bucket index in [0, RIVER_BUCKETS)
 */
export function riverBucket(
  holeCards: [string, string],
  board: [string, string, string, string, string],
): number {
  const encoded = [
    getEncoded(holeCards[0]),
    getEncoded(holeCards[1]),
    getEncoded(board[0]),
    getEncoded(board[1]),
    getEncoded(board[2]),
    getEncoded(board[3]),
    getEncoded(board[4]),
  ];
  const rank = eval7(encoded);
  // rank is 1..7462 (higher = better), map to 0..RIVER_BUCKETS-1
  return Math.min(RIVER_BUCKETS - 1, Math.floor(((rank - 1) / MAX_RANK) * RIVER_BUCKETS));
}

// ─── Turn Bucketing (Enumerate River Card) ──────────────────────────────────

/**
 * Compute the turn bucket by enumerating all possible river cards.
 * With 4 board cards + 2 hole cards known, there are 46 possible river cards.
 * We evaluate the hand for each, compute average hand strength, and bucket.
 *
 * This is exhaustive enumeration (not sampling), which is fast enough since
 * there are only 46 possible completions.
 *
 * @param holeCards - Player's 2 hole cards
 * @param board     - Exactly 4 community cards (flop + turn)
 * @returns Bucket index in [0, TURN_BUCKETS)
 */
export function turnBucket(
  holeCards: [string, string],
  board: [string, string, string, string],
): number {
  const usedSet = new Set<string>([holeCards[0], holeCards[1], ...board]);

  // Pre-encode the 6 known cards
  const knownEncoded = [
    getEncoded(holeCards[0]),
    getEncoded(holeCards[1]),
    getEncoded(board[0]),
    getEncoded(board[1]),
    getEncoded(board[2]),
    getEncoded(board[3]),
  ];

  let rankSum = 0;
  let count = 0;

  for (const card of ALL_CARDS) {
    if (usedSet.has(card)) continue;
    // Evaluate 7-card hand: 2 hole + 4 board + 1 river
    const allSeven = [...knownEncoded, getEncoded(card)];
    const rank = eval7(allSeven);
    rankSum += rank;
    count++;
  }

  // Average rank across all river completions, normalized to [0, 1)
  const avgRank = rankSum / count;
  const normalized = (avgRank - 1) / MAX_RANK;
  return Math.min(TURN_BUCKETS - 1, Math.floor(normalized * TURN_BUCKETS));
}

// ─── Flop Bucketing (MC Equity) ─────────────────────────────────────────────

/**
 * Compute the flop bucket using Monte Carlo equity estimation.
 * With 3 board cards + 2 hole cards, there are C(47,2) = 1081 possible
 * turn+river completions. We use MC sampling for speed.
 *
 * The equity is computed against a single random opponent (heads-up), which
 * gives Expected Hand Strength (EHS). This is the standard simplification
 * for card abstraction — it measures "how strong is this hand on average?"
 *
 * @param holeCards  - Player's 2 hole cards
 * @param board      - Exactly 3 community cards (the flop)
 * @param opponents  - Number of opponents (default 1 for heads-up EHS)
 * @param iterations - MC iterations (default 500 for flop, balancing speed/accuracy)
 * @returns Bucket index in [0, FLOP_BUCKETS)
 */
export function flopBucket(
  holeCards: [string, string],
  board: [string, string, string],
  opponents = 1,
  iterations = 500,
): number {
  const equity = computeEHS(holeCards, board, opponents, iterations);
  return Math.min(FLOP_BUCKETS - 1, Math.floor(equity * FLOP_BUCKETS));
}

// ─── Generic Bucket API ─────────────────────────────────────────────────────

/**
 * Compute the hand bucket for the current street.
 * Dispatches to the appropriate street-specific bucketing function.
 *
 * @param holeCards  - Player's 2 hole cards
 * @param board      - Community cards (3 for flop, 4 for turn, 5 for river)
 * @param street     - Current street
 * @param opponents  - Number of opponents (used for flop MC; default 1)
 * @returns Bucket index in [0, numBuckets)
 */
export function getHandBucket(
  holeCards: [string, string],
  board: string[],
  street: 'flop' | 'turn' | 'river',
  opponents = 1,
): number {
  switch (street) {
    case 'river':
      return riverBucket(
        holeCards,
        board as [string, string, string, string, string],
      );
    case 'turn':
      return turnBucket(
        holeCards,
        board as [string, string, string, string],
      );
    case 'flop':
      return flopBucket(
        holeCards,
        board as [string, string, string],
        opponents,
      );
    default:
      throw new Error(`Invalid street: ${street}`);
  }
}

/**
 * Get the number of buckets for a given street.
 */
export function getBucketCount(street: 'flop' | 'turn' | 'river'): number {
  switch (street) {
    case 'river': return RIVER_BUCKETS;
    case 'turn': return TURN_BUCKETS;
    case 'flop': return FLOP_BUCKETS;
    default: throw new Error(`Invalid street: ${street}`);
  }
}

// ─── Equity computation ─────────────────────────────────────────────────────

/**
 * Compute Expected Hand Strength (EHS) against random opponent hands.
 * Uses fastMonteCarloEquity with dummy opponent hands to estimate equity.
 *
 * For the solver, we need single-number equity against a uniform random
 * opponent range. We achieve this by running MC simulations where each
 * iteration deals random opponent hole cards from the remaining deck.
 *
 * @returns Equity in [0, 1]
 */
function computeEHS(
  holeCards: [string, string],
  board: string[],
  opponents: number,
  iterations: number,
): number {
  // Build remaining deck
  const usedSet = new Set<string>([holeCards[0], holeCards[1], ...board]);
  const remaining: string[] = [];
  for (const card of ALL_CARDS) {
    if (!usedSet.has(card)) remaining.push(card);
  }

  let wins = 0;
  let ties = 0;
  const total = iterations;

  for (let i = 0; i < total; i++) {
    // Deal random opponent hands from remaining deck
    // Partial Fisher-Yates shuffle for (opponents * 2) cards
    const deck = [...remaining];
    const needed = opponents * 2;
    for (let j = 0; j < needed; j++) {
      const idx = j + Math.floor(Math.random() * (deck.length - j));
      [deck[j], deck[idx]] = [deck[idx], deck[j]];
    }

    // Build opponent hole card pairs
    const oppHands: Array<[string, string]> = [];
    for (let o = 0; o < opponents; o++) {
      oppHands.push([deck[o * 2], deck[o * 2 + 1]]);
    }

    // Complete the board if needed
    let boardNeeded = 5 - board.length;
    const simBoard = [...board];
    let boardStart = needed;
    for (let b = 0; b < boardNeeded; b++) {
      const idx = boardStart + b + Math.floor(Math.random() * (deck.length - boardStart - b));
      [deck[boardStart + b], deck[idx]] = [deck[idx], deck[boardStart + b]];
      simBoard.push(deck[boardStart + b]);
    }

    // Evaluate hero hand
    const heroCards = [
      getEncoded(holeCards[0]),
      getEncoded(holeCards[1]),
      ...simBoard.map(c => getEncoded(c)),
    ];
    const heroRank = eval7(heroCards);

    // Evaluate each opponent
    let heroBest = true;
    let heroTied = false;
    for (let o = 0; o < opponents; o++) {
      const oppCards = [
        getEncoded(oppHands[o][0]),
        getEncoded(oppHands[o][1]),
        ...simBoard.map(c => getEncoded(c)),
      ];
      const oppRank = eval7(oppCards);
      if (oppRank > heroRank) {
        heroBest = false;
        break;
      } else if (oppRank === heroRank) {
        heroTied = true;
      }
    }

    if (heroBest && !heroTied) {
      wins++;
    } else if (heroBest && heroTied) {
      ties++;
    }
  }

  return (wins + ties * 0.5) / total;
}

// ─── Turn Equity Distribution (for advanced clustering) ─────────────────────

/**
 * Compute the equity distribution on the turn: for each possible river card,
 * compute the resulting hand rank. Returns a histogram of hand ranks bucketed
 * into coarse bins.
 *
 * This is useful for advanced clustering (k-means on equity distributions)
 * rather than simple EHS bucketing. Not used in v1 but provided for future use.
 *
 * @param holeCards - Player's 2 hole cards
 * @param board     - Exactly 4 community cards
 * @param bins      - Number of histogram bins (default 10)
 * @returns Array of length `bins` with normalized frequency in each bin
 */
export function turnEquityDistribution(
  holeCards: [string, string],
  board: [string, string, string, string],
  bins = 10,
): number[] {
  const usedSet = new Set<string>([holeCards[0], holeCards[1], ...board]);

  const knownEncoded = [
    getEncoded(holeCards[0]),
    getEncoded(holeCards[1]),
    getEncoded(board[0]),
    getEncoded(board[1]),
    getEncoded(board[2]),
    getEncoded(board[3]),
  ];

  const histogram = new Array(bins).fill(0);
  let count = 0;

  for (const card of ALL_CARDS) {
    if (usedSet.has(card)) continue;
    const allSeven = [...knownEncoded, getEncoded(card)];
    const rank = eval7(allSeven);
    const bin = Math.min(bins - 1, Math.floor(((rank - 1) / MAX_RANK) * bins));
    histogram[bin]++;
    count++;
  }

  // Normalize to probabilities
  for (let i = 0; i < bins; i++) {
    histogram[i] /= count;
  }

  return histogram;
}
