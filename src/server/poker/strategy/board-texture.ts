// ─── Board Texture Analysis ──────────────────────────────────────────────────
// Analyzes community cards to classify board texture for bot strategy decisions.
// Pure function — no I/O, no side effects.

export interface BoardTexture {
  wetness: number;                                          // 0 (K72r) ~ 1 (JTs9hh)
  pairedness: 'none' | 'paired' | 'trips';
  flushDraw: 'none' | 'backdoor' | 'possible' | 'monotone';
  straightDraw: 'none' | 'backdoor' | 'open' | 'connected';
  highCard: number;                                         // Highest rank on board (2=2, 14=A)
  connectivity: number;                                     // 0~1, how connected the ranks are
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RANK_MAP: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

function parseRank(card: string): number {
  return RANK_MAP[card[0]] ?? 0;
}

function parseSuit(card: string): string {
  return card[1];
}

// ─── Detection functions ─────────────────────────────────────────────────────

function detectPairedness(ranks: number[]): 'none' | 'paired' | 'trips' {
  const freq = new Map<number, number>();
  for (const r of ranks) {
    freq.set(r, (freq.get(r) ?? 0) + 1);
  }
  for (const count of freq.values()) {
    if (count >= 3) return 'trips';
  }
  for (const count of freq.values()) {
    if (count >= 2) return 'paired';
  }
  return 'none';
}

function detectFlushDraw(suits: string[], boardSize: number): 'none' | 'backdoor' | 'possible' | 'monotone' {
  if (boardSize === 0) return 'none';

  const freq = new Map<string, number>();
  for (const s of suits) {
    freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  const maxCount = Math.max(...freq.values());

  // Monotone: ALL cards same suit
  if (maxCount === boardSize && boardSize >= 3) return 'monotone';

  // Possible: 3+ of same suit on a 4-5 card board
  if (boardSize >= 4 && maxCount >= 3) return 'possible';

  // Backdoor: exactly 2 of same suit on flop (3 cards)
  if (boardSize === 3 && maxCount === 2) return 'backdoor';

  return 'none';
}

function detectStraightDraw(ranks: number[], boardSize: number): 'none' | 'backdoor' | 'open' | 'connected' {
  if (boardSize === 0) return 'none';

  const unique = [...new Set(ranks)].sort((a, b) => a - b);

  // Check each possible 5-rank window: [low, low+4]
  // Windows: A-5 (special: use 1-5 for low ace), 2-6, 3-7, ..., 10-A
  // We also need to handle the wheel (A-2-3-4-5) by adding rank 1 for Ace
  const extended = [...unique];
  if (unique.includes(14)) {
    extended.push(1); // Ace can also be low
  }
  const sortedExtended = [...new Set(extended)].sort((a, b) => a - b);

  let maxInWindow = 0;
  // Windows from 1-5 up to 10-14
  for (let low = 1; low <= 10; low++) {
    const high = low + 4;
    let count = 0;
    for (const r of sortedExtended) {
      if (r >= low && r <= high) count++;
    }
    if (count > maxInWindow) maxInWindow = count;
  }

  // Also find the longest run of strictly consecutive ranks (using natural ranks only,
  // not the low-ace extension — wheel draws are captured by the window check above)
  let maxConsecutive = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] - unique[i - 1] === 1) {
      run++;
      if (run > maxConsecutive) maxConsecutive = run;
    } else {
      run = 1;
    }
  }

  // connected: 4+ in a window, OR 3+ consecutive on a 3-card flop (all connected)
  if (maxInWindow >= 4) return 'connected';
  if (boardSize === 3 && maxConsecutive >= 3) return 'connected';
  if (maxInWindow >= 3) return 'open';
  if (boardSize === 3 && maxInWindow >= 2) return 'backdoor';

  return 'none';
}

function computeConnectivity(ranks: number[]): number {
  if (ranks.length <= 1) return 0;

  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  if (sorted.length <= 1) return 0;

  let adjacentPairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) {
      adjacentPairs++;
    }
  }

  // Total possible adjacent pairs = uniqueRanks - 1
  const possiblePairs = sorted.length - 1;
  return adjacentPairs / possiblePairs;
}

// ─── Wetness formula ─────────────────────────────────────────────────────────

const FLUSH_COMPONENT: Record<string, number> = {
  monotone: 0.4,
  possible: 0.25,
  backdoor: 0.10,
  none: 0,
};

const STRAIGHT_COMPONENT: Record<string, number> = {
  connected: 0.35,
  open: 0.25,
  backdoor: 0.10,
  none: 0,
};

const PAIR_COMPONENT: Record<string, number> = {
  trips: 0.15,
  paired: 0.10,
  none: 0,
};

// ─── Main analysis ───────────────────────────────────────────────────────────

export function analyzeBoard(board: string[]): BoardTexture {
  if (board.length === 0) {
    return {
      wetness: 0,
      pairedness: 'none',
      flushDraw: 'none',
      straightDraw: 'none',
      highCard: 0,
      connectivity: 0,
    };
  }

  const ranks = board.map(parseRank);
  const suits = board.map(parseSuit);
  const boardSize = board.length;

  const pairedness = detectPairedness(ranks);
  const flushDraw = detectFlushDraw(suits, boardSize);
  const straightDraw = detectStraightDraw(ranks, boardSize);
  const highCard = Math.max(...ranks);
  const connectivity = computeConnectivity(ranks);

  const wetness = Math.min(
    1,
    FLUSH_COMPONENT[flushDraw] +
    STRAIGHT_COMPONENT[straightDraw] +
    PAIR_COMPONENT[pairedness],
  );

  return { wetness, pairedness, flushDraw, straightDraw, highCard, connectivity };
}
