/**
 * Fast hand evaluator using prime-product lookup tables.
 * ~100x faster than pokersolver for 7-card evaluation.
 *
 * Algorithm:
 * 1. Each card has a rank prime and suit bit.
 * 2. 5-card evaluation:
 *    - Flush detection via suit bit intersection
 *    - For flushes/unique-rank hands: bit-pattern lookup
 *    - For paired hands: prime-product hash lookup
 * 3. 7-card evaluation: best of C(7,5)=21 five-card subsets
 *
 * Hand rank encoding: higher number = stronger hand.
 * Range: 1 (worst high card) to 7462 (royal flush).
 */

import type { Card } from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Prime number for each rank (2..A). Product of 5 primes is unique per rank combination. */
const RANK_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41] as const;

/** Rank character to index (0=2, 1=3, ..., 12=A) */
const RANK_TO_INDEX: Record<string, number> = {
  '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6,
  '9': 7, 'T': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12,
};

/** Suit character to bit (one-hot for flush checking) */
const SUIT_TO_BIT: Record<string, number> = { 'h': 1, 'd': 2, 'c': 4, 's': 8 };

// ─── Card Encoding ───────────────────────────────────────────────────────────

/**
 * Encode a card string (e.g. "Ah") into a numeric representation.
 * Layout: bits [16..4] = rank bit, bits [3..2] = suit index, [1..0] = rank index
 * But for our evaluator we store: { rankIndex, suitBit, prime, rankBit }
 * We pack into a single 32-bit integer:
 *   bits 0-3:  rank index (0-12)
 *   bits 4-7:  suit bit (1,2,4,8)
 *   bits 8-13: prime (max 41, fits in 6 bits)
 *   bits 16-28: rank bit (1 << rank, for 13-bit rank pattern)
 */
export function encodeCard(card: string): number {
  const rankIdx = RANK_TO_INDEX[card[0]];
  const suitBit = SUIT_TO_BIT[card[1]];
  const prime = RANK_PRIMES[rankIdx];
  const rankBit = 1 << rankIdx;
  return (rankBit << 16) | (prime << 8) | (suitBit << 4) | rankIdx;
}

/** Extract rank index (0-12) from encoded card */
function rankIdx(encoded: number): number {
  return encoded & 0xF;
}

/** Extract suit bit from encoded card */
function suitBit(encoded: number): number {
  return (encoded >> 4) & 0xF;
}

/** Extract rank prime from encoded card */
function rankPrime(encoded: number): number {
  return (encoded >> 8) & 0x3F;
}

/** Extract rank bit from encoded card */
function rankBit(encoded: number): number {
  return (encoded >> 16) & 0x1FFF;
}

// ─── Lookup Table Generation ─────────────────────────────────────────────────

/**
 * There are exactly 7462 distinct 5-card poker hand ranks:
 *   Straight Flush:  10   (ranks 7453-7462)
 *   Four of a Kind: 156   (ranks 7297-7452)
 *   Full House:     156   (ranks 7141-7296)
 *   Flush:         1277   (ranks 5864-7140)
 *   Straight:        10   (ranks 5854-5863)
 *   Three of a Kind:858   (ranks 4996-5853)
 *   Two Pair:       858   (ranks 4138-4995)
 *   One Pair:      2860   (ranks 1278-4137)
 *   High Card:     1277   (ranks 1-1277)
 */

// Category boundaries (inclusive)
const HAND_CATEGORY_BOUNDARIES = [
  { name: 'High Card',       start: 1,    end: 1277 },
  { name: 'One Pair',        start: 1278, end: 4137 },
  { name: 'Two Pair',        start: 4138, end: 4995 },
  { name: 'Three of a Kind', start: 4996, end: 5853 },
  { name: 'Straight',        start: 5854, end: 5863 },
  { name: 'Flush',           start: 5864, end: 7140 },
  { name: 'Full House',      start: 7141, end: 7296 },
  { name: 'Four of a Kind',  start: 7297, end: 7452 },
  { name: 'Straight Flush',  start: 7453, end: 7462 },
] as const;

/**
 * All 10 straights as 13-bit rank patterns.
 * A-high (AKQJT) down to A-low (5432A, wheel).
 */
const STRAIGHTS: number[] = [];

function initStraights(): void {
  // T-J-Q-K-A down to A-2-3-4-5
  for (let top = 12; top >= 4; top--) {
    let bits = 0;
    for (let i = 0; i < 5; i++) bits |= (1 << (top - i));
    STRAIGHTS.push(bits);
  }
  // Wheel: A-2-3-4-5 = bit12 | bit0 | bit1 | bit2 | bit3
  STRAIGHTS.push((1 << 12) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3));
}

