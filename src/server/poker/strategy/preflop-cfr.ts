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

interface DefenseProfile {
  maxToCallBB: number;
  foldToCall: number;
  raiseToCall: number;
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
// v3.3: fix three problems:
// 1) Big hands folding to raises → more callShift, less raiseShift
//    (bots were: can't raise → fold, instead of: can't raise → call)
// 2) Every hand has all-in → reduce raiseShift across board
// 3) No slow-play/check-raise → trapper/nit need call not raise preflop
const STYLE_DEVIATIONS: Record<SystemBotStyle, StyleDeviation> = {
  gto:        { rangeScale: 1.2,  foldShift: -0.10,  raiseShift: +0.02,  callShift: +0.08 },
  nit:        { rangeScale: 0.90, foldShift: -0.02,  raiseShift: -0.05,  callShift: +0.07 },
  tag:        { rangeScale: 1.15, foldShift: -0.08,  raiseShift: +0.02,  callShift: +0.06 },
  lag:        { rangeScale: 1.6,  foldShift: -0.25,  raiseShift: +0.12,  callShift: +0.13 },
  station:    { rangeScale: 2.5,  foldShift: -0.65,  raiseShift: -0.25,  callShift: +0.90 },
  maniac:     { rangeScale: 2.5,  foldShift: -0.45,  raiseShift: +0.30,  callShift: +0.15 },
  trapper:    { rangeScale: 1.4,  foldShift: -0.15,  raiseShift: -0.15,  callShift: +0.30 },
  bully:      { rangeScale: 1.4,  foldShift: -0.18,  raiseShift: +0.08,  callShift: +0.10 },
  tilter:     { rangeScale: 1.2,  foldShift: -0.08,  raiseShift: +0.00,  callShift: +0.08 },
  shortstack: { rangeScale: 1.1,  foldShift: -0.06,  raiseShift: +0.12,  callShift: -0.06 },
  adaptive:   { rangeScale: 1.3,  foldShift: -0.12,  raiseShift: +0.04,  callShift: +0.08 },
};

// v3: wider defense — bots call raises more often to see flops
const DEFENSE_PROFILES: Partial<Record<SystemBotStyle, DefenseProfile>> = {
  nit:      { maxToCallBB: 4.0, foldToCall: 0.10, raiseToCall: 0.04 },
  tag:      { maxToCallBB: 6.0, foldToCall: 0.14, raiseToCall: 0.08 },
  trapper:  { maxToCallBB: 8.0, foldToCall: 0.20, raiseToCall: 0.15 },
  bully:    { maxToCallBB: 6.0, foldToCall: 0.12, raiseToCall: 0.10 },
  tilter:   { maxToCallBB: 5.0, foldToCall: 0.10, raiseToCall: 0.06 },
  shortstack:{ maxToCallBB: 4.0, foldToCall: 0.10, raiseToCall: 0.10 },
  adaptive: { maxToCallBB: 6.0, foldToCall: 0.14, raiseToCall: 0.08 },
  gto:      { maxToCallBB: 6.5, foldToCall: 0.16, raiseToCall: 0.08 },
  lag:      { maxToCallBB: 7.0, foldToCall: 0.16, raiseToCall: 0.12 },
  station:  { maxToCallBB: 10.0, foldToCall: 0.25, raiseToCall: 0.05 },
  maniac:   { maxToCallBB: 8.0, foldToCall: 0.15, raiseToCall: 0.15 },
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

function applyDefenseBias(
  freqs: ActionFrequencies,
  style: SystemBotStyle,
  position: Position,
  actionSeq: ActionSequence,
  context: {
    toCallBB?: number;
  },
): ActionFrequencies {
  const profile = DEFENSE_PROFILES[style];
  if (!profile) return freqs;
  if (actionSeq !== 'facing_raise') return freqs;
  if (!context.toCallBB || context.toCallBB <= 0 || context.toCallBB > profile.maxToCallBB) return freqs;

  const positionMult = position === 'BB' ? 1.20
    : position === 'SB' ? 1.10
    : position === 'BTN' || position === 'CO' ? 1.05
    : 0.90;
  const priceMult = context.toCallBB <= 2.5 ? 1.10 : 1.0;

  const foldShift = Math.min(freqs.fold, profile.foldToCall * positionMult * priceMult);
  const raiseShift = Math.min(freqs.raise, profile.raiseToCall * positionMult);
  const call = freqs.call + foldShift + raiseShift;
  const fold = freqs.fold - foldShift;
  const raise = freqs.raise - raiseShift;

  return { fold, call, raise };
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
): { action: 'fold' | 'call' | 'raise'; frequency: number; frequencies: ActionFrequencies } {
  if (freqs.raise >= freqs.call && freqs.raise >= freqs.fold) {
    return { action: 'raise', frequency: freqs.raise, frequencies: freqs };
  }
  if (freqs.call >= freqs.fold) {
    return { action: 'call', frequency: freqs.call, frequencies: freqs };
  }
  return { action: 'fold', frequency: freqs.fold, frequencies: freqs };
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
): { action: 'fold' | 'call' | 'raise'; frequency: number; frequencies?: { fold: number; call: number; raise: number } } | null {
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
  let styled = applyStyleDeviation(gto, style);
  styled = applyDefenseBias(styled, style, position, actionSeq, context);

  // ── Limp→raise correction for raise-first-in styles ──────────────────
  // CFR tables include limps in the GTO equilibrium. For styles that should
  // play raise-or-fold preflop, convert limp frequency to raise/fold.
  // White-list ensures station/maniac/trapper limp behavior is preserved.
  const LIMP_CORRECTION_STYLES: Set<SystemBotStyle> = new Set(['gto', 'tag', 'nit', 'shortstack']);
  if (actionSeq === 'unopened' && position !== 'BB' && LIMP_CORRECTION_STYLES.has(style)) {
    const limpToRaise = position === 'SB' ? 0.40 : 0.70;
    const callFreq = styled.call;
    if (callFreq > 0.01) {
      styled.raise += callFreq * limpToRaise;
      styled.fold += callFreq * (1 - limpToRaise);
      styled.call = 0;
      const total = styled.fold + styled.call + styled.raise;
      if (total > 0) { styled.fold /= total; styled.call /= total; styled.raise /= total; }
    }
  }

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

  // (b) Garbage override for FACING ACTION only.
  //     For UNOPENED pots the style deviation system (rangeScale, foldShift, etc.)
  //     already defines each style's opening range — selectAction() naturally folds
  //     garbage for tight styles and opens wide for loose ones.  No override needed.
  //     For FACING ACTION, use raw GTO fold frequency as a sanity cap so that even
  //     LAG/maniac don't call raises with 72o.
  if (actionSeq !== 'unopened') {
    const garbageThreshold = style === 'station' ? 1.01  // station: never forced fold
      : style === 'maniac' ? 0.965                        // maniac: fold the very worst garbage facing raises
      : 0.96;                                              // others: standard

    if (gto.fold > garbageThreshold && result.action !== 'fold') {
      return { action: 'fold', frequency: gto.fold };
    }
  }

  // (d) Facing 3bet+: tighter threshold.
  //     station skips this entirely (calls anything).
  //     maniac: respects 3bet+ with a high bar (90%).
  //     others: strict threshold (40%).
  //     SKIP when pot odds are trivially good (e.g. min-3bet after flat-calling):
  //     folding 20 into 310+ pot is never correct regardless of hand strength.
  const cheapToCall = context.potOdds !== undefined && context.potOdds < 0.12;
  if (!cheapToCall && (actionSeq === 'facing_3bet' || actionSeq === 'facing_4bet' || actionSeq === 'facing_allin')) {
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
