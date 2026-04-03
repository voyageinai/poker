/**
 * Position-aware preflop hand evaluation for poker bots.
 *
 * Uses CFR-solved GTO strategy tables when available, falling back to
 * heuristic range tables that vary by position (UTG through BB) and bot
 * style. Provides hand strength scoring and action recommendations.
 */

import { getPreflopActionCFR } from './preflop-cfr';

export type Position = 'UTG' | 'EP' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export type SystemBotStyle =
  | 'nit' | 'tag' | 'lag' | 'station' | 'maniac'
  | 'trapper' | 'bully' | 'tilter' | 'shortstack' | 'adaptive' | 'gto';

export interface StyleRangeModifier {
  rfiShift: number;
  premiumBoost: number;
  suitedBonus: number;
  speculative: number;
}

interface DefenseProfile {
  maxToCallBB: number;
  callBonus: number;
  flatWindow: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RANK_ORDER = '23456789TJQKA';

/** Position RFI (Raise First In) thresholds — tighter from early, wider from late. */
const POSITION_RFI: Record<Position, number> = {
  UTG: 0.58,
  EP:  0.55,
  MP:  0.52,
  CO:  0.40,
  BTN: 0.28,
  SB:  0.32,
  BB:  0.20,
};

const STYLE_MODIFIERS: Record<SystemBotStyle, StyleRangeModifier> = {
  // v3: widened ranges across the board — less preflop folding, more action
  nit:        { rfiShift: -0.06, premiumBoost: 0.05,  suitedBonus: 0.02, speculative: -0.02 },
  tag:        { rfiShift:  0.08, premiumBoost: 0.03,  suitedBonus: 0.04, speculative: 0.06 },
  lag:        { rfiShift:  0.16, premiumBoost: 0.00,  suitedBonus: 0.05, speculative: 0.22 },
  station:    { rfiShift:  0.22, premiumBoost: -0.10, suitedBonus: 0.03, speculative: 0.08 },
  maniac:     { rfiShift:  0.28, premiumBoost: -0.05, suitedBonus: 0.04, speculative: 0.18 },
  trapper:    { rfiShift:  0.10, premiumBoost: 0.05,  suitedBonus: 0.04, speculative: 0.12 },
  bully:      { rfiShift:  0.10, premiumBoost: 0.00,  suitedBonus: 0.02, speculative: 0.06 },
  tilter:     { rfiShift:  0.08, premiumBoost: 0.00,  suitedBonus: 0.02, speculative: 0.05 },
  shortstack: { rfiShift:  0.04, premiumBoost: 0.08,  suitedBonus: 0.00, speculative: -0.04 },
  adaptive:   { rfiShift:  0.10, premiumBoost: 0.02,  suitedBonus: 0.04, speculative: 0.08 },
  gto:        { rfiShift:  0.06, premiumBoost: 0.02,  suitedBonus: 0.03, speculative: 0.05 },
};

const DEFENSE_PROFILES: Partial<Record<SystemBotStyle, DefenseProfile>> = {
  nit:      { maxToCallBB: 2.5, callBonus: 0.02, flatWindow: 0.02 },
  tag:      { maxToCallBB: 4.5, callBonus: 0.05, flatWindow: 0.04 },
  trapper:  { maxToCallBB: 6.5, callBonus: 0.10, flatWindow: 0.14 },
  shortstack:{ maxToCallBB: 2.5, callBonus: 0.04, flatWindow: 0.05 },
  adaptive: { maxToCallBB: 5.0, callBonus: 0.05, flatWindow: 0.05 },
  gto:      { maxToCallBB: 5.5, callBonus: 0.07, flatWindow: 0.06 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rankIndex(rank: string): number {
  return RANK_ORDER.indexOf(rank);
}

function suit(card: string): string {
  return card[card.length - 1];
}

function rank(card: string): string {
  return card.slice(0, -1);
}

interface CanonicalHand {
  highRank: number;
  lowRank: number;
  suited: boolean;
  pair: boolean;
  gap: number;
  label: string; // e.g. "AKs", "QTo", "88"
}

/** Convert two cards to canonical form: higher rank first, suited/offsuit marker. */
function canonicalize(cards: [string, string]): CanonicalHand {
  const r0 = rankIndex(rank(cards[0]));
  const r1 = rankIndex(rank(cards[1]));
  const isSuited = suit(cards[0]) === suit(cards[1]);

  const highRank = Math.max(r0, r1);
  const lowRank = Math.min(r0, r1);
  const isPair = r0 === r1;
  const gap = highRank - lowRank;

  const highChar = RANK_ORDER[highRank];
  const lowChar = RANK_ORDER[lowRank];
  const label = isPair
    ? `${highChar}${lowChar}`
    : `${highChar}${lowChar}${isSuited ? 's' : 'o'}`;

  return {
    highRank,
    lowRank,
    suited: isSuited,
    pair: isPair,
    gap,
    label,
  };
}

// ─── Base hand strength ───────────────────────────────────────────────────────

/**
 * Compute base hand strength (0~1) from a heuristic formula.
 * This does not account for position or style.
 */
function baseStrength(hand: CanonicalHand): number {
  let s = ((hand.highRank + hand.lowRank) / 28) * 0.35;

  // Pairs
  if (hand.pair) {
    s += 0.38 + hand.highRank / 28;
  }

  // Suited bonus
  if (hand.suited && !hand.pair) {
    s += 0.06;
  }

  // Connectivity
  if (hand.gap === 1) s += 0.07;
  else if (hand.gap === 2) s += 0.04;
  else if (hand.gap === 3) s += 0.02;

  // Broadway (both cards >= T)
  if (hand.highRank >= rankIndex('T') && hand.lowRank >= rankIndex('T')) {
    s += 0.08;
  }

  // Ace with broadway kicker
  if (hand.highRank === rankIndex('A') && hand.lowRank >= rankIndex('J')) {
    s += 0.08;
  }

  // High card bonus
  if (hand.highRank >= rankIndex('K')) {
    s += 0.05;
  }

  return s;
}

/**
 * Determine whether a hand is "speculative" — suited connectors, small pairs,
 * suited aces with low kickers. These play better deep-stacked.
 */
function isSpeculative(hand: CanonicalHand): boolean {
  // Small/medium pairs (22-88)
  if (hand.pair && hand.highRank <= rankIndex('8')) return true;
  // Suited connectors/one-gappers with both cards below T
  if (hand.suited && hand.gap <= 2 && hand.highRank < rankIndex('T')) return true;
  // Suited ace with low kicker
  if (hand.suited && hand.highRank === rankIndex('A') && hand.lowRank <= rankIndex('8')) return true;
  return false;
}

/**
 * Determine whether a hand is "premium" — top-tier hands like AA, KK, QQ, AKs, etc.
 */
function isPremium(hand: CanonicalHand): boolean {
  if (hand.pair && hand.highRank >= rankIndex('Q')) return true;
  if (hand.highRank === rankIndex('A') && hand.lowRank >= rankIndex('K')) return true;
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute position- and style-adjusted preflop hand strength (0~1).
 *
 * Higher is stronger. The result factors in base card strength plus
 * position advantage and style-specific bonuses/penalties.
 */
export function preflopHandStrength(
  cards: [string, string],
  position: Position,
  style: SystemBotStyle,
): number {
  const hand = canonicalize(cards);
  const mod = STYLE_MODIFIERS[style];

  let s = baseStrength(hand);

  // Style adjustments
  if (isPremium(hand)) s += mod.premiumBoost;
  if (hand.suited && !hand.pair) s += mod.suitedBonus;
  if (isSpeculative(hand)) s += mod.speculative;

  // Position adjustment: multiplicative so garbage hands don't get rescued by position.
  // Later position multiplies strength by up to 1.35 (BB), leaving junk hands weak.
  const posFactor = (0.58 - POSITION_RFI[position]) * 0.9;  // 0..0.342
  s *= (1 + posFactor);

  return Math.max(0, Math.min(1, s));
}

/**
 * Get the recommended preflop action for a given hand, position, style, and context.
 *
 * Returns an action (fold/call/raise) and a frequency (0~1) indicating how
 * often this action should be taken (useful for mixed strategies).
 */
export function getPreflopAction(
  cards: [string, string],
  position: Position,
  style: SystemBotStyle,
  context: {
    facing3Bet: boolean;
    raisersAhead: number;
    stackBB: number;
    toCallBB?: number;     // how many BB to call (enables commitment-based tightening)
    potOdds?: number;      // toCall / (pot + toCall), for call profitability
  },
): { action: 'fold' | 'call' | 'raise'; frequency: number; frequencies?: { fold: number; call: number; raise: number } } {
  // Try CFR-solved tables first (returns null if unavailable or hand not found)
  const cfrResult = getPreflopActionCFR(cards, position, style, context);
  if (cfrResult) return cfrResult;

  // Fallback to heuristic engine
  const hand = canonicalize(cards);
  const mod = STYLE_MODIFIERS[style];

  let strength = preflopHandStrength(cards, position, style);

  // Context adjustments
  // Facing a 3bet: tighten significantly
  if (context.facing3Bet) {
    strength -= 0.15;
  }

  // Raisers ahead: tighten per raiser
  strength -= context.raisersAhead * 0.06;

  // Short stack: reduce speculative hand value
  if (context.stackBB < 15 && isSpeculative(hand)) {
    strength -= 0.12;
  }

  // Gradual commitment penalty: the more BB you need to call, the tighter you should be.
  // Uses logarithmic scaling so 3-bets (6BB) still penalize junk, but all-ins (50BB)
  // don't nuke premium hands into negative territory.
  // At 6BB: log2(5)=2.32 → TAG penalty ~0.14.  At 50BB: log2(49)=5.61 → TAG penalty ~0.34.
  // v3: reduced commit penalties — bots less scared of calling 3bets
  const commitPenaltyCoeff: Record<SystemBotStyle, number> = {
    nit: 0.06, tag: 0.04, lag: 0.03, station: 0.02, maniac: 0.015,
    trapper: 0.035, bully: 0.03, tilter: 0.03, shortstack: 0.04, adaptive: 0.035, gto: 0.04,
  };
  if (context.toCallBB && context.toCallBB > 2) {
    const excessBB = context.toCallBB - 2;
    const logPenalty = Math.log2(1 + excessBB) * commitPenaltyCoeff[style];
    strength -= logPenalty;
  }

  // Station style prefers calling over raising against aggression
  const isCallStation = style === 'station';
  const defenseProfile = DEFENSE_PROFILES[style];
  const canDefend = defenseProfile
    && context.raisersAhead === 1
    && !!context.toCallBB
    && context.toCallBB > 0
    && context.toCallBB <= defenseProfile.maxToCallBB;
  const defensePositionMult = position === 'BB' ? 1.20
    : position === 'SB' ? 1.10
    : position === 'BTN' || position === 'CO' ? 1.05
    : 0.90;
  const defensePriceMult = context.toCallBB && context.toCallBB <= 2.5 ? 1.10 : 1.0;

  // Compute threshold: base RFI adjusted by style (floor of 0.06 prevents raising any-two)
  const rfiThreshold = Math.max(0.06, POSITION_RFI[position] - mod.rfiShift);

  // Call zone width varies by style
  // v3: widened call zones — even "tight" bots see more flops
  const callZoneWidth: Record<SystemBotStyle, number> = {
    nit:        0.10,
    tag:        0.14,
    lag:        0.14,
    station:    0.26,
    maniac:     0.16,
    trapper:    0.20,
    bully:      0.14,
    tilter:     0.14,
    shortstack: 0.12,
    adaptive:   0.18,
    gto:        0.12,
  };
  const defendBonus = canDefend
    ? defenseProfile.callBonus * defensePositionMult * defensePriceMult
    : 0;
  const callThreshold = rfiThreshold - callZoneWidth[style] - defendBonus;

  // Decision
  if (strength >= rfiThreshold) {
    if (isCallStation && context.raisersAhead > 0) {
      return { action: 'call', frequency: 0.85 };
    }
    if (canDefend && strength < rfiThreshold + defenseProfile.flatWindow * defensePositionMult) {
      return { action: 'call', frequency: Math.min(1, 0.60 + (strength - rfiThreshold + defenseProfile.flatWindow) * 2.5) };
    }
    return { action: 'raise', frequency: Math.min(1, 0.6 + (strength - rfiThreshold) * 2) };
  }

  if (strength >= callThreshold) {
    return { action: 'call', frequency: Math.min(1, 0.5 + (strength - callThreshold) * 3) };
  }

  return { action: 'fold', frequency: 1.0 };
}

// ─── Re-exports for CFR integration ──────────────────────────────────────────

export { getPreflopActionCFR, preflopHandStrengthCFR } from './preflop-cfr';
