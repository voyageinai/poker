/**
 * Playbook System — per-style signature moves that fire BEFORE the solver/heuristic path.
 *
 * Each style defines 2-4 PlayPatterns with trigger conditions and actions.
 * Patterns can be unconditional (no hand strength check) for genuine bluffs.
 * Matched patterns override the solver completely — this is how bots get
 * "a play you can identify them by."
 */

import type { SystemBotStyle } from './bet-sizing';
import type { BoardTexture } from './board-texture';

// ─── Types ──────────────────────────────────────────────────────────────────

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export type SizingSpec =
  | { mode: 'pot_fraction'; fraction: number }
  | { mode: 'bb_multiple'; multiple: number }
  | { mode: 'allin' }
  | { mode: 'minraise' }
  | { mode: 'prev_bet_multiple'; multiple: number };

interface PatternTrigger {
  streets?: Street[];
  positions?: Position[];
  facingAction?: 'none' | 'bet' | 'raise';
  maxOpponents?: number;
  minOpponents?: number;
  stackDepthBB?: [number, number];
  boardWetnessRange?: [number, number];
  priorMyActions?: Array<{ street: Street; action: string }>;
  chipAdvantageRatio?: number;
  tiltMin?: number;
}

interface PatternAction {
  type: 'raise' | 'allin' | 'check' | 'call' | 'fold';
  sizing?: SizingSpec;
}

export interface PlayPattern {
  name: string;
  trigger: PatternTrigger;
  action: PatternAction;
  frequency: number;
  strengthGate?: [number, number] | null;
}

export interface PlaybookContext {
  street: Street;
  position: Position;
  facingAction: 'none' | 'bet' | 'raise';
  opponents: number;
  stackBB: number;
  pot: number;
  stack: number;
  toCall: number;
  minRaise: number;
  currentBet: number;
  boardTexture: BoardTexture | null;
  strength: number;
  priorMyActions: Array<{ street: Street; action: string }>;
  chipAdvantageRatio: number;
  tiltLevel: number;
  bigBlind: number;
}

// ─── Per-style Playbooks ────────────────────────────────────────────────────

