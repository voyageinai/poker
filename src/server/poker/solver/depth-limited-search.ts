/**
 * Depth-limited search with multiple continuation strategies.
 *
 * Pluribus innovation: instead of assuming all players follow one strategy
 * beyond the search depth, consider 4 different continuation strategies:
 *   1. Blueprint (default play)
 *   2. Fold-biased (folds 25% more often)
 *   3. Call-biased (calls 25% more often)
 *   4. Raise-biased (raises 25% more often)
 *
 * At each decision point within the search tree, run CFR iterations among
 * these continuation profiles to find a locally improved strategy.
 *
 * The search is bounded by:
 *   - Depth: 1-2 betting rounds ahead
 *   - Time: configurable timeout (default 200ms for real-time play)
 *   - Iterations: runs as many CFR iterations as fit within the timeout
 *
 * Leaf node evaluation:
 *   1. If blueprint has a value for this info set -> use it
 *   2. Else -> use Monte Carlo equity as a fallback
 */

import type {
  ActionProbabilities,
  BlueprintStrategy,
  AbstractAction,
} from './blueprint';
import {
  ABSTRACT_ACTIONS,
  buildInfoSetKey,
  abstractToActualAmount,
} from './blueprint';
import { getHandBucket } from './card-abstraction';
import { postflopStrengthMC } from '../strategy/equity';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SearchResult {
  strategy: ActionProbabilities;
  ev: number;
  iterations: number;
  depth: number;
  timeMs: number;
}

interface SearchNode {
  /** Available actions at this node */
  actions: AbstractAction[];
  /** Cumulative regret for each action */
  regretSum: number[];
  /** Cumulative strategy for each action */
  strategySum: number[];
}

interface GameState {
  pot: number;
  stack: number;
  toCall: number;
  street: 'flop' | 'turn' | 'river';
  board: string[];
  actionHistory: AbstractAction[];
  depth: number;
}

// ─── Continuation strategy profiles ────────────────────────────────────────

/**
 * Four continuation strategies modeled after Pluribus.
 * Each biases the blueprint strategy in a different direction.
 */
interface ContinuationProfile {
  name: string;
  foldBias: number;   // additive shift to fold probability
  callBias: number;   // additive shift to call probability
  raiseBias: number;  // additive shift to raise probability
}

const CONTINUATION_PROFILES: ContinuationProfile[] = [
  { name: 'blueprint', foldBias: 0,     callBias: 0,     raiseBias: 0 },
  { name: 'fold-biased', foldBias: 0.25, callBias: -0.10, raiseBias: -0.15 },
  { name: 'call-biased', foldBias: -0.10, callBias: 0.25, raiseBias: -0.15 },
  { name: 'raise-biased', foldBias: -0.15, callBias: -0.10, raiseBias: 0.25 },
];

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 200;
const MAX_SEARCH_DEPTH = 2;
const MIN_ITERATIONS = 10;

// ─── Helper functions ──────────────────────────────────────────────────────

/**
 * Get legal abstract actions for a game state.
 */
function getLegalActions(state: GameState): AbstractAction[] {
  const actions: AbstractAction[] = [];

  if (state.toCall > 0) {
    actions.push('fold');
    actions.push('call');
  } else {
    actions.push('check');
  }

  // Raise/bet options (only if player has chips beyond toCall)
  if (state.stack > state.toCall) {
    // Include bet sizes that are feasible given stack
    const effectivePot = Math.max(state.pot, 1);
    const remainingAfterCall = state.stack - state.toCall;

    if (remainingAfterCall >= effectivePot * 0.20) actions.push('bet_33');
    if (remainingAfterCall >= effectivePot * 0.50) actions.push('bet_67');
    if (remainingAfterCall >= effectivePot * 0.80) actions.push('bet_100');
    if (remainingAfterCall >= effectivePot * 1.20) actions.push('bet_150');

    actions.push('allin');
  }

  return actions;
}

/**
 * Apply a continuation profile bias to a base strategy.
 * Redistributes probability mass according to the bias, then normalizes.
 */
