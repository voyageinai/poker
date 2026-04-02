/**
 * Discounted Counterfactual Regret Minimization (DCFR) solver for postflop poker.
 *
 * Solves heads-up postflop subgames in real-time using:
 * - DCFR with alpha=1.5, beta=0, gamma=2
 * - EHS (Expected Hand Strength) card abstraction
 * - Action abstraction: check/bet33/bet67/bet100/allin when uncalled;
 *   fold/call/raise2.5x/allin when facing a bet
 * - Single-street solving with equity-based terminal values at street transitions
 *
 * Uses the fast lookup-table evaluator from fast-eval.ts for hand evaluation.
 */

import { eval7, encodeCard } from '../fast-eval';

// ─── Types ──────────────────────────────────────────────────────────────────

export type Action =
  | 'check'
  | 'fold'
  | 'call'
  | 'bet_33'
  | 'bet_67'
  | 'bet_100'
  | 'bet_150'
  | 'raise_2_5x'
  | 'allin';

export interface GameNode {
  type: 'player' | 'terminal';
  /** Which player acts (0=IP, 1=OOP) */
  player: 0 | 1;
  /** Available actions at this node */
  actions: Action[];
  /** Children keyed by action */
  children: Map<Action, GameNode>;
  /** Current pot size (total chips in pot) */
  pot: number;
  /** Remaining stacks [player0, player1] */
  stacks: [number, number];
  /** Whether this terminal node is a showdown */
  isShowdown?: boolean;
  /** For terminal fold nodes: who folded (0 or 1) */
  foldedPlayer?: 0 | 1;
  /** Amount each player has contributed this street [p0, p1] */
  invested: [number, number];
}

