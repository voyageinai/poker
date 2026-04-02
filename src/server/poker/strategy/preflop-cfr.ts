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

// ─── Style deviations: each bot's personality shifts from GTO baseline ───
// These are AGGRESSIVE deviations — designed to make each bot feel distinct.
//
// 司马懿 nit:     "隐忍蛰伏，只在必胜时出手" → 极窄范围，大量弃牌
// 赵云 tag:       "攻守兼备，牌力精准" → 略紧于GTO，精确价值下注
// 孙悟空 lag:     "出牌范围无边界，全程高压" → 宽范围，高加注频率
// 猪八戒 station: "什么牌都想看看" → 几乎不弃牌，大量跟注
// 张飞 maniac:    "逢牌必加，疯狂下注" → 极宽范围，疯狂加注
// 王熙凤 trapper: "慢打大牌设埋伏" → 大牌跟注不加注，诱导对手下注
// 鲁智深 bully:   "专挑短码欺负" → 宽范围持续施压
// 林冲 tilter:    "平时沉稳，连输后怒火" → 基线略紧（平时状态）
// 燕青 shortstack: "以小博大全下逼迫" → 紧范围，高加注（push/fold）
// 曹操 adaptive:  "观察弱点精准剥削" → 基线同GTO，靠 safe-exploit 系统偏移
// 诸葛亮 gto:     "攻守完美平衡" → 零偏移
const STYLE_DEVIATIONS: Record<SystemBotStyle, StyleDeviation> = {
  gto:        { rangeScale: 1.0,  foldShift: 0,      raiseShift: 0,      callShift: 0 },
  nit:        { rangeScale: 0.40, foldShift: +0.28,  raiseShift: -0.08,  callShift: -0.20 },
  tag:        { rangeScale: 0.80, foldShift: +0.10,  raiseShift: +0.05,  callShift: -0.15 },
  lag:        { rangeScale: 1.5,  foldShift: -0.25,  raiseShift: +0.30,  callShift: -0.05 },
  station:    { rangeScale: 2.0,  foldShift: -0.60,  raiseShift: -0.25,  callShift: +0.85 },
  maniac:     { rangeScale: 2.5,  foldShift: -0.50,  raiseShift: +0.55,  callShift: -0.05 },
  trapper:    { rangeScale: 0.85, foldShift: +0.05,  raiseShift: -0.25,  callShift: +0.20 },
  bully:      { rangeScale: 1.3,  foldShift: -0.15,  raiseShift: +0.20,  callShift: -0.05 },
  tilter:     { rangeScale: 0.85, foldShift: +0.08,  raiseShift: 0,      callShift: -0.08 },
  shortstack: { rangeScale: 0.65, foldShift: +0.15,  raiseShift: +0.15,  callShift: -0.30 },
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

  // 2. Look up GTO strategy
  const gto = lookupGtoStrategy(cards, position, actionSeq);
  if (!gto) return null;

  // 3. Apply style deviation
  const styled = applyStyleDeviation(gto, style);

  // 4. Select action from mixed strategy
  const result = selectAction(styled);
  const label = canonicalizeLabel(cards);

  // ── Semantic fixes and sanity checks ────────────────────────────────
  const PREMIUMS = new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']);

  // BB unopened: CFR "call" = "check for free" (no cost to see flop).
  // The caller (agents.ts) expects "fold" → converts to "check" when toCall=0.
  // Return "fold" when GTO doesn't raise, matching the heuristic semantic.
  // Exception: premium hands should always raise (not get converted to fold).
  if (position === 'BB' && actionSeq === 'unopened' && result.action === 'call' && !PREMIUMS.has(label)) {
    return { action: 'fold', frequency: 1 - styled.raise };
  }

  // (a) Premium hands: always raise (never fold or just call).
  //     Station deviation can turn AA into "call" due to massive callShift,
  //     but AA should raise from any position with any style.
  if (PREMIUMS.has(label) && result.action !== 'raise') {
    return { action: 'raise', frequency: 0.95 };
  }

  // (b) Garbage override: if GTO says fold >96% AND the style isn't
  //     inherently loose (station/maniac), force fold.
  //     Station ("什么牌都想看看") and maniac ("逢牌必加") SKIP this check
  //     because their whole identity is playing garbage hands.
  // Style-dependent garbage thresholds:
  // - station: "什么牌都想看看" → almost never forced to fold (threshold 100%)
  // - maniac: "逢牌必加" when unopened, but facing raises has a floor (99%)
  // - other styles: standard threshold (96%)
  const garbageThreshold = style === 'station' ? 1.01  // station: never forced fold
    : style === 'maniac' ? 0.965                        // maniac: fold the very worst garbage facing raises
    : 0.96;                                              // others: standard

  if (gto.fold > garbageThreshold && result.action !== 'fold') {
    return { action: 'fold', frequency: gto.fold };
  }

  // (d) Facing 3bet+: tighter threshold.
  //     station skips this entirely (calls anything).
  //     maniac: respects 3bet+ with a high bar (90%).
  //     others: strict threshold (40%).
  if (actionSeq === 'facing_3bet' || actionSeq === 'facing_4bet' || actionSeq === 'facing_allin') {
    // Station still folds against 4bet+ (even 猪八戒 isn't THAT loose)
    // Maniac folds some garbage against 3bet
    const foldBar = style === 'station' ? 0.70 : style === 'maniac' ? 0.80 : 0.40;
    if (gto.fold > foldBar && result.action !== 'fold') {
      return { action: 'fold', frequency: gto.fold };
    }
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
