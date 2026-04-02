/**
 * Integration layer bridging the solver system with the existing bot architecture.
 *
 * Decision flow:
 *   1. If blueprint is loaded -> use depth-limited search for improved strategy
 *   2. Else if 2-player pot -> use real-time DCFR solver (postflop-solver.ts)
 *   3. Else -> return null (caller falls back to heuristic chooseBuiltinAction)
 *
 * Style deviations are applied AFTER solver output, similar to the preflop
 * CFR system. This preserves the theoretical soundness of the solver output
 * while giving each bot its characteristic personality.
 *
 * Safe exploitation is applied when an opponent model is provided,
 * bounded by the bot style's exploitation weight.
 */

import type { SystemBotStyle } from '../strategy/preflop-ranges';
import type { ActionProbabilities } from './blueprint';
import type { OpponentModel } from './safe-exploit';

import { blueprint, abstractToActualAmount } from './blueprint';
import type { AbstractAction } from './blueprint';
import { depthLimitedSearch } from './depth-limited-search';
import { safeExploit } from './safe-exploit';
import { applyPostflopStyleDeviation, applyStyleSizing, sampleAction } from './style-deviations';
import { postflopStrengthMC } from '../strategy/equity';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SolverDecisionResult {
  action: string;
  amount: number;
  debug?: {
    source: 'blueprint-search' | 'dcfr-solver' | 'equity-fallback';
    strategy: ActionProbabilities;
    ev: number;
    iterations?: number;
    timeMs?: number;
    strength?: number;
  };
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Maximum time budget for depth-limited search (ms) */
const SEARCH_TIMEOUT_MS = 150;

/** Maximum time budget for DCFR solving (ms) */
const DCFR_TIMEOUT_MS = 200;

/**
 * Maximum exploitation deviation per style.
 * Higher values = more exploitative, lower = closer to GTO.
 * GTO/adaptive get 0 deviation (pure GTO or opponent-model-driven).
 */
const STYLE_EXPLOIT_WEIGHT: Record<SystemBotStyle, number> = {
  gto:        0.0,    // Pure GTO, never deviates
  nit:        0.10,   // Conservative, small exploits only
  tag:        0.15,   // Moderate exploitation
  lag:        0.20,   // Willing to exploit more
  station:    0.05,   // Mostly passive, doesn't exploit much
  maniac:     0.25,   // Aggressive exploitation
  trapper:    0.15,   // Moderate, trap-oriented
  bully:      0.25,   // Exploits weakness aggressively
  tilter:     0.10,   // Inconsistent exploitation
  shortstack: 0.10,   // Conservative due to short stack risk
  adaptive:   0.30,   // Most exploitation-oriented (adapts to opponent)
};

// ─── DCFR solver interface ─────────────────────────────────────────────────

/**
 * Interface for the DCFR postflop solver (postflop-solver.ts).
 * The solver returns Map<string, number> for strategy; we convert to ActionProbabilities.
 */
interface DCFRRawResult {
  strategy: Map<string, number>;
  ev: number;
  iterations: number;
  timeMs: number;
}

type SolvePostflopFn = (
  holeCards: [string, string],
  board: string[],
  pot: number,
  stacks: [number, number],
  toCall: number,
  street: 'flop' | 'turn' | 'river',
  timeoutMs: number,
) => DCFRRawResult;

let dcfrSolve: SolvePostflopFn | null = null;

// Try to load the DCFR solver module (may not exist yet)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./postflop-solver');
  if (typeof mod.solvePostflop === 'function') {
    dcfrSolve = mod.solvePostflop as SolvePostflopFn;
  }
} catch {
  // DCFR solver not available yet — skip this decision path
}

/** Convert a Map<string, number> strategy to ActionProbabilities */
function mapToActionProbs(stratMap: Map<string, number>): ActionProbabilities {
  const result: ActionProbabilities = {};
  for (const [action, prob] of stratMap) {
    result[action] = prob;
  }
  return result;
}

// ─── Action mapping ────────────────────────────────────────────────────────

/**
 * Map an abstract action from the solver to a concrete game action
 * with the appropriate amount.
 */