initStraights();

/**
 * Flush/unique5 table: maps a 13-bit rank pattern (with exactly 5 bits set)
 * to a hand rank. For flushes, the rank is in flush range; for non-flush
 * unique-rank hands, in straight or high-card range.
 *
 * flushTable[pattern] = rank for flush hands
 * unique5Table[pattern] = rank for non-flush unique-5-rank hands
 */
const flushTable = new Map<number, number>();
const unique5Table = new Map<number, number>();

/**
 * Hash table for paired hands (fewer than 5 unique ranks).
 * Maps prime product of 5 rank primes -> hand rank.
 */
const pairedTable = new Map<number, number>();

/**
 * Generate all C(n, k) combinations of indices.
 */
function combinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const combo = new Array(k);
  function recurse(start: number, depth: number) {
    if (depth === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < n; i++) {
      combo[depth] = i;
      recurse(i + 1, depth + 1);
    }
  }
  recurse(0, 0);
  return result;
}

/**
 * Count the number of bits set in a 13-bit integer.
 */
function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

/**
 * Generate all 5-bit patterns from 13 bits (C(13,5) = 1287 patterns).
 */
function generate5BitPatterns(): number[] {
  const patterns: number[] = [];
  for (let p = 0; p < (1 << 13); p++) {
    if (popcount(p) === 5) patterns.push(p);
  }
  return patterns;
}

/**
 * Get the prime product for a rank bit pattern (with exactly 5 bits set).
 */
function primeProductFromBits(pattern: number): number {
  let product = 1;
  for (let i = 0; i < 13; i++) {
    if (pattern & (1 << i)) {
      product *= RANK_PRIMES[i];
    }
  }
  return product;
}

/**
 * Check if a bit pattern represents a straight. Returns the straight index
 * (0 = A-high, 9 = wheel) or -1 if not a straight.
 */
function straightIndex(pattern: number): number {
  for (let i = 0; i < STRAIGHTS.length; i++) {
    if (pattern === STRAIGHTS[i]) return i;
  }
  return -1;
}

/**
 * Rank 5 unique-rank bit patterns among themselves for high-card ordering.
 * Higher ranks = better. We sort patterns descending and assign ranks.
 */
function compare5BitPatterns(a: number, b: number): number {
  // Compare from highest bit to lowest
  for (let bit = 12; bit >= 0; bit--) {
    const aBit = (a >> bit) & 1;
    const bBit = (b >> bit) & 1;
    if (aBit !== bBit) return aBit - bBit; // positive if a has bit, b doesn't
  }
  return 0;
}

function initFlushAndUnique5Tables(): void {
  const patterns = generate5BitPatterns();

  // Separate straights and non-straights
  const straightPatterns: number[] = [];
  const nonStraightPatterns: number[] = [];

  for (const p of patterns) {
    if (straightIndex(p) >= 0) {
      straightPatterns.push(p);
    } else {
      nonStraightPatterns.push(p);
    }
  }

  // Sort non-straight patterns by rank (descending = best first)
  nonStraightPatterns.sort((a, b) => compare5BitPatterns(b, a));

  // Sort straight patterns: A-high is best (index 0), wheel is worst (index 9)
  // STRAIGHTS array is already A-high first, so just use the STRAIGHTS order
  // But we need the patterns sorted best-first
  const orderedStraights = [...STRAIGHTS]; // already best to worst

  // Assign ranks
  let rank = 7462;

  // Straight flushes: 10 ranks (7453-7462)
  for (const p of orderedStraights) {
    flushTable.set(p, rank--);
  }

  // Four of a kind: skip for now (handled by paired table)
  // Full house: skip (handled by paired table)

  // Flushes (non-straight): 1277 ranks (5864-7140)
  // We need to assign these after straights and before non-flush straights
  // Rank = 7140 down to 5864
  rank = 7140;
  for (const p of nonStraightPatterns) {
    flushTable.set(p, rank--);
  }

  // Non-flush straights: 10 ranks (5854-5863)
  rank = 5863;
  for (const p of orderedStraights) {
    unique5Table.set(p, rank--);
  }

  // High cards (non-flush, non-straight, 5 unique ranks): 1277 ranks (1-1277)
  rank = 1277;
  for (const p of nonStraightPatterns) {
    unique5Table.set(p, rank--);
  }
}