export interface SolverResult {
  /** Strategy: action -> probability */
  strategy: Map<string, number>;
  /** Expected value for the acting player */
  ev: number;
  /** Number of iterations completed */
  iterations: number;
  /** Time taken in ms */
  timeMs: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** DCFR discount parameters */
const ALPHA = 1.5;
const BETA = 0.0;
const GAMMA = 2.0;

/** Number of abstraction buckets per street */
export const RIVER_BUCKETS = 200;
export const TURN_BUCKETS = 500;
export const FLOP_BUCKETS = 1000;

/** Max raise levels per street to keep tree manageable */
const MAX_RAISES_PER_STREET = 3;

/** All 52 card strings, pre-computed once */
const ALL_52_CARDS: string[] = [];
{
  const ranks = '23456789TJQKA';
  const suits = 'hdcs';
  for (const r of ranks) {
    for (const s of suits) {
      ALL_52_CARDS.push(`${r}${s}`);
    }
  }
}

// ─── Card Abstraction ───────────────────────────────────────────────────────

/**
 * Compute the abstraction bucket for a hand on a given board.
 * Uses EHS (Expected Hand Strength) bucketing.
 *
 * - River: deterministic rank-based (eval7)
 * - Turn/Flop: Monte Carlo equity vs random opponent
 */
export function computeBucket(
  holeCards: [string, string],
  board: string[],
  street: 'flop' | 'turn' | 'river',
): number {
  if (street === 'river') {
    // Deterministic: use eval7 rank directly
    const encoded = [...holeCards, ...board].map(c => encodeCard(c));
    const rank = eval7(encoded);
    // rank is 1..7462, map to 0..(RIVER_BUCKETS-1)
    return Math.min(Math.floor((rank / 7463) * RIVER_BUCKETS), RIVER_BUCKETS - 1);
  }

  // Turn/Flop: MC equity vs random opponent
  const iterations = 200;
  const numBuckets = street === 'turn' ? TURN_BUCKETS : FLOP_BUCKETS;
  return computeEquityBucket(holeCards, board, numBuckets, iterations);
}

/**
 * Compute equity bucket by evaluating hero's hand against random opponent hands.
 * Runs a fast Monte Carlo simulation inline.
 */
function computeEquityBucket(
  holeCards: [string, string],
  board: string[],
  numBuckets: number,
  iterations: number,
): number {
  const usedSet = new Set([...holeCards, ...board]);
  const remaining = ALL_52_CARDS.filter(c => !usedSet.has(c));

  const boardNeeded = 5 - board.length;
  let wins = 0;
  let ties = 0;

  const heroEncoded = holeCards.map(c => encodeCard(c));
  const boardEncoded = board.map(c => encodeCard(c));
  const remainingEncoded = remaining.map(c => encodeCard(c));
  const deckLen = remainingEncoded.length;

  for (let i = 0; i < iterations; i++) {
    // Partial Fisher-Yates shuffle
    const deck = new Int32Array(remainingEncoded);
    const need = boardNeeded + 2; // board completions + villain hand
    for (let j = 0; j < need && j < deckLen; j++) {
      const idx = j + Math.floor(Math.random() * (deckLen - j));
      const tmp = deck[j];
      deck[j] = deck[idx];
      deck[idx] = tmp;
    }

    // Build completed board
    const simBoard: number[] = [...boardEncoded];
    for (let j = 0; j < boardNeeded; j++) {
      simBoard.push(deck[j]);
    }

    const heroAll = [...heroEncoded, ...simBoard];
    const villAll = [deck[boardNeeded], deck[boardNeeded + 1], ...simBoard];

    const heroRank = eval7(heroAll);
    const villRank = eval7(villAll);

    if (heroRank > villRank) wins++;
    else if (heroRank === villRank) ties++;
  }

  const equity = (wins + ties * 0.5) / iterations;
  return Math.min(Math.floor(equity * numBuckets), numBuckets - 1);
}

// ─── Information Set Key ────────────────────────────────────────────────────

/**
 * Build a unique information set key from a bucket and action history.
 */
export function infoSetKey(bucket: number, history: string): string {
  return `${bucket}:${history}`;
}

/** Encode an action to a short code for history tracking. */
function actionCode(action: Action): string {
  switch (action) {
    case 'check':      return 'x';
    case 'fold':       return 'f';
    case 'call':       return 'c';
    case 'bet_33':     return 'b33';
    case 'bet_67':     return 'b67';
    case 'bet_100':    return 'b100';
    case 'bet_150':    return 'b150';
    case 'raise_2_5x': return 'r25';
    case 'allin':      return 'ai';
  }
}

/** Reverse mapping from code to Action. */
function codeToAction(code: string): Action | null {
  switch (code) {
    case 'x':    return 'check';
    case 'f':    return 'fold';
    case 'c':    return 'call';
    case 'b33':  return 'bet_33';
    case 'b67':  return 'bet_67';
    case 'b100': return 'bet_100';
    case 'b150': return 'bet_150';
    case 'r25':  return 'raise_2_5x';
    case 'ai':   return 'allin';
    default:     return null;
  }
}

// ─── Game Tree Construction ─────────────────────────────────────────────────

/**
 * Compute the chip amount a player puts in for a given action.
 */
function betAmount(
  action: Action,
  pot: number,
  toCall: number,
  stack: number,
): number {
  switch (action) {
    case 'check':
    case 'fold':
      return 0;
    case 'call':
      return Math.min(toCall, stack);
    case 'bet_33':
      return Math.min(Math.round(pot * 0.33), stack);
    case 'bet_67':
      return Math.min(Math.round(pot * 0.67), stack);
    case 'bet_100':
      return Math.min(pot, stack);
    case 'bet_150':
      return Math.min(Math.round(pot * 1.5), stack);
    case 'raise_2_5x': {
      const raiseTotal = Math.round(toCall * 2.5);
      return Math.min(raiseTotal, stack);
    }
    case 'allin':
      return stack;
  }
}

/** Is this action a bet/raise that increments the raise counter? */
function isBetOrRaise(action: Action): boolean {
  return action === 'bet_33' || action === 'bet_67' || action === 'bet_100'
    || action === 'bet_150' || action === 'raise_2_5x' || action === 'allin';
}

/**
 * Get available actions given the current game state.
 */
function getAvailableActions(
  pot: number,
  toCall: number,
  stack: number,
  raiseCount: number,
): Action[] {
  if (stack <= 0) return [];

  const canRaise = raiseCount < MAX_RAISES_PER_STREET;

  if (toCall === 0) {
    // No bet facing: check or open-bet
    const actions: Action[] = ['check'];
    if (canRaise) {
      const b33 = Math.round(pot * 0.33);
      const b67 = Math.round(pot * 0.67);
      const bPot = pot;
      if (b33 > 0 && b33 < stack) actions.push('bet_33');
      if (b67 > b33 && b67 < stack) actions.push('bet_67');
      if (bPot > b67 && bPot < stack) actions.push('bet_100');
    }
    if (stack > 0) actions.push('allin');
    return actions;
  }

  // Facing a bet
  const actions: Action[] = ['fold'];
  if (toCall >= stack) {
    // Can only call all-in
    actions.push('call');
    return actions;
  }
  actions.push('call');
  if (canRaise) {
    const raiseAmt = Math.round(toCall * 2.5);
    if (raiseAmt < stack) actions.push('raise_2_5x');
  }
  if (stack > toCall) actions.push('allin');
  return actions;
}

/**
 * Build the game tree for a single street of heads-up play.
 * OOP (player 1) acts first by default.
 */
export function buildGameTree(
  pot: number,
  stacks: [number, number],
  firstToAct: 0 | 1 = 1,
): GameNode {
  return buildNode(pot, stacks, firstToAct, [0, 0], 0, false, false);
}

function buildNode(
  pot: number,
  stacks: [number, number],
  player: 0 | 1,
  invested: [number, number],
  raiseCount: number,
  p0Acted: boolean,
  p1Acted: boolean,
): GameNode {
  const opp: 0 | 1 = player === 0 ? 1 : 0;
  const toCall = Math.max(0, invested[opp] - invested[player]);
  const actions = getAvailableActions(pot, toCall, stacks[player], raiseCount);

  if (actions.length === 0) {
    return terminalNode(player, pot, stacks, invested, true);
  }

  const node: GameNode = {
    type: 'player',
    player,
    actions,
    children: new Map(),
    pot,
    stacks: [stacks[0], stacks[1]],
    invested: [invested[0], invested[1]],
  };

  for (const action of actions) {
    const amt = betAmount(action, pot, toCall, stacks[player]);
    const newStacks: [number, number] = [stacks[0], stacks[1]];
    newStacks[player] -= amt;
    const newInv: [number, number] = [invested[0], invested[1]];
    newInv[player] += amt;
    const newPot = pot + amt;

    if (action === 'fold') {
      node.children.set(action, terminalNode(opp, newPot, newStacks, newInv, false, player));
      continue;
    }

    if (action === 'check') {
      const a0 = player === 0 ? true : p0Acted;
      const a1 = player === 1 ? true : p1Acted;
      if (a0 && a1) {
        // Both checked -> showdown
        node.children.set(action, terminalNode(opp, newPot, newStacks, newInv, true));
      } else {
        node.children.set(action, buildNode(newPot, newStacks, opp, newInv, raiseCount, a0, a1));
      }
      continue;
    }

    if (action === 'call') {
      // Call closes the action
      node.children.set(action, terminalNode(opp, newPot, newStacks, newInv, true));
      continue;
    }

    // Bet / raise / all-in
    const newRC = isBetOrRaise(action) ? raiseCount + 1 : raiseCount;
    node.children.set(action, buildNode(newPot, newStacks, opp, newInv, newRC, true, true));
  }

  return node;
}

function terminalNode(
  player: 0 | 1,
  pot: number,
  stacks: [number, number],
  invested: [number, number],
  isShowdown: boolean,
  foldedPlayer?: 0 | 1,
): GameNode {
  return {
    type: 'terminal',
    player,
    actions: [],
    children: new Map(),
    pot,
    stacks: [stacks[0], stacks[1]],
    invested: [invested[0], invested[1]],
    isShowdown,
    foldedPlayer,
  };
}

// ─── DCFR Solver ────────────────────────────────────────────────────────────

export class PostflopCFR {
  private regrets = new Map<string, Float64Array>();
  private strategySum = new Map<string, Float64Array>();
  private iteration = 0;
  private root: GameNode;
  private numBuckets: number;