function mapToConcreteAction(
  abstractAction: string,
  pot: number,
  stack: number,
  minRaise: number,
  toCall: number,
): { action: string; amount: number } {
  // Handle standard actions
  switch (abstractAction) {
    case 'fold':
      return { action: 'fold', amount: 0 };
    case 'check':
      return { action: toCall > 0 ? 'call' : 'check', amount: 0 };
    case 'call':
      return { action: 'call', amount: Math.min(toCall, stack) };
    case 'allin':
      return { action: 'allin', amount: stack };
  }

  // Bet/raise actions: compute actual amount
  if (abstractAction.startsWith('bet_') || abstractAction === 'raise') {
    const amount = abstractToActualAmount(
      abstractAction as AbstractAction,
      pot,
      stack,
      minRaise,
      toCall,
    );

    // Check if this amounts to an all-in
    if (amount >= stack * 0.9) {
      return { action: 'allin', amount: stack };
    }

    return {
      action: 'raise',
      amount: Math.max(minRaise, amount) + (toCall > 0 ? toCall : 0),
    };
  }

  // Unknown action: default to check/fold
  return { action: toCall > 0 ? 'fold' : 'check', amount: 0 };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Main entry point for solver-based postflop decisions.
 *
 * Returns null when no solver path is available, signaling the caller
 * to use the heuristic engine (chooseBuiltinAction in agents.ts).
 *
 * @param holeCards     - Hero's two hole cards
 * @param board         - Community cards (3-5)
 * @param pot           - Current pot size
 * @param stack         - Hero's remaining stack
 * @param toCall        - Amount to call (0 if checking)
 * @param minRaise      - Minimum legal raise
 * @param currentBet    - Current bet to match
 * @param street        - Current street (flop/turn/river)
 * @param style         - Bot personality style
 * @param opponents     - Number of active opponents
 * @param opponentModel - Optional observed opponent tendencies
 * @returns Decision with action/amount, or null if no solver available
 */
export function solverDecision(
  holeCards: [string, string],
  board: string[],
  pot: number,
  stack: number,
  toCall: number,
  minRaise: number,
  currentBet: number,
  street: 'flop' | 'turn' | 'river',
  style: SystemBotStyle,
  opponents: number,
  opponentModel?: OpponentModel,
): SolverDecisionResult | null {
  // ── Path 1: Blueprint + depth-limited search ─────────────────────────
  if (blueprint.isLoaded()) {
    const searchResult = depthLimitedSearch(
      holeCards,
      board,
      pot,
      stack,
      toCall,
      street,
      blueprint,
      SEARCH_TIMEOUT_MS,
    );

    let strategy = searchResult.strategy;

    // Apply safe exploitation if opponent model available
    if (opponentModel) {
      const maxDev = STYLE_EXPLOIT_WEIGHT[style];
      if (maxDev > 0) {
        strategy = safeExploit(strategy, opponentModel, maxDev);
      }
    }

    // Apply style deviations
    const strength = postflopStrengthMC(holeCards, board, opponents);
    strategy = applyPostflopStyleDeviation(strategy, style, strength);
    strategy = applyStyleSizing(strategy, style);

    // Sample action from strategy
    const selectedAction = sampleAction(strategy);
    const concrete = mapToConcreteAction(selectedAction, pot, stack, minRaise, toCall);

    return {
      ...concrete,
      debug: {
        source: 'blueprint-search',
        strategy,
        ev: searchResult.ev,
        iterations: searchResult.iterations,
        timeMs: searchResult.timeMs,
        strength,
      },
    };
  }

  // ── Path 2: DCFR solver (heads-up only) ──────────────────────────────
  if (dcfrSolve && opponents <= 1) {
    try {
      const rawResult = dcfrSolve(
        holeCards,
        board,
        pot,
        [stack, stack],  // approximate opponent stack as equal
        toCall,
        street,
        DCFR_TIMEOUT_MS,
      );

      let strategy = mapToActionProbs(rawResult.strategy);

      // Apply safe exploitation
      if (opponentModel) {
        const maxDev = STYLE_EXPLOIT_WEIGHT[style];
        if (maxDev > 0) {
          strategy = safeExploit(strategy, opponentModel, maxDev);
        }
      }

      // Apply style deviations
      const strength = postflopStrengthMC(holeCards, board, opponents);
      strategy = applyPostflopStyleDeviation(strategy, style, strength);
      strategy = applyStyleSizing(strategy, style);

      const selectedAction = sampleAction(strategy);
      const concrete = mapToConcreteAction(selectedAction, pot, stack, minRaise, toCall);

      return {
        ...concrete,
        debug: {
          source: 'dcfr-solver',
          strategy,
          ev: rawResult.ev,
          iterations: rawResult.iterations,
          timeMs: rawResult.timeMs,
          strength,
        },
      };
    } catch {
      // DCFR solver failed — fall through to null
    }
  }

  // ── Path 3: Multi-way pots or no solver available ────────────────────
  // Return null to signal the caller to use heuristic fallback.
  // Multi-way pots are too complex for real-time solving.
  return null;
}

/**
 * Check if the solver system has any solving capability available.
 * Useful for the UI to indicate solver status.
 */
export function isSolverAvailable(): boolean {
  return blueprint.isLoaded() || dcfrSolve !== null;
}

/**
 * Get the solver source that would be used for a given scenario.
 */
export function getSolverSource(
  opponents: number,
): 'blueprint-search' | 'dcfr-solver' | 'heuristic' {
  if (blueprint.isLoaded()) return 'blueprint-search';
  if (dcfrSolve && opponents <= 1) return 'dcfr-solver';
  return 'heuristic';
}
