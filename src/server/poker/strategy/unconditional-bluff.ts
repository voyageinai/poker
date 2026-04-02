/**
 * Unconditional Bluff Engine — position/texture-driven bluffs that ignore hand strength.
 *
 * This fires AFTER the playbook check but BEFORE the solver/heuristic path.
 * It handles routine positional bluffs and multi-street barrel continuations.
 * The playbook handles specific signature moves (random_shove, limp-reraise, etc.),
 * while this engine handles the everyday "I'm in position on a dry board, I bet."
 */

import type { SystemBotStyle } from './bet-sizing';
import type { BoardTexture } from './board-texture';

// ─── Types ──────────────────────────────────────────────────────────────────

type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
type Street = 'preflop' | 'flop' | 'turn' | 'river';

interface BluffConfig {
  positionRate: Record<Position, number>;
  dryBoardBonus: number;
  wetBoardPenalty: number;
  secondBarrelRate: number;
  thirdBarrelRate: number;
  sizingFraction: number;  // pot fraction for unconditional bluffs
}

// ─── Per-style configuration ────────────────────────────────────────────────

const BLUFF_CONFIG: Record<SystemBotStyle, BluffConfig | null> = {
  maniac: {
    positionRate: { UTG: 0.12, MP: 0.15, CO: 0.20, BTN: 0.25, SB: 0.18, BB: 0.10 },
    dryBoardBonus: 0.10,
    wetBoardPenalty: 0.08,
    secondBarrelRate: 0.65,
    thirdBarrelRate: 0.40,
    sizingFraction: 0.80,
  },
  lag: {
    positionRate: { UTG: 0.05, MP: 0.08, CO: 0.12, BTN: 0.18, SB: 0.10, BB: 0.05 },
    dryBoardBonus: 0.08,
    wetBoardPenalty: 0.06,
    secondBarrelRate: 0.45,
    thirdBarrelRate: 0.20,
    sizingFraction: 0.67,
  },
  bully: {
    positionRate: { UTG: 0.08, MP: 0.10, CO: 0.15, BTN: 0.20, SB: 0.12, BB: 0.06 },
    dryBoardBonus: 0.05,
    wetBoardPenalty: 0.05,
    secondBarrelRate: 0.50,
    thirdBarrelRate: 0.25,
    sizingFraction: 1.00,
  },
  tag: {
    positionRate: { UTG: 0, MP: 0.03, CO: 0.08, BTN: 0.12, SB: 0.05, BB: 0 },
    dryBoardBonus: 0.05,
    wetBoardPenalty: 0.04,
    secondBarrelRate: 0.32,
    thirdBarrelRate: 0.12,
    sizingFraction: 0.58,
  },
  nit: {
    positionRate: { UTG: 0, MP: 0, CO: 0, BTN: 0.02, SB: 0, BB: 0 },
    dryBoardBonus: 0,
    wetBoardPenalty: 0,
    secondBarrelRate: 0.05,
    thirdBarrelRate: 0,
    sizingFraction: 0.33,
  },
  trapper: {
    positionRate: { UTG: 0, MP: 0.02, CO: 0.03, BTN: 0.05, SB: 0.02, BB: 0 },
    dryBoardBonus: 0.05,
    wetBoardPenalty: 0.03,
    secondBarrelRate: 0.15,
    thirdBarrelRate: 0.08,
    sizingFraction: 0.50,
  },
  // These styles don't use positional bluffs — handled elsewhere
  station: null,
  tilter: null,      // tilter bluffs via playbook (revenge_raise)
  shortstack: null,  // uses push/fold
  adaptive: null,    // mirrors opponent
  gto: null,         // balanced bluffs from solver
};

// ─── Public API ─────────────────────────────────────────────────────────────

export interface BluffResult {
  action: 'raise' | 'allin';
  amount: number;
  isBluffLine: boolean;
  source: string;  // 'positional_bluff' | 'second_barrel' | 'third_barrel'
}

export function checkUnconditionalBluff(
  style: SystemBotStyle,
  position: Position,
  street: Street,
  texture: BoardTexture | null,
  facingBet: boolean,
  currentBluffLine: boolean,
  bluffStreetCount: number,
  pot: number,
  stack: number,
  minRaise: number,
  currentBet: number,
  toCall: number,
  bigBlind: number,
): BluffResult | null {
  // Preflop unconditional bluffs are handled by playbook (3bet_light, squeeze, etc.)
  if (street === 'preflop') return null;

  const cfg = BLUFF_CONFIG[style];
  if (!cfg) return null;

  // Multi-street barrel continuation: already in a bluff line
  if (currentBluffLine && !facingBet) {
    let continueRate: number;
    let source: string;
    if (bluffStreetCount === 1) {
      // Fired one barrel (flop), considering second (turn)
      continueRate = cfg.secondBarrelRate;
      source = 'second_barrel';
    } else if (bluffStreetCount >= 2) {
      // Fired two barrels, considering third (river)
      continueRate = cfg.thirdBarrelRate;
      source = 'third_barrel';
    } else {
      continueRate = cfg.secondBarrelRate;
      source = 'second_barrel';
    }

    if (Math.random() < continueRate) {
      return buildBluffAction(cfg.sizingFraction, pot, stack, minRaise, currentBet, toCall, true, source);
    }
    // Decided not to continue — bluff line ends
    return null;
  }

  // New bluff: only when not facing a bet (we're first to act or checked to)
  if (facingBet) return null;

  // Compute bluff rate from position + board texture
  let rate = cfg.positionRate[position] ?? 0;

  if (texture) {
    if (texture.wetness < 0.25) {
      rate += cfg.dryBoardBonus;
    } else if (texture.wetness > 0.55) {
      rate -= cfg.wetBoardPenalty;
    }
  }

  if (rate <= 0) return null;
  if (Math.random() >= rate) return null;

  return buildBluffAction(cfg.sizingFraction, pot, stack, minRaise, currentBet, toCall, true, 'positional_bluff');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildBluffAction(
  fraction: number,
  pot: number,
  stack: number,
  minRaise: number,
  currentBet: number,
  toCall: number,
  isBluffLine: boolean,
  source: string,
): BluffResult {
  let amount = Math.round(pot * fraction);

  // Legal clamping
  if (amount < minRaise) amount = minRaise;
  const raiseTotal = currentBet + amount;
  const maxTotal = currentBet + stack - toCall;

  if (raiseTotal >= maxTotal) {
    return { action: 'allin', amount: stack, isBluffLine, source };
  }

  return { action: 'raise', amount: raiseTotal, isBluffLine, source };
}