  constructor(
    private board: string[],
    private pot: number,
    private stacks: [number, number],
    private street: 'flop' | 'turn' | 'river',
  ) {
    this.root = buildGameTree(pot, stacks);
    this.numBuckets = street === 'river'
      ? RIVER_BUCKETS
      : street === 'turn'
        ? TURN_BUCKETS
        : FLOP_BUCKETS;
  }

  // ── Regret / strategy table helpers ───────────────────────────────────────

  private getRegrets(key: string, n: number): Float64Array {
    let a = this.regrets.get(key);
    if (!a) { a = new Float64Array(n); this.regrets.set(key, a); }
    return a;
  }

  private getStratSum(key: string, n: number): Float64Array {
    let a = this.strategySum.get(key);
    if (!a) { a = new Float64Array(n); this.strategySum.set(key, a); }
    return a;
  }

  /** Regret-matching: convert cumulative regrets to a strategy. */
  private currentStrategy(key: string, n: number): Float64Array {
    const reg = this.getRegrets(key, n);
    const strat = new Float64Array(n);
    let posSum = 0;
    for (let i = 0; i < n; i++) if (reg[i] > 0) posSum += reg[i];
    if (posSum > 0) {
      for (let i = 0; i < n; i++) strat[i] = reg[i] > 0 ? reg[i] / posSum : 0;
    } else {
      const u = 1 / n;
      for (let i = 0; i < n; i++) strat[i] = u;
    }
    return strat;
  }