/**
 * Generate all paired hands (1-4 of a kind combinations) and rank them.
 * Uses prime products as keys.
 */
function initPairedTable(): void {
  // We need to enumerate all possible 5-card rank multisets where at least
  // two cards share the same rank. Each multiset has a unique prime product.
  //
  // Categories (best to worst within paired hands):
  // - Four of a Kind: 4+1 distinct ranks → 156 combos (7297-7452)
  // - Full House: 3+2 distinct ranks → 156 combos (7141-7296)
  // - Three of a Kind: 3+1+1 distinct ranks → 858 combos (4996-5853)
  // - Two Pair: 2+2+1 distinct ranks → 858 combos (4138-4995)
  // - One Pair: 2+1+1+1 distinct ranks → 2860 combos (1278-4137)

  type PairedEntry = { prime: number; rank: number };
  const entries: PairedEntry[] = [];

  // Four of a Kind: pick the quad rank, then the kicker rank
  // Best: AAAA+K, worst: 2222+3
  let rank = 7452;
  for (let quadRank = 12; quadRank >= 0; quadRank--) {
    for (let kicker = 12; kicker >= 0; kicker--) {
      if (kicker === quadRank) continue;
      const prime = Math.pow(RANK_PRIMES[quadRank], 4) * RANK_PRIMES[kicker];
      entries.push({ prime, rank: rank-- });
    }
  }

  // Full House: pick the trips rank, then the pair rank
  // Best: AAA+KK, worst: 222+33
  for (let tripsRank = 12; tripsRank >= 0; tripsRank--) {
    for (let pairRank = 12; pairRank >= 0; pairRank--) {
      if (pairRank === tripsRank) continue;
      const prime = Math.pow(RANK_PRIMES[tripsRank], 3) * Math.pow(RANK_PRIMES[pairRank], 2);
      entries.push({ prime, rank: rank-- });
    }
  }

  // Three of a Kind: trips + 2 distinct kickers
  // Best: AAA+KQ, worst: 222+43
  rank = 5853;
  for (let tripsRank = 12; tripsRank >= 0; tripsRank--) {
    // Pick 2 kickers from remaining 12 ranks, ordered high to low
    for (let k1 = 12; k1 >= 0; k1--) {
      if (k1 === tripsRank) continue;
      for (let k2 = k1 - 1; k2 >= 0; k2--) {
        if (k2 === tripsRank) continue;
        const prime = Math.pow(RANK_PRIMES[tripsRank], 3) * RANK_PRIMES[k1] * RANK_PRIMES[k2];
        entries.push({ prime, rank: rank-- });
      }
    }
  }

  // Two Pair: 2 pair ranks + 1 kicker
  // Best: AA+KK+Q, worst: 33+22+4
  rank = 4995;
  for (let pair1 = 12; pair1 >= 0; pair1--) {
    for (let pair2 = pair1 - 1; pair2 >= 0; pair2--) {
      for (let kicker = 12; kicker >= 0; kicker--) {
        if (kicker === pair1 || kicker === pair2) continue;
        const prime = Math.pow(RANK_PRIMES[pair1], 2) * Math.pow(RANK_PRIMES[pair2], 2) * RANK_PRIMES[kicker];
        entries.push({ prime, rank: rank-- });
      }
    }
  }

  // One Pair: pair rank + 3 distinct kickers
  // Best: AA+KQJ, worst: 22+543
  rank = 4137;
  for (let pairRank = 12; pairRank >= 0; pairRank--) {
    for (let k1 = 12; k1 >= 0; k1--) {
      if (k1 === pairRank) continue;
      for (let k2 = k1 - 1; k2 >= 0; k2--) {
        if (k2 === pairRank) continue;
        for (let k3 = k2 - 1; k3 >= 0; k3--) {
          if (k3 === pairRank) continue;
          const prime = Math.pow(RANK_PRIMES[pairRank], 2) * RANK_PRIMES[k1] * RANK_PRIMES[k2] * RANK_PRIMES[k3];
          entries.push({ prime, rank: rank-- });
        }
      }
    }
  }

  for (const e of entries) {
    pairedTable.set(e.prime, e.rank);
  }
}

// Initialize all tables at module load time
initFlushAndUnique5Tables();
initPairedTable();

// ─── Core Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a 5-card hand and return its rank (1-7462, higher = better).
 */