const PLAYBOOKS: Record<SystemBotStyle, PlayPattern[]> = {

  // 张飞 maniac: 完全不看牌的疯狂招数
  maniac: [
    {
      name: 'random_shove',
      trigger: { streets: ['flop', 'turn', 'river'], facingAction: 'none', maxOpponents: 2 },
      action: { type: 'allin' },
      frequency: 0.08,
      strengthGate: null,
    },
    {
      name: 'overbet_bluff',
      trigger: { streets: ['turn', 'river'], facingAction: 'none', positions: ['BTN', 'CO'] },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 1.5 } },
      frequency: 0.15,
      strengthGate: null,
    },
    {
      name: '3bet_light',
      trigger: { streets: ['preflop'], facingAction: 'raise' },
      action: { type: 'raise', sizing: { mode: 'prev_bet_multiple', multiple: 3.5 } },
      frequency: 0.20,
      strengthGate: null,
    },
    {
      name: 'donk_bomb',
      trigger: { streets: ['flop'], facingAction: 'none', positions: ['UTG', 'MP', 'SB', 'BB'] },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 1.0 } },
      frequency: 0.12,
      strengthGate: null,
    },
  ],

  // 王熙凤 trapper: 示弱引诱，请君入瓮
  trapper: [
    {
      name: 'limp_reraise',
      trigger: {
        streets: ['preflop'],
        facingAction: 'raise',
        priorMyActions: [{ street: 'preflop', action: 'call' }],
      },
      action: { type: 'raise', sizing: { mode: 'prev_bet_multiple', multiple: 4.0 } },
      frequency: 0.48,
      strengthGate: [0.52, 1.0],
    },
    {
      name: 'flat_preflop_trap',
      trigger: {
        streets: ['preflop'],
        positions: ['CO', 'BTN', 'SB', 'BB'],
        facingAction: 'raise',
      },
      action: { type: 'call' },
      frequency: 0.42,
      strengthGate: [0.42, 0.92],
    },
    {
      name: 'delayed_cbet',
      trigger: {
        streets: ['turn'],
        facingAction: 'none',
        priorMyActions: [{ street: 'flop', action: 'check' }],
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.75 } },
      frequency: 0.42,
      strengthGate: [0.38, 1.0],
    },
    {
      name: 'flop_peel_trap',
      trigger: {
        streets: ['flop'],
        facingAction: 'bet',
        priorMyActions: [{ street: 'preflop', action: 'call' }],
      },
      action: { type: 'call' },
      frequency: 0.50,
      strengthGate: [0.18, 0.80],
    },
    {
      name: 'turn_peel_trap',
      trigger: {
        streets: ['turn'],
        facingAction: 'bet',
        priorMyActions: [
          { street: 'preflop', action: 'call' },
          { street: 'flop', action: 'call' },
        ],
      },
      action: { type: 'call' },
      frequency: 0.34,
      strengthGate: [0.28, 0.56],
    },
    {
      name: 'min_raise_trap',
      trigger: { streets: ['flop', 'turn', 'river'], facingAction: 'bet' },
      action: { type: 'raise', sizing: { mode: 'minraise' } },
      frequency: 0.62,
      strengthGate: [0.62, 1.0],
    },
    {
      name: 'check_call_then_raise',
      trigger: {
        streets: ['turn'],
        facingAction: 'bet',
        priorMyActions: [{ street: 'flop', action: 'call' }],
      },
      action: { type: 'raise', sizing: { mode: 'prev_bet_multiple', multiple: 2.5 } },
      frequency: 0.42,
      strengthGate: [0.50, 1.0],
    },
  ],

  // 鲁智深 bully: 用筹码碾压
  bully: [
    {
      name: 'overbet_pressure',
      trigger: {
        streets: ['flop', 'turn', 'river'],
        facingAction: 'none',
        chipAdvantageRatio: 1.5,
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 1.2 } },
      frequency: 0.20,
      strengthGate: null,
    },
    {
      name: 'steal_reraise',
      trigger: {
        streets: ['preflop'],
        positions: ['BTN', 'CO'],
        facingAction: 'raise',
        chipAdvantageRatio: 1.5,
      },
      action: { type: 'raise', sizing: { mode: 'prev_bet_multiple', multiple: 3.5 } },
      frequency: 0.25,
      strengthGate: null,
    },
    {
      name: 'river_bully',
      trigger: {
        streets: ['river'],
        facingAction: 'none',
        chipAdvantageRatio: 2.0,
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 1.5 } },
      frequency: 0.18,
      strengthGate: null,
    },
  ],

  // 司马懿 nit: 极度保守
  nit: [
    {
      name: 'snap_fold',
      trigger: { streets: ['flop', 'turn', 'river'], facingAction: 'bet' },
      action: { type: 'fold' },
      frequency: 0.15,
      strengthGate: [0, 0.55],
    },
    {
      name: 'micro_cbet',
      trigger: { streets: ['flop'], facingAction: 'none' },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.25 } },
      frequency: 0.60,
      strengthGate: [0.35, 1.0],
    },
  ],

  // 猪八戒 station: 不可能被 bluff 走
  station: [
    {
      name: 'hero_call',
      trigger: { streets: ['river'], facingAction: 'bet' },
      action: { type: 'call' },
      frequency: 0.30,
      strengthGate: null,
    },
    {
      name: 'call_down',
      trigger: { streets: ['turn', 'river'], facingAction: 'raise' },
      action: { type: 'call' },
      frequency: 0.20,
      strengthGate: null,
    },
  ],

  // 林冲 tilter: 情绪化报复
  tilter: [
    {
      name: 'revenge_raise',
      trigger: { streets: ['flop', 'turn', 'river'], tiltMin: 0.3 },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 1.0 } },
      frequency: 0.25,
      strengthGate: null,
    },
    {
      name: 'tilt_shove',
      trigger: { tiltMin: 0.7 },
      action: { type: 'allin' },
      frequency: 0.10,
      strengthGate: null,
    },
  ],

  // 孙悟空 lag: 位置利用
  lag: [
    {
      name: 'float_then_stab',
      trigger: {
        streets: ['turn'],
        facingAction: 'none',
        priorMyActions: [{ street: 'flop', action: 'call' }],
        positions: ['BTN', 'CO'],
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.67 } },
      frequency: 0.25,
      strengthGate: null,
    },
    {
      name: 'squeeze',
      trigger: {
        streets: ['preflop'],
        facingAction: 'raise',
        minOpponents: 2,
      },
      action: { type: 'raise', sizing: { mode: 'prev_bet_multiple', multiple: 4.0 } },
      frequency: 0.30,
      strengthGate: [0.30, 1.0],
    },
    {
      name: 'probe_bet',
      trigger: {
        streets: ['turn', 'river'],
        facingAction: 'none',
        positions: ['BTN', 'CO'],
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.50 } },
      frequency: 0.20,
      strengthGate: null,
    },
  ],

  // 燕青 shortstack: Push/fold 变体
  shortstack: [
    {
      name: 'stop_and_go',
      trigger: {
        streets: ['flop'],
        facingAction: 'none',
        stackDepthBB: [0, 16],
        priorMyActions: [{ street: 'preflop', action: 'call' }],
      },
      action: { type: 'allin' },
      frequency: 0.28,
      strengthGate: [0.25, 1.0],
    },
    {
      name: 'resteal_shove',
      trigger: {
        streets: ['preflop'],
        positions: ['BTN', 'CO', 'SB'],
        facingAction: 'raise',
        stackDepthBB: [0, 18],
      },
      action: { type: 'allin' },
      frequency: 0.32,
      strengthGate: [0.30, 1.0],
    },
  ],

  // 曹操 adaptive: 先探，再压，再换脸
  adaptive: [
    {
      name: 'pressure_probe',
      trigger: {
        streets: ['flop', 'turn'],
        positions: ['CO', 'BTN'],
        facingAction: 'none',
        maxOpponents: 2,
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.55 } },
      frequency: 0.18,
      strengthGate: null,
    },
    {
      name: 'delayed_takeover',
      trigger: {
        streets: ['turn'],
        positions: ['CO', 'BTN'],
        facingAction: 'none',
        priorMyActions: [{ street: 'flop', action: 'check' }],
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.70 } },
      frequency: 0.24,
      strengthGate: null,
    },
    {
      name: 'iso_reraise',
      trigger: {
        streets: ['preflop'],
        positions: ['CO', 'BTN', 'SB'],
        facingAction: 'raise',
      },
      action: { type: 'raise', sizing: { mode: 'prev_bet_multiple', multiple: 3.2 } },
      frequency: 0.18,
      strengthGate: [0.22, 1.0],
    },
  ],

  // 赵云 tag: 稳健，无签名招数
  tag: [],

  // 诸葛亮 gto: 低频可见线，仍保持小尺度和平衡感
  gto: [
    {
      name: 'range_small_cbet',
      trigger: {
        streets: ['flop'],
        positions: ['CO', 'BTN'],
        facingAction: 'none',
        maxOpponents: 2,
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.33 } },
      frequency: 0.12,
      strengthGate: null,
    },
    {
      name: 'river_block_bet',
      trigger: {
        streets: ['river'],
        positions: ['CO', 'BTN', 'SB', 'BB'],
        facingAction: 'none',
      },
      action: { type: 'raise', sizing: { mode: 'pot_fraction', fraction: 0.25 } },
      frequency: 0.10,
      strengthGate: [0.38, 0.72],
    },
  ],
};