function applyContinuationBias(
  base: ActionProbabilities,
  profile: ContinuationProfile,
): ActionProbabilities {
  const result: ActionProbabilities = {};

  // Classify each action
  for (const [action, prob] of Object.entries(base)) {
    let adjusted = prob;

    if (action === 'fold') {
      adjusted += profile.foldBias;
    } else if (action === 'call' || action === 'check') {
      adjusted += profile.callBias;
    } else {
      // All bet/raise actions share the raise bias
      adjusted += profile.raiseBias;
    }

    result[action] = Math.max(0, adjusted);
  }

  // Normalize
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const action of Object.keys(result)) {
      result[action] /= total;
    }
  } else {
    // Degenerate: uniform over available actions
    const actions = Object.keys(result);
    for (const action of actions) {
      result[action] = 1 / actions.length;
    }
  }

  return result;
}

/**
 * Compute the current regret-matched strategy from cumulative regrets.
 */
function regretMatchingStrategy(node: SearchNode): number[] {
  const n = node.actions.length;
  const strategy = new Array(n);
  let positiveSum = 0;

  for (let i = 0; i < n; i++) {
    strategy[i] = Math.max(0, node.regretSum[i]);
    positiveSum += strategy[i];
  }

  if (positiveSum > 0) {
    for (let i = 0; i < n; i++) {
      strategy[i] /= positiveSum;
    }
  } else {
    // Uniform strategy when all regrets are non-positive
    for (let i = 0; i < n; i++) {
      strategy[i] = 1 / n;
    }
  }

  return strategy;
}

/**
 * Convert a SearchNode's average strategy to ActionProbabilities.
 */
function getAverageStrategy(node: SearchNode): ActionProbabilities {
  const result: ActionProbabilities = {};
  let total = 0;

  for (let i = 0; i < node.actions.length; i++) {
    total += node.strategySum[i];
  }

  if (total > 0) {
    for (let i = 0; i < node.actions.length; i++) {
      result[node.actions[i]] = node.strategySum[i] / total;
    }
  } else {
    // Uniform
    for (let i = 0; i < node.actions.length; i++) {
      result[node.actions[i]] = 1 / node.actions.length;
    }
  }

  return result;
}

/**
 * Evaluate a leaf node: use blueprint value if available, else Monte Carlo equity.
 */
function evaluateLeaf(
  holeCards: [string, string],
  state: GameState,
  bpStrategy: BlueprintStrategy,
): number {
  // Try blueprint value first
  if (bpStrategy.isLoaded()) {
    const bucket = getHandBucket(holeCards, state.board, state.street);
    const key = buildInfoSetKey(state.street, bucket, state.actionHistory);
    const bpValue = bpStrategy.getValue(key);
    if (bpValue !== null) return bpValue;
  }

  // Fallback: Monte Carlo equity * pot
  const equity = postflopStrengthMC(holeCards, state.board, 1);
  return equity * state.pot - (1 - equity) * state.toCall;
}

/**
 * Get the blueprint or default strategy for opponent's continuation at leaf nodes.
 */
function getLeafStrategy(
  holeCards: [string, string],
  state: GameState,
  bpStrategy: BlueprintStrategy,
  profile: ContinuationProfile,
): ActionProbabilities {
  const actions = getLegalActions(state);

  // Try blueprint first
  if (bpStrategy.isLoaded()) {
    const bucket = getHandBucket(holeCards, state.board, state.street);
    const key = buildInfoSetKey(state.street, bucket, state.actionHistory);
    const bpStrat = bpStrategy.getStrategy(key);
    if (bpStrat) {
      return applyContinuationBias(bpStrat, profile);
    }
  }

  // Default heuristic strategy: check/call with some betting
  const base: ActionProbabilities = {};
  for (const action of actions) {
    switch (action) {
      case 'check': base[action] = 0.50; break;
      case 'call':  base[action] = 0.40; break;
      case 'fold':  base[action] = 0.30; break;
      case 'bet_33': base[action] = 0.15; break;
      case 'bet_67': base[action] = 0.10; break;
      case 'bet_100': base[action] = 0.05; break;
      case 'bet_150': base[action] = 0.02; break;
      case 'allin': base[action] = 0.01; break;
    }
  }

  // Normalize and apply continuation bias
  const total = Object.values(base).reduce((s, v) => s + v, 0);
  for (const key of Object.keys(base)) {
    base[key] /= total;
  }

  return applyContinuationBias(base, profile);
}

