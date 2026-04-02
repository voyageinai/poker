/**
 * Postflop style deviations for solver/GTO output.
 *
 * Same concept as preflop CFR style deviations (preflop-cfr.ts):
 * start from a GTO baseline and apply systematic shifts per bot style.
 *
 * The deviation parameters:
 * - bluffMult:  Multiplier on bluff frequencies (bet with weak hands)
 * - valueMult:  Multiplier on value bet frequencies (bet with strong hands)
 * - foldShift:  Additive shift to fold probability (positive = folds more)
 * - callShift:  Additive shift to call/check probability (positive = calls more)
 *
 * After applying deviations, probabilities are clamped to [0, 1] and
 * re-normalized to sum to 1.0.
 */

import type { SystemBotStyle } from '../strategy/preflop-ranges';
import type { ActionProbabilities } from './blueprint';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PostflopDeviation {
  bluffMult: number;    // multiplier on bet/raise with weak hands
  valueMult: number;    // multiplier on bet/raise with strong hands
  foldShift: number;    // additive shift to fold probability
  callShift: number;    // additive shift to call/check probability
}

// ─── Style deviation table ─────────────────────────────────────────────────

// ─── Postflop style deviations: match the character personalities ──────
//
// 司马懿 nit:     几乎不 bluff，只下注坚果牌。面对加注就弃
// 赵云 tag:       低频 bluff，精准 value bet。面对加注偶尔弃
// 孙悟空 lag:     高频 bluff，大额 value bet。很少弃牌面对加注
// 猪八戒 station: 从不 bluff，从不弃牌。疯狂跟注到 showdown
// 张飞 maniac:    疯狂 bluff，疯狂加注。永远选最激进的动作
// 王熙凤 trapper: 低频 bluff，但大牌 check 而不是 bet（慢打诱敌）
// 鲁智深 bully:   高频 bluff（欺软怕硬），正常 value bet
// 林冲 tilter:    基线沉稳（此处表示非 tilt 状态）
// 燕青 shortstack: 不 bluff（筹码宝贵），全押或弃
// 曹操 adaptive:  靠 safe-exploit 系统，基线同 GTO
// 诸葛亮 gto:     完美平衡
export const POSTFLOP_STYLE_DEVIATIONS: Record<SystemBotStyle, PostflopDeviation> = {
  gto:        { bluffMult: 1.0, valueMult: 1.0, foldShift: 0,     callShift: 0 },
  nit:        { bluffMult: 0.1, valueMult: 0.7, foldShift: +0.30, callShift: -0.20 },
  tag:        { bluffMult: 0.5, valueMult: 1.1, foldShift: +0.08, callShift: -0.08 },
  lag:        { bluffMult: 1.8, valueMult: 1.3, foldShift: -0.20, callShift: -0.05 },
  station:    { bluffMult: 0.0, valueMult: 0.6, foldShift: -0.45, callShift: +0.55 },
  maniac:     { bluffMult: 3.0, valueMult: 1.5, foldShift: -0.35, callShift: -0.10 },
  trapper:    { bluffMult: 0.3, valueMult: 0.4, foldShift: -0.05, callShift: +0.25 },
  bully:      { bluffMult: 1.8, valueMult: 1.2, foldShift: -0.15, callShift: -0.05 },
  tilter:     { bluffMult: 0.7, valueMult: 0.9, foldShift: +0.05, callShift: -0.05 },
  shortstack: { bluffMult: 0.2, valueMult: 1.2, foldShift: +0.10, callShift: -0.20 },
  adaptive:   { bluffMult: 1.0, valueMult: 1.0, foldShift: 0,     callShift: 0 },
};

// ─── Action classification ─────────────────────────────────────────────────

/** Bet/raise actions that can be bluffs or value bets */
const BET_RAISE_ACTIONS = new Set(['bet_33', 'bet_67', 'bet_100', 'bet_150', 'allin', 'raise']);
const FOLD_ACTIONS = new Set(['fold']);
const PASSIVE_ACTIONS = new Set(['check', 'call']);

/**
 * Classify whether a bet action is likely a bluff or value bet
 * based on the hand strength context.
 *
 * @param strength - Hand strength estimate (0..1)
 * @returns true if this is likely a bluff bet
 */