// ─── Matching Engine ────────────────────────────────────────────────────────

function matchesTrigger(trigger: PatternTrigger, ctx: PlaybookContext): boolean {
  if (trigger.streets && !trigger.streets.includes(ctx.street)) return false;
  if (trigger.positions && !trigger.positions.includes(ctx.position)) return false;

  if (trigger.facingAction !== undefined) {
    if (trigger.facingAction !== ctx.facingAction) return false;
  }

  if (trigger.maxOpponents !== undefined && ctx.opponents > trigger.maxOpponents) return false;
  if (trigger.minOpponents !== undefined && ctx.opponents < trigger.minOpponents) return false;

  if (trigger.stackDepthBB) {
    if (ctx.stackBB < trigger.stackDepthBB[0] || ctx.stackBB > trigger.stackDepthBB[1]) return false;
  }

  if (trigger.boardWetnessRange && ctx.boardTexture) {
    if (ctx.boardTexture.wetness < trigger.boardWetnessRange[0]
      || ctx.boardTexture.wetness > trigger.boardWetnessRange[1]) return false;
  }

  if (trigger.chipAdvantageRatio !== undefined) {
    if (ctx.chipAdvantageRatio < trigger.chipAdvantageRatio) return false;
  }

  if (trigger.tiltMin !== undefined) {
    if (ctx.tiltLevel < trigger.tiltMin) return false;
  }

  if (trigger.priorMyActions) {
    for (const required of trigger.priorMyActions) {
      const found = ctx.priorMyActions.some(
        a => a.street === required.street && a.action === required.action,
      );
      if (!found) return false;
    }
  }

  return true;
}

