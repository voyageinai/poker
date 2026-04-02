/**
 * CFR (Counterfactual Regret Minimization) preflop strategy tables.
 *
 * Loads GTO-solved strategy tables and provides the same public API as
 * preflop-ranges.ts. Falls back to heuristic when tables are unavailable
 * or a hand/position/scenario is missing from the table.
 */

import type { Position, SystemBotStyle } from './preflop-ranges';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActionFrequencies {
  fold: number;
  call: number;
  raise: number;
}

type ActionSequence = 'unopened' | 'facing_raise' | 'facing_3bet' | 'facing_4bet' | 'facing_allin';

interface PositionStrategy {
  unopened?: Record<string, ActionFrequencies>;
  facing_raise?: Record<string, ActionFrequencies>;
  facing_3bet?: Record<string, ActionFrequencies>;
  facing_4bet?: Record<string, ActionFrequencies>;
  facing_allin?: Record<string, ActionFrequencies>;
}

interface CfrStrategy {
  meta: {
    positions: string[];
    iterations: number;
    hands: number;
  };
  strategy: Record<string, PositionStrategy>;
}

interface StyleDeviation {
  rangeScale: number;
  foldShift: number;
  raiseShift: number;
  callShift: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RANK_ORDER = '23456789TJQKA';

const STYLE_DEVIATIONS: Record<SystemBotStyle, StyleDeviation> = {
  gto:        { rangeScale: 1.0,  foldShift: 0,      raiseShift: 0,      callShift: 0 },
  nit:        { rangeScale: 0.6,  foldShift: +0.25,  raiseShift: -0.05,  callShift: -0.20 },
  tag:        { rangeScale: 0.85, foldShift: +0.08,  raiseShift: +0.02,  callShift: -0.10 },
  lag:        { rangeScale: 1.2,  foldShift: -0.15,  raiseShift: +0.15,  callShift: 0 },
  station:    { rangeScale: 1.0,  foldShift: -0.30,  raiseShift: -0.15,  callShift: +0.45 },
  maniac:     { rangeScale: 1.4,  foldShift: -0.35,  raiseShift: +0.25,  callShift: +0.10 },
  trapper:    { rangeScale: 0.9,  foldShift: +0.05,  raiseShift: -0.10,  callShift: +0.05 },
  bully:      { rangeScale: 1.1,  foldShift: -0.10,  raiseShift: +0.10,  callShift: 0 },
  tilter:     { rangeScale: 0.9,  foldShift: +0.05,  raiseShift: +0.02,  callShift: -0.07 },
  shortstack: { rangeScale: 0.8,  foldShift: +0.10,  raiseShift: +0.05,  callShift: -0.15 },
  adaptive:   { rangeScale: 1.0,  foldShift: 0,      raiseShift: 0,      callShift: 0 },
};

// ─── Load CFR tables (graceful fallback) ─────────────────────────────────────

let cfrTables: CfrStrategy | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cfrTables = require('./preflop-cfr-tables.json') as CfrStrategy;
} catch {
  // Tables not generated yet — will use heuristic fallback
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rankIndex(rank: string): number {
  return RANK_ORDER.indexOf(rank);
}

function rank(card: string): string {
  return card.slice(0, -1);
}

function suit(card: string): string {
  return card[card.length - 1];
}

/**
 * Convert two cards to canonical hand label.
 * e.g. "Ah","Kd" -> "AKo"; "Ts","9s" -> "T9s"; "Jh","Jd" -> "JJ"
 */
function canonicalizeLabel(cards: [string, string]): string {
  const r0 = rankIndex(rank(cards[0]));
  const r1 = rankIndex(rank(cards[1]));
  const isSuited = suit(cards[0]) === suit(cards[1]);

  const highRank = Math.max(r0, r1);
  const lowRank = Math.min(r0, r1);
  const isPair = r0 === r1;

  const highChar = RANK_ORDER[highRank];
  const lowChar = RANK_ORDER[lowRank];

  if (isPair) return `${highChar}${lowChar}`;
  return `${highChar}${lowChar}${isSuited ? 's' : 'o'}`;
}

/**
 * Determine the action sequence key from context.
 */
function getActionSequence(
  raisersAhead: number,
  facing3Bet: boolean,
): ActionSequence {
  if (raisersAhead >= 4) return 'facing_allin';
  if (raisersAhead === 3) return 'facing_4bet';
  if (raisersAhead === 2 || facing3Bet) return 'facing_3bet';
  if (raisersAhead === 1) return 'facing_raise';
  return 'unopened';
}

/**
 * Look up GTO strategy from the CFR table for a hand/position/scenario.
 * Returns null if the table or specific entry doesn't exist.
 */
export function lookupGtoStrategy(
  cards: [string, string],
  position: Position,
  actionSeq: ActionSequence,
): ActionFrequencies | null {
  if (!cfrTables) return null;

  const posStrategy = cfrTables.strategy[position];
  if (!posStrategy) return null;

  const scenarioTable = posStrategy[actionSeq];
  if (!scenarioTable) return null;

  const label = canonicalizeLabel(cards);
  const entry = scenarioTable[label];
  if (!entry) return null;

  return entry;
}

/**
 * Apply rangeScale deviation.
 *
 * rangeScale < 1.0: hands GTO plays at low frequency get folded more.
 *   The scaling is proportional to the GTO fold frequency — hands that
 *   GTO already folds often get hit hardest, while hands GTO always plays
 *   (like AA) are barely affected.
 * rangeScale > 1.0: hands GTO folds get played more.
 *   The scaling is proportional to fold frequency — hands GTO folds most
 *   get the biggest boost.
 */
function applyRangeScale(
  freqs: ActionFrequencies,
  rangeScale: number,
): ActionFrequencies {
  if (rangeScale === 1.0) return { ...freqs };

  const playFreq = freqs.call + freqs.raise;

  if (rangeScale < 1.0) {
    // Tighter: reduce play frequency for marginal hands.
    // The reduction is proportional to GTO fold frequency so that
    // premium hands (fold=0) are unaffected and marginal hands (high fold)
    // get squeezed the most.
    const marginality = freqs.fold; // 0 for premium, ~1 for junk
    const effectiveScale = 1 - (1 - rangeScale) * marginality;
    const scaledPlay = playFreq * effectiveScale;
    const foldIncrease = playFreq - scaledPlay;
    const callRatio = playFreq > 0 ? freqs.call / playFreq : 0;
    const raiseRatio = playFreq > 0 ? freqs.raise / playFreq : 0;
    return {
      fold: freqs.fold + foldIncrease,
      call: scaledPlay * callRatio,
      raise: scaledPlay * raiseRatio,
    };
  } else {
    // Looser: reduce fold frequency, increase play frequency.
    // The boost is proportional to fold frequency so that hands GTO
    // folds the most get the biggest play-frequency increase.
    const foldReduction = freqs.fold * (1 - 1 / rangeScale);
    const extraPlay = foldReduction;
    const callRatio = playFreq > 0 ? freqs.call / playFreq : 0.5;
    const raiseRatio = playFreq > 0 ? freqs.raise / playFreq : 0.5;
    return {
      fold: freqs.fold - extraPlay,
      call: freqs.call + extraPlay * callRatio,
      raise: freqs.raise + extraPlay * raiseRatio,
    };
  }
}

/**
 * Apply style deviation shifts to GTO frequencies, then clamp and normalize.
 */
function applyStyleDeviation(
  gto: ActionFrequencies,
  style: SystemBotStyle,
): ActionFrequencies {
  const dev = STYLE_DEVIATIONS[style];

  // Step 1: Apply range scale
  let freqs = applyRangeScale(gto, dev.rangeScale);

  // Step 2: Add shifts
  freqs = {
    fold: freqs.fold + dev.foldShift,
    call: freqs.call + dev.callShift,
    raise: freqs.raise + dev.raiseShift,
  };

  // Step 3: Clamp to [0, 1]
  freqs.fold = Math.max(0, Math.min(1, freqs.fold));
  freqs.call = Math.max(0, Math.min(1, freqs.call));
  freqs.raise = Math.max(0, Math.min(1, freqs.raise));

  // Step 4: Normalize to sum to 1.0
  const total = freqs.fold + freqs.call + freqs.raise;
  if (total > 0) {
    freqs.fold /= total;
    freqs.call /= total;
    freqs.raise /= total;
  } else {
    // Degenerate case: everything clamped to 0 — fold
    freqs.fold = 1;
    freqs.call = 0;
    freqs.raise = 0;
  }

  return freqs;
}

/**
 * Select the highest-frequency action from the mixed strategy.
 *
 * Returns the dominant action and its frequency. The caller (agents.ts)
 * handles frequency-based randomization via its own roll logic, so this
 * function is deterministic to keep the API consistent with the heuristic
 * getPreflopAction() which also returns a single deterministic action.
 */
function selectAction(
  freqs: ActionFrequencies,
): { action: 'fold' | 'call' | 'raise'; frequency: number } {
  if (freqs.raise >= freqs.call && freqs.raise >= freqs.fold) {
    return { action: 'raise', frequency: freqs.raise };
  }
  if (freqs.call >= freqs.fold) {
    return { action: 'call', frequency: freqs.call };
  }
  return { action: 'fold', frequency: freqs.fold };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get preflop action using CFR-solved GTO tables with style deviation.
 *
 * Returns null if CFR tables aren't available or the specific hand/position/
 * scenario isn't found in the table, signaling the caller to fall back to
 * the heuristic engine.
 */
export function getPreflopActionCFR(
  cards: [string, string],
  position: Position,
  style: SystemBotStyle,
  context: {
    facing3Bet: boolean;
    raisersAhead: number;
    stackBB: number;
    toCallBB?: number;
    potOdds?: number;
  },
): { action: 'fold' | 'call' | 'raise'; frequency: number } | null {
  if (!cfrTables) return null;

  // Quality gate: only use CFR tables when the solver has run enough iterations
  // to converge. Below this threshold, the data has too much noise (e.g., 97o
  // calling 4-bets, AA limping from UTG) and the heuristic is more reliable.
  const MIN_CONVERGED_ITERATIONS = 1_000_000;
  if (cfrTables.meta.iterations < MIN_CONVERGED_ITERATIONS) return null;

  // 1. Determine action sequence
  const actionSeq = getActionSequence(context.raisersAhead, context.facing3Bet);

  // Skip CFR for "unopened" — the heuristic open-raise ranges are well-tuned
  // and the solver's unopened data needs more iterations to converge.
  // CFR tables shine for facing_raise/3bet/4bet where heuristics are weakest.
  if (actionSeq === 'unopened') return null;

  // 2. Look up GTO strategy
  const gto = lookupGtoStrategy(cards, position, actionSeq);
  if (!gto) return null;

  // 3. Apply style deviation
  const styled = applyStyleDeviation(gto, style);

  // 4. Select action from mixed strategy
  const result = selectAction(styled);
  const label = canonicalizeLabel(cards);

  // ── Sanity checks ─────────────────────────────────────────────────────
  // These override solver noise for cases with clear poker-theoretic answers.
  const PREMIUMS = new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']);

  // (a) Premium hands should never fold in any scenario.
  if (PREMIUMS.has(label) && result.action === 'fold') {
    return { action: gto.raise > gto.call ? 'raise' : 'call', frequency: 0.9 };
  }

  // (b) Facing raises: if GTO says fold >85% in this scenario, the hand is
  //     true garbage — override style deviation to fold. Threshold is 85%
  //     (not lower) so loose styles can still call hands like 85o (fold ~77%)
  //     and station can call K3o (fold ~64%), preserving style differentiation.
  if (gto.fold > 0.85 && result.action !== 'fold') {
    return { action: 'fold', frequency: gto.fold };
  }

  // (d) Facing 3bet+: even looser threshold. If GTO says fold >40% and
  //     this is a 3bet+ scenario, fold. These are high-stakes decisions
  //     where style deviations shouldn't override solver judgment.
  if ((actionSeq === 'facing_3bet' || actionSeq === 'facing_4bet' || actionSeq === 'facing_allin')
      && gto.fold > 0.40 && result.action !== 'fold') {
    return { action: 'fold', frequency: gto.fold };
  }

  return result;
}

/**
 * Approximate hand strength from GTO play frequency in CFR tables.
 *
 * A hand GTO always raises ~ 1.0
 * A hand GTO always folds  ~ 0.0
 * Mixed: weighted combination
 *
 * Returns null if CFR tables aren't available or the hand isn't found.
 */
export function preflopHandStrengthCFR(
  cards: [string, string],
  position: Position,
  style: SystemBotStyle,
): number {
  const gto = lookupGtoStrategy(cards, position, 'unopened');
  if (!gto) {
    // Lazy import to avoid circular dependency (preflop-ranges -> preflop-cfr -> preflop-ranges)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { preflopHandStrength } = require('./preflop-ranges') as typeof import('./preflop-ranges');
    return preflopHandStrength(cards, position, style);
  }

  // Apply style deviation for strength estimate too
  const styled = applyStyleDeviation(gto, style);

  return styled.raise * 0.9 + styled.call * 0.5 + styled.fold * 0.05;
}