  // ── CFR traversal ─────────────────────────────────────────────────────────

  /**
   * Recursive DCFR traversal. Returns counterfactual value for `traverser`.
   */
  cfr(
    node: GameNode,
    reach: [number, number],
    traverser: 0 | 1,
    buckets: [number, number],
    history: string,
  ): number {
    if (node.type === 'terminal') {
      return this.terminalValue(node, traverser, buckets);
    }

    const p = node.player;
    const n = node.actions.length;
    if (n === 0) return this.terminalValue(node, traverser, buckets);

    const key = infoSetKey(buckets[p], history);
    const strat = this.currentStrategy(key, n);

    const av = new Float64Array(n);
    let nodeVal = 0;

    for (let i = 0; i < n; i++) {
      const a = node.actions[i];
      const child = node.children.get(a)!;
      const h = history.length > 0 ? `${history}:${actionCode(a)}` : actionCode(a);
      const nr: [number, number] = [reach[0], reach[1]];
      nr[p] *= strat[i];
      av[i] = this.cfr(child, nr, traverser, buckets, h);
      nodeVal += strat[i] * av[i];
    }

    if (p === traverser) {
      const reg = this.getRegrets(key, n);
      const oppReach = reach[1 - traverser];
      for (let i = 0; i < n; i++) {
        reg[i] += oppReach * (av[i] - nodeVal);
      }
      const ss = this.getStratSum(key, n);
      const myReach = reach[traverser];
      for (let i = 0; i < n; i++) {
        ss[i] += myReach * strat[i];
      }
    }

    return nodeVal;
  }

  /** Payoff at a terminal node for the traverser. */
  private terminalValue(
    node: GameNode,
    traverser: 0 | 1,
    buckets: [number, number],
  ): number {
    if (node.foldedPlayer !== undefined) {
      return node.foldedPlayer === traverser
        ? -node.invested[traverser]
        : node.invested[1 - traverser];
    }
    // Showdown: bucket comparison as strength proxy
    const hb = buckets[traverser];
    const vb = buckets[1 - traverser];
    if (hb > vb) return node.invested[1 - traverser];
    if (hb < vb) return -node.invested[traverser];
    return 0; // tie
  }

  // ── Discounting ───────────────────────────────────────────────────────────

  private discount(): void {
    const t = this.iteration;
    if (t <= 0) return;

    const tA = Math.pow(t, ALPHA);
    const posD = tA / (tA + 1);
    const tB = Math.pow(t, BETA);
    const negD = tB / (tB + 1);
    const tG = Math.pow(t, GAMMA);
    const stratD = tG / (tG + 1);

    for (const reg of this.regrets.values()) {
      for (let i = 0; i < reg.length; i++) {
        reg[i] *= reg[i] > 0 ? posD : negD;
      }
    }
    for (const ss of this.strategySum.values()) {
      for (let i = 0; i < ss.length; i++) {
        ss[i] *= stratD;
      }
    }
  }

  // ── Solve loop ────────────────────────────────────────────────────────────

  /**
   * Run DCFR iterations, sampling random bucket pairs, until timeout.
   */
  solve(timeoutMs: number): void {
    const deadline = Date.now() + timeoutMs;
    const nb = this.numBuckets;
    while (Date.now() < deadline) {
      const b0 = Math.floor(Math.random() * nb);
      const b1 = Math.floor(Math.random() * nb);
      const bk: [number, number] = [b0, b1];
      this.cfr(this.root, [1, 1], 0, bk, '');
      this.cfr(this.root, [1, 1], 1, bk, '');
      this.iteration++;
      this.discount();
    }
  }