function resolveAmount(sizing: SizingSpec, ctx: PlaybookContext): number {
  switch (sizing.mode) {
    case 'pot_fraction':
      return Math.round(ctx.pot * sizing.fraction);
    case 'bb_multiple':
      return Math.round(ctx.bigBlind * sizing.multiple);
    case 'allin':
      return ctx.stack;
    case 'minraise':
      return ctx.minRaise;
    case 'prev_bet_multiple':
      return Math.round(Math.max(ctx.currentBet, ctx.bigBlind) * sizing.multiple);
  }
}

export interface PlaybookResult {
  patternName: string;
  action: 'raise' | 'allin' | 'check' | 'call' | 'fold';
  amount: number;
}

export function matchPlaybook(
  style: SystemBotStyle,
  ctx: PlaybookContext,
): PlaybookResult | null {
  const patterns = PLAYBOOKS[style];
  if (!patterns || patterns.length === 0) return null;

  for (const pattern of patterns) {
    // Check trigger conditions
    if (!matchesTrigger(pattern.trigger, ctx)) continue;

    // Check strength gate
    if (pattern.strengthGate) {
      if (ctx.strength < pattern.strengthGate[0] || ctx.strength > pattern.strengthGate[1]) continue;
    }

    // Roll dice for frequency
    if (Math.random() >= pattern.frequency) continue;

    // Pattern matched — resolve action
    let action = pattern.action.type;
    let amount = 0;

    if (action === 'allin') {
      amount = ctx.stack;
      action = 'allin';
    } else if (action === 'raise' && pattern.action.sizing) {
      amount = resolveAmount(pattern.action.sizing, ctx);
      // Legal clamping
      const minTotal = ctx.currentBet + ctx.minRaise;
      const maxTotal = ctx.currentBet + ctx.stack - ctx.toCall;
      if (amount < ctx.minRaise) amount = ctx.minRaise;
      const raiseTotal = ctx.currentBet + amount;
      if (raiseTotal > maxTotal) {
        amount = ctx.stack;
        action = 'allin';
      } else if (raiseTotal < minTotal) {
        amount = minTotal - ctx.currentBet;
      }
    }

    // For call/fold/check: validate legality
    if (action === 'call' && ctx.toCall <= 0) action = 'check';
    if (action === 'fold' && ctx.toCall <= 0) action = 'check';

    return {
      patternName: pattern.name,
      action: action as PlaybookResult['action'],
      amount,
    };
  }

  return null;
}