export function eval5(c1: number, c2: number, c3: number, c4: number, c5: number): number {
  const cards = [c1, c2, c3, c4, c5];

  // Check for flush: all same suit
  const s1 = suitBit(c1);
  const isFlush = s1 === suitBit(c2) && s1 === suitBit(c3) && s1 === suitBit(c4) && s1 === suitBit(c5);

  // Build rank bit pattern
  const pattern = rankBit(c1) | rankBit(c2) | rankBit(c3) | rankBit(c4) | rankBit(c5);
  const uniqueRanks = popcount(pattern);

  if (isFlush) {
    // Flush (possibly straight flush)
    const r = flushTable.get(pattern);
    if (r !== undefined) return r;
    // Should not happen if tables are correct
    throw new Error(`Missing flush table entry for pattern ${pattern.toString(2)}`);
  }

  if (uniqueRanks === 5) {
    // 5 unique ranks, no flush → straight or high card
    const r = unique5Table.get(pattern);
    if (r !== undefined) return r;
    throw new Error(`Missing unique5 table entry for pattern ${pattern.toString(2)}`);
  }

  // Paired hand: compute prime product
  let primeProduct = 1;
  for (const c of cards) {
    primeProduct *= rankPrime(c);
  }

  const r = pairedTable.get(primeProduct);
  if (r !== undefined) return r;
  throw new Error(`Missing paired table entry for prime product ${primeProduct}`);
}

/**
 * All 21 five-card subsets of 7 cards, precomputed as index tuples.
 */
const COMBOS_7_5 = combinations(7, 5);

/**
 * Evaluate the best 5-card hand from 7 cards.
 * Returns rank (1-7462, higher = better).
 */
export function eval7(cards: number[]): number {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }
  if (cards.length === 5) {
    return eval5(cards[0], cards[1], cards[2], cards[3], cards[4]);
  }
  if (cards.length === 6) {
    // C(6,5) = 6 subsets
    const combos6 = combinations(6, 5);
    let best = 0;
    for (const combo of combos6) {
      const r = eval5(cards[combo[0]], cards[combo[1]], cards[combo[2]], cards[combo[3]], cards[combo[4]]);
      if (r > best) best = r;
    }
    return best;
  }

  // 7 cards: 21 subsets
  let best = 0;
  for (const combo of COMBOS_7_5) {
    const r = eval5(cards[combo[0]], cards[combo[1]], cards[combo[2]], cards[combo[3]], cards[combo[4]]);
    if (r > best) best = r;
  }
  return best;
}

// ─── Card String Helpers ─────────────────────────────────────────────────────

/** Precomputed encoded cards for all 52 cards */
const ENCODED_CARDS = new Map<string, number>();
const ALL_CARD_STRINGS: string[] = [];

function initEncodedCards(): void {
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['h', 'd', 'c', 's'];
  for (const r of ranks) {
    for (const s of suits) {
      const card = `${r}${s}`;
      ENCODED_CARDS.set(card, encodeCard(card));
      ALL_CARD_STRINGS.push(card);
    }
  }
}

initEncodedCards();