/**
 * Advance the game state after an action is taken.
 */
function advanceState(state: GameState, action: AbstractAction): GameState {
  const newHistory = [...state.actionHistory, action];
  const pot = state.pot;
  const minRaise = Math.max(Math.round(pot * 0.33), 1);

  const betAmount = abstractToActualAmount(action, pot, state.stack, minRaise, state.toCall);

  switch (action) {
    case 'fold':
      return { ...state, actionHistory: newHistory, depth: state.depth + 1 };
    case 'check':
      return {
        ...state,
        actionHistory: newHistory,
        toCall: 0,
        depth: state.depth + 1,
      };
    case 'call':
      return {
        ...state,
        pot: pot + Math.min(state.toCall, state.stack),
        stack: state.stack - Math.min(state.toCall, state.stack),
        toCall: 0,
        actionHistory: newHistory,
        depth: state.depth + 1,
      };
    case 'allin':
      return {
        ...state,
        pot: pot + state.stack,
        toCall: 0,
        stack: 0,
        actionHistory: newHistory,
        depth: state.depth + 1,
      };
    default: {
      // Bet/raise actions
      const raiseTotal = betAmount + state.toCall;
      const chipsPut = Math.min(raiseTotal, state.stack);
      return {
        ...state,
        pot: pot + chipsPut,
        stack: state.stack - chipsPut,
        toCall: chipsPut - state.toCall, // opponent now faces this bet
        actionHistory: newHistory,
        depth: state.depth + 1,
      };
    }
  }
}

// ─── Core CFR search ───────────────────────────────────────────────────────

/**
 * One iteration of CFR within the search tree.
 *
 * @param holeCards  - Hero's hole cards
 * @param state      - Current game state
 * @param nodes      - Map of info-set keys to search nodes
 * @param bpStrategy - Blueprint for leaf evaluation
 * @param profileIdx - Which continuation profile to use for opponent at leaves
 * @returns Expected value for the hero at this node
 */