  /**
   * Like solve() but biases 50% of iterations to use `heroBucket` for player 0.
   * This ensures the hero's specific bucket is well-represented in the output.
   */
  solveBiased(heroBucket: number, timeoutMs: number): void {
    const deadline = Date.now() + timeoutMs;
    const nb = this.numBuckets;
    while (Date.now() < deadline) {
      const b0 = Math.random() < 0.5
        ? heroBucket
        : Math.floor(Math.random() * nb);
      const b1 = Math.floor(Math.random() * nb);
      const bk: [number, number] = [b0, b1];
      this.cfr(this.root, [1, 1], 0, bk, '');
      this.cfr(this.root, [1, 1], 1, bk, '');
      this.iteration++;
      this.discount();
    }
  }

  // ── Strategy extraction ───────────────────────────────────────────────────

  /**
   * Get the averaged strategy for an info set.
   * Returns action-name -> probability. Empty map if the info set wasn't visited.
   */
  getStrategy(key: string): Map<string, number> {
    const ss = this.strategySum.get(key);
    if (!ss) return new Map();

    let total = 0;
    for (let i = 0; i < ss.length; i++) total += ss[i];
    if (total <= 0) return new Map();

    // Recover which actions correspond to which indices by walking the tree
    const colonIdx = key.indexOf(':');
    const history = colonIdx >= 0 ? key.slice(colonIdx + 1) : '';
    const node = this.findNode(history);
    if (!node) return new Map();

    const result = new Map<string, number>();
    for (let i = 0; i < node.actions.length && i < ss.length; i++) {
      result.set(node.actions[i], ss[i] / total);
    }
    return result;
  }

  /** Walk the tree by replaying an action-code history string. */
  private findNode(history: string): GameNode | null {
    if (!history) return this.root;
    let cur = this.root;
    for (const code of history.split(':')) {
      const a = codeToAction(code);
      if (!a) return null;
      const child = cur.children.get(a);
      if (!child) return null;
      cur = child;
    }
    return cur;
  }

  getIterations(): number { return this.iteration; }
  getRoot(): GameNode { return this.root; }
  getNumBuckets(): number { return this.numBuckets; }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Solve the current postflop situation using DCFR.
 *
 * Hero is always player 0 (IP). OOP (player 1) acts first postflop.
 * The solver builds a full single-street game tree and runs DCFR iterations
 * with biased bucket sampling centred on the hero's actual hand strength.
 *
 * @param holeCards  - Hero's hole cards
 * @param board      - Community cards (3-5)
 * @param pot        - Current pot size
 * @param stacks     - [heroStack, villainStack] remaining
 * @param toCall     - Amount to call (0 if no bet facing) -- currently unused
 *                     (the tree is built from pot/stacks; toCall is implicit)
 * @param street     - Current street
 * @param timeoutMs  - Max solving time (default 3000ms)
 */
export function solvePostflop(
  holeCards: [string, string],
  board: string[],
  pot: number,
  stacks: [number, number],
  _toCall: number,
  street: 'flop' | 'turn' | 'river',
  timeoutMs: number = 3000,
): SolverResult {
  const start = Date.now();

  const heroBucket = computeBucket(holeCards, board, street);
  const solver = new PostflopCFR(board, pot, stacks, street);

  // Biased solve: 50% of iterations pin player 0's bucket to heroBucket
  solver.solveBiased(heroBucket, timeoutMs);

  const history = ''; // root = first decision point
  const key = infoSetKey(heroBucket, history);
  let strategy = solver.getStrategy(key);

  // Fallback: nearest sampled bucket
  if (strategy.size === 0) {
    strategy = findNearestStrategy(solver, heroBucket, history, street);
  }

  // Ultimate fallback: uniform
  if (strategy.size === 0) {
    const root = solver.getRoot();
    strategy = new Map<string, number>();
    const u = 1 / root.actions.length;
    for (const a of root.actions) strategy.set(a, u);
  }

  return {
    strategy,
    ev: 0,
    iterations: solver.getIterations(),
    timeMs: Date.now() - start,
  };
}

/**
 * Search outward from targetBucket for the nearest bucket that was sampled.
 */
function findNearestStrategy(
  solver: PostflopCFR,
  targetBucket: number,
  history: string,
  _street: 'flop' | 'turn' | 'river',
): Map<string, number> {
  const max = solver.getNumBuckets();
  for (let d = 1; d < max; d++) {
    for (const off of [d, -d]) {
      const b = targetBucket + off;
      if (b < 0 || b >= max) continue;
      const s = solver.getStrategy(infoSetKey(b, history));
      if (s.size > 0) return s;
    }
  }
  return new Map();
}