/** Get pre-encoded card (fast, cached) */
function getEncoded(card: string): number {
  const e = ENCODED_CARDS.get(card);
  if (e === undefined) throw new Error(`Invalid card: ${card}`);
  return e;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the hand category name from a rank number.
 */
export function handCategory(rank: number): string {
  for (const cat of HAND_CATEGORY_BOUNDARIES) {
    if (rank >= cat.start && rank <= cat.end) return cat.name;
  }
  throw new Error(`Invalid hand rank: ${rank}`);
}

/**
 * Compare two hands: returns positive if rank1 wins, negative if rank2 wins, 0 for tie.
 */
export function compareHands(rank1: number, rank2: number): number {
  return rank1 - rank2;
}

/**
 * Evaluate a 7-card hand from card strings.
 * Convenience wrapper around eval7.
 */
export function evaluateCards(cards: string[]): number {
  return eval7(cards.map(c => getEncoded(c)));
}

/**
 * Find winners among multiple hole-card sets given a board.
 * Returns the seat indices of the winner(s).
 */
export function fastFindWinners(
  contestants: Array<{ seat: number; holeCards: [string, string] }>,
  board: string[],
): number[] {
  const boardEncoded = board.map(c => getEncoded(c));

  let bestRank = -1;
  let winners: number[] = [];

  for (const { seat, holeCards } of contestants) {
    const allCards = [getEncoded(holeCards[0]), getEncoded(holeCards[1]), ...boardEncoded];
    const rank = eval7(allCards);
    if (rank > bestRank) {
      bestRank = rank;
      winners = [seat];
    } else if (rank === bestRank) {
      winners.push(seat);
    }
  }

  return winners;
}

// ─── Fast Monte Carlo Equity ─────────────────────────────────────────────────

/**
 * Fast Monte Carlo equity calculation using the lookup-table evaluator.
 *
 * @param hands - each player's hole cards as string pairs
 * @param board - community cards dealt so far (0-5)
 * @param dead - cards to exclude from the deck
 * @param iterations - number of simulation iterations
 * @returns equity for each hand (0-1)
 */
export function fastMonteCarloEquity(
  hands: Array<[string, string]>,
  board: string[],
  dead: string[] = [],
  iterations = 2000,
): { equities: number[] } {
  const n = hands.length;
  const wins = new Float64Array(n);
  const ties = new Float64Array(n);

  // Pre-encode known cards
  const handEncoded: Array<[number, number]> = hands.map(([a, b]) => [getEncoded(a), getEncoded(b)]);
  const boardEncoded = board.map(c => getEncoded(c));

  // Build remaining deck (excluding known and dead cards)
  const usedSet = new Set<string>();
  for (const h of hands) {
    usedSet.add(h[0]);
    usedSet.add(h[1]);
  }
  for (const c of board) usedSet.add(c);
  for (const c of dead) usedSet.add(c);

  const remaining: number[] = [];
  for (const card of ALL_CARD_STRINGS) {
    if (!usedSet.has(card)) remaining.push(getEncoded(card));
  }

  const boardNeeded = 5 - board.length;
  const deckLen = remaining.length;

  // Reusable arrays to avoid allocation in the hot loop
  const simDeck = new Int32Array(deckLen);
  const allCards = new Int32Array(7);
  const ranks = new Int32Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    // Copy remaining deck into simDeck
    for (let i = 0; i < deckLen; i++) simDeck[i] = remaining[i];

    // Fisher-Yates partial shuffle for boardNeeded cards
    for (let j = 0; j < boardNeeded; j++) {
      const idx = j + Math.floor(Math.random() * (deckLen - j));
      const tmp = simDeck[j];
      simDeck[j] = simDeck[idx];
      simDeck[idx] = tmp;
    }

    // Evaluate each player's hand
    let bestRank = 0;
    let winnerCount = 0;

    for (let p = 0; p < n; p++) {
      // Build 7-card hand: 2 hole + board + simulated
      allCards[0] = handEncoded[p][0];
      allCards[1] = handEncoded[p][1];
      let ci = 2;
      for (let b = 0; b < boardEncoded.length; b++) allCards[ci++] = boardEncoded[b];
      for (let b = 0; b < boardNeeded; b++) allCards[ci++] = simDeck[b];

      // Evaluate the 7-card hand
      const r = eval7FromTypedArray(allCards, ci);
      ranks[p] = r;

      if (r > bestRank) {
        bestRank = r;
        winnerCount = 1;
      } else if (r === bestRank) {
        winnerCount++;
      }
    }

    // Attribute wins/ties
    if (winnerCount === 1) {
      for (let p = 0; p < n; p++) {
        if (ranks[p] === bestRank) { wins[p]++; break; }
      }
    } else {
      for (let p = 0; p < n; p++) {
        if (ranks[p] === bestRank) ties[p]++;
      }
    }
  }

  const equities = new Array(n);
  for (let i = 0; i < n; i++) {
    equities[i] = (wins[i] + ties[i] / n) / iterations;
  }
  return { equities };
}

/**
 * Optimized eval7 for typed arrays (avoids creating JS arrays in the hot loop).
 */
function eval7FromTypedArray(cards: Int32Array, len: number): number {
  if (len === 5) {
    return eval5(cards[0], cards[1], cards[2], cards[3], cards[4]);
  }
  if (len === 6) {
    let best = 0;
    // Inline C(6,5) = skip each index
    for (let skip = 0; skip < 6; skip++) {
      const c: number[] = [];
      for (let i = 0; i < 6; i++) {
        if (i !== skip) c.push(cards[i]);
      }
      const r = eval5(c[0], c[1], c[2], c[3], c[4]);
      if (r > best) best = r;
    }
    return best;
  }

  // 7 cards: 21 subsets
  let best = 0;
  for (const combo of COMBOS_7_5) {
    const r = eval5(cards[combo[0]], cards[combo[1]], cards[combo[2]], cards[combo[3]], cards[combo[4]]);
    if (r > best) best = r;
  }
  return best;
}