function isLikelyBluff(strength: number): boolean {
  // Below median strength: likely a bluff
  return strength < 0.45;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Apply postflop style deviations to a solver/GTO strategy.
 *
 * Takes a base strategy from the solver or blueprint and adjusts it
 * according to the bot's personality. The deviations are designed to
 * preserve the general structure of the GTO strategy while shifting
 * frequencies in style-appropriate ways.
 *
 * @param strategy  - Base GTO/solver strategy (action -> probability)
 * @param style     - Bot style to apply
 * @param strength  - Hand strength estimate (0..1), used to distinguish bluffs from value bets
 * @returns Adjusted strategy with style deviations applied
 */
export function applyPostflopStyleDeviation(
  strategy: ActionProbabilities,
  style: SystemBotStyle,
  strength: number,
): ActionProbabilities {
  const dev = POSTFLOP_STYLE_DEVIATIONS[style];

  // No deviations for GTO or adaptive (adaptive adjusts via opponent model, not style)
  if (style === 'gto' || style === 'adaptive') {
    return { ...strategy };
  }

  const result: ActionProbabilities = {};
  const isBluff = isLikelyBluff(strength);

  for (const [action, prob] of Object.entries(strategy)) {
    let adjusted = prob;

    if (BET_RAISE_ACTIONS.has(action)) {
      // Apply bluff or value multiplier based on hand strength
      const mult = isBluff ? dev.bluffMult : dev.valueMult;
      adjusted *= mult;
    } else if (FOLD_ACTIONS.has(action)) {
      adjusted += dev.foldShift;
    } else if (PASSIVE_ACTIONS.has(action)) {
      adjusted += dev.callShift;
    }

    // Clamp to non-negative
    result[action] = Math.max(0, adjusted);
  }

  // Normalize to sum to 1.0
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const action of Object.keys(result)) {
      result[action] /= total;
    }
  } else {
    // Degenerate: return original strategy
    return { ...strategy };
  }

  return result;
}

/**
 * Sample a single action from a probability distribution.
 * Uses weighted random selection.
 *
 * @param strategy - Action probability distribution
 * @returns Selected action string
 */
export function sampleAction(strategy: ActionProbabilities): string {
  const roll = Math.random();
  let cumulative = 0;

  const actions = Object.entries(strategy).sort(([, a], [, b]) => b - a);

  for (const [action, prob] of actions) {
    cumulative += prob;
    if (roll < cumulative) return action;
  }

  // Fallback: return highest probability action
  return actions[0]?.[0] ?? 'check';
}

/**
 * Select the most probable action from a strategy distribution.
 * Deterministic selection (no randomization).
 *
 * @param strategy - Action probability distribution
 * @returns Action with highest probability
 */
export function selectMaxAction(strategy: ActionProbabilities): string {
  let bestAction = '';
  let bestProb = -1;

  for (const [action, prob] of Object.entries(strategy)) {
    if (prob > bestProb) {
      bestProb = prob;
      bestAction = action;
    }
  }

  return bestAction || 'check';
}

// ─── Bet-size preference weighting ─────────────────────────────────────────
// When the solver outputs multiple bet sizes (bet_33, bet_67, bet_100, bet_150),
// the original code treated them identically across styles. This table shifts
// the size distribution per personality — maniac prefers overbets, nit prefers small.

const BET_SIZE_ACTIONS = new Set(['bet_33', 'bet_67', 'bet_100', 'bet_150', 'allin']);

const SIZE_PREFERENCE: Partial<Record<SystemBotStyle, Record<string, number>>> = {
  nit:        { bet_33: 2.0, bet_67: 1.0, bet_100: 0.3, bet_150: 0.1, allin: 0.1 },
  tag:        { bet_33: 1.2, bet_67: 1.3, bet_100: 0.8, bet_150: 0.4, allin: 0.3 },
  lag:        { bet_33: 0.6, bet_67: 1.2, bet_100: 1.5, bet_150: 1.2, allin: 0.8 },
  station:    { bet_33: 1.0, bet_67: 1.0, bet_100: 1.0, bet_150: 1.0, allin: 1.0 },
  maniac:     { bet_33: 0.3, bet_67: 0.8, bet_100: 1.5, bet_150: 2.5, allin: 1.5 },
  trapper:    { bet_33: 2.5, bet_67: 1.0, bet_100: 0.3, bet_150: 0.1, allin: 0.1 },
  bully:      { bet_33: 0.5, bet_67: 1.0, bet_100: 1.5, bet_150: 2.0, allin: 1.0 },
  tilter:     { bet_33: 0.8, bet_67: 1.0, bet_100: 1.2, bet_150: 1.0, allin: 0.8 },
  shortstack: { bet_33: 0.8, bet_67: 1.0, bet_100: 1.2, bet_150: 0.8, allin: 1.5 },
};

/**
 * Re-weight bet-size actions in a solver strategy according to style preferences.
 * Non-bet actions (fold, check, call) are untouched; only the distribution among
 * bet_33/bet_67/bet_100/bet_150/allin is shifted and re-normalized.
 */
export function applyStyleSizing(
  strategy: ActionProbabilities,
  style: SystemBotStyle,
): ActionProbabilities {
  const prefs = SIZE_PREFERENCE[style];
  // No preference table → return unchanged (gto, adaptive)
  if (!prefs) return strategy;

  const result: ActionProbabilities = {};
  let betTotal = 0;
  let origBetTotal = 0;

  // First pass: apply weights to bet-size actions, copy others unchanged
  for (const [action, prob] of Object.entries(strategy)) {
    if (BET_SIZE_ACTIONS.has(action) && prefs[action] !== undefined) {
      const weighted = prob * prefs[action];
      result[action] = weighted;
      betTotal += weighted;
      origBetTotal += prob;
    } else {
      result[action] = prob;
    }
  }

  // Re-normalize bet-size actions to preserve original total bet probability
  if (betTotal > 0 && origBetTotal > 0) {
    const scale = origBetTotal / betTotal;
    for (const action of Object.keys(result)) {
      if (BET_SIZE_ACTIONS.has(action)) {
        result[action] *= scale;
      }
    }
  }

  return result;
}