function cfrIteration(
  holeCards: [string, string],
  state: GameState,
  nodes: Map<string, SearchNode>,
  bpStrategy: BlueprintStrategy,
  profileIdx: number,
): number {
  // Terminal: fold
  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  if (lastAction === 'fold') {
    // Hero wins the pot (opponent folded)
    return state.pot;
  }

  // Terminal: depth limit reached
  if (state.depth >= MAX_SEARCH_DEPTH) {
    return evaluateLeaf(holeCards, state, bpStrategy);
  }

  // Terminal: all-in (no more decisions)
  if (state.stack <= 0) {
    return evaluateLeaf(holeCards, state, bpStrategy);
  }

  const actions = getLegalActions(state);
  if (actions.length === 0) {
    return evaluateLeaf(holeCards, state, bpStrategy);
  }

  // Get or create node
  const bucket = getHandBucket(holeCards, state.board, state.street);
  const key = buildInfoSetKey(state.street, bucket, state.actionHistory);

  let node = nodes.get(key);
  if (!node) {
    node = {
      actions,
      regretSum: new Array(actions.length).fill(0),
      strategySum: new Array(actions.length).fill(0),
    };
    nodes.set(key, node);
  }

  // Compute current strategy from regret matching
  const strategy = regretMatchingStrategy(node);

  // Compute counterfactual values for each action
  const actionValues = new Array(actions.length);
  let nodeValue = 0;

  for (let i = 0; i < actions.length; i++) {
    const nextState = advanceState(state, actions[i]);

    if (actions[i] === 'fold') {
      // Folding loses everything we've put in
      actionValues[i] = 0;
    } else if (nextState.depth >= MAX_SEARCH_DEPTH || nextState.stack <= 0) {
      // Leaf evaluation
      actionValues[i] = evaluateLeaf(holeCards, nextState, bpStrategy);
    } else {
      // Opponent response at leaf: weighted average over continuation profiles
      const profile = CONTINUATION_PROFILES[profileIdx];
      const oppStrategy = getLeafStrategy(holeCards, nextState, bpStrategy, profile);

      // Average EV across opponent's actions weighted by their strategy
      let oppEV = 0;
      const oppActions = getLegalActions(nextState);
      for (const oppAction of oppActions) {
        const oppProb = oppStrategy[oppAction] ?? 0;
        if (oppProb <= 0) continue;

        const afterOppState = advanceState(nextState, oppAction);

        if (oppAction === 'fold') {
          // Opponent folds: we win the pot
          oppEV += oppProb * afterOppState.pot;
        } else {
          oppEV += oppProb * evaluateLeaf(holeCards, afterOppState, bpStrategy);
        }
      }

      actionValues[i] = oppEV;
    }

    nodeValue += strategy[i] * actionValues[i];
  }

  // Update regrets and strategy sums
  for (let i = 0; i < actions.length; i++) {
    node.regretSum[i] += actionValues[i] - nodeValue;
    node.strategySum[i] += strategy[i];
  }

  return nodeValue;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Perform depth-limited search to improve on the blueprint strategy.
 *
 * Runs CFR iterations within a time budget, considering multiple continuation
 * strategies at leaf nodes (Pluribus-style).
 *
 * @param holeCards  - Hero's two hole cards
 * @param board      - Community cards (3-5)
 * @param pot        - Current pot size
 * @param stack      - Hero's remaining stack
 * @param toCall     - Amount to call (0 if not facing a bet)
 * @param street     - Current street
 * @param bpStrategy - Blueprint strategy for leaf evaluation
 * @param timeoutMs  - Time budget in milliseconds (default 200ms)
 * @returns Improved strategy and metadata
 */
export function depthLimitedSearch(
  holeCards: [string, string],
  board: string[],
  pot: number,
  stack: number,
  toCall: number,
  street: 'flop' | 'turn' | 'river',
  bpStrategy: BlueprintStrategy,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): SearchResult {
  const startTime = performance.now();
  const deadline = startTime + timeoutMs;

  const initialState: GameState = {
    pot,
    stack,
    toCall,
    street,
    board,
    actionHistory: [],
    depth: 0,
  };

  const nodes = new Map<string, SearchNode>();
  let iterations = 0;

  // Run CFR iterations, cycling through continuation profiles
  while (performance.now() < deadline || iterations < MIN_ITERATIONS) {
    const profileIdx = iterations % CONTINUATION_PROFILES.length;

    cfrIteration(
      holeCards,
      initialState,
      nodes,
      bpStrategy,
      profileIdx,
    );

    iterations++;

    // Hard stop after min iterations if over time
    if (iterations >= MIN_ITERATIONS && performance.now() >= deadline) break;
  }

  // Extract the root node's average strategy
  const bucket = getHandBucket(holeCards, board, street);
  const rootKey = buildInfoSetKey(street, bucket, []);
  const rootNode = nodes.get(rootKey);

  let strategy: ActionProbabilities;
  let ev = 0;

  if (rootNode) {
    strategy = getAverageStrategy(rootNode);

    // Compute EV from the last iteration's values
    const lastStrategy = regretMatchingStrategy(rootNode);
    for (let i = 0; i < rootNode.actions.length; i++) {
      // Approximate EV from the cumulative strategy
      ev += lastStrategy[i] * (rootNode.regretSum[i] / Math.max(1, iterations));
    }
  } else {
    // Fallback: no root node (shouldn't happen but be safe)
    const equity = postflopStrengthMC(holeCards, board, 1);
    strategy = toCall > 0
      ? { fold: 1 - equity, call: equity * 0.7, raise: equity * 0.3 }
      : { check: 1 - equity * 0.5, bet_67: equity * 0.5 };
    ev = equity * pot;
  }

  const elapsedMs = performance.now() - startTime;

  return {
    strategy,
    ev,
    iterations,
    depth: MAX_SEARCH_DEPTH,
    timeMs: Math.round(elapsedMs * 100) / 100,
  };
}
