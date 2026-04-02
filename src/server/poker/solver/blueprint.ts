/**
 * Blueprint strategy: pre-computed full-game strategy storage and lookup.
 *
 * In the Pluribus architecture:
 * 1. Blueprint is computed offline via MCCFR on the full abstracted game tree
 * 2. At runtime, depth-limited search improves on the blueprint locally
 * 3. Leaf nodes of the search use blueprint values as terminal evaluations
 *
 * The blueprint maps information set keys to action probability distributions
 * and expected values. Information sets encode the player's private information
 * (hole card bucket) plus the public game state (board, street, action history).
 *
 * Key format: "{street}:{bucket}:{actionHistory}"
 *   - street: f/t/r (flop/turn/river)
 *   - bucket: hand cluster index from card-abstraction.ts
 *   - actionHistory: sequence of abstract actions, e.g. "xbc" (check, bet, call)
 *
 * Storage: binary format for efficiency. Each entry stores a strategy vector
 * (action probabilities) and an expected value (float).
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ActionProbabilities {
  [action: string]: number;  // action -> probability (0..1), sums to ~1.0
}

export interface BlueprintEntry {
  strategy: ActionProbabilities;
  value: number;             // expected value in chips (from this information set)
}

export interface BlueprintStrategy {
  /** Look up the mixed strategy for an information set */
  getStrategy(infoSet: string): ActionProbabilities | null;

  /** Look up the expected value at an information set */
  getValue(infoSet: string): number | null;

  /** Check if a blueprint has been computed and loaded */
  isLoaded(): boolean;

  /** Number of information sets stored */
  size(): number;
}

// ─── Abstract actions ──────────────────────────────────────────────────────

/**
 * Abstract action labels used in the blueprint game tree.
 * Maps continuous bet sizes to discrete categories for tractable game trees.
 */
export const ABSTRACT_ACTIONS = [
  'fold',     // f
  'check',    // x
  'call',     // c
  'bet_33',   // b3 — 33% pot bet
  'bet_67',   // b6 — 67% pot bet
  'bet_100',  // b1 — pot-sized bet
  'bet_150',  // bp — 1.5x pot overbet
  'allin',    // a  — all-in
] as const;

export type AbstractAction = typeof ABSTRACT_ACTIONS[number];

/** Short codes for compact info-set key encoding */
const ACTION_SHORT_CODES: Record<AbstractAction, string> = {
  fold:    'f',
  check:   'x',
  call:    'c',
  bet_33:  'b3',
  bet_67:  'b6',
  bet_100: 'b1',
  bet_150: 'bp',
  allin:   'a',
};

/** Reverse mapping: short code -> abstract action */
const SHORT_CODE_TO_ACTION: Record<string, AbstractAction> = {};
for (const [action, code] of Object.entries(ACTION_SHORT_CODES)) {
  SHORT_CODE_TO_ACTION[code] = action as AbstractAction;
}

export { ACTION_SHORT_CODES, SHORT_CODE_TO_ACTION };

// ─── Info-set key construction ─────────────────────────────────────────────

const STREET_CODES: Record<string, string> = {
  flop: 'f',
  turn: 't',
  river: 'r',
};

/**
 * Build an information set key from game state components.
 *
 * @param street  - Current street (flop/turn/river)
 * @param bucket  - Hand cluster bucket from card abstraction
 * @param history - Sequence of abstract actions taken so far on this street
 * @returns Compact string key for blueprint lookup
 */
export function buildInfoSetKey(
  street: 'flop' | 'turn' | 'river',
  bucket: number,
  history: AbstractAction[],
): string {
  const streetCode = STREET_CODES[street];
  const histCodes = history.map(a => ACTION_SHORT_CODES[a]).join('');
  return `${streetCode}:${bucket}:${histCodes}`;
}

// ─── FileBlueprint implementation ──────────────────────────────────────────

/**
 * Binary file format for blueprint storage.
 *
 * Header:
 *   4 bytes: magic number (0x42505354 = "BPST")
 *   4 bytes: version (uint32)
 *   4 bytes: number of entries (uint32)
 *   4 bytes: number of abstract actions (uint32)
 *
 * Per entry:
 *   2 bytes: key length (uint16)
 *   N bytes: key (UTF-8)
 *   K floats: strategy vector (float32 x numActions)
 *   1 float:  expected value (float32)
 */
const BLUEPRINT_MAGIC = 0x42505354;
const BLUEPRINT_VERSION = 1;

export class FileBlueprint implements BlueprintStrategy {
  private data: Map<string, BlueprintEntry> | null = null;

  /** Load blueprint from a binary file. Called once at startup. */
  async load(path: string): Promise<void> {
    if (!existsSync(path)) {
      throw new Error(`Blueprint file not found: ${path}`);
    }

    const buffer = await readFile(path);
    this.data = deserializeBlueprint(buffer);
  }

  /** Load blueprint from a pre-built Map (for testing or in-memory construction) */
  loadFromMap(entries: Map<string, BlueprintEntry>): void {
    this.data = entries;
  }

  getStrategy(infoSet: string): ActionProbabilities | null {
    if (!this.data) return null;
    const entry = this.data.get(infoSet);
    return entry ? { ...entry.strategy } : null;
  }

  getValue(infoSet: string): number | null {
    if (!this.data) return null;
    const entry = this.data.get(infoSet);
    return entry ? entry.value : null;
  }

  isLoaded(): boolean {
    return this.data !== null;
  }

  size(): number {
    return this.data ? this.data.size : 0;
  }
}

// ─── InMemoryBlueprint (for tests and real-time construction) ──────────────

/**
 * In-memory blueprint that can be built incrementally.
 * Used during offline training and for unit testing.
 */
export class InMemoryBlueprint implements BlueprintStrategy {
  private data = new Map<string, BlueprintEntry>();

  set(infoSet: string, strategy: ActionProbabilities, value: number): void {
    this.data.set(infoSet, { strategy: { ...strategy }, value });
  }

  getStrategy(infoSet: string): ActionProbabilities | null {
    const entry = this.data.get(infoSet);
    return entry ? { ...entry.strategy } : null;
  }

  getValue(infoSet: string): number | null {
    const entry = this.data.get(infoSet);
    return entry ? entry.value : null;
  }

  isLoaded(): boolean {
    return this.data.size > 0;
  }

  size(): number {
    return this.data.size;
  }

  /** Export as a serializable Map (for persistence) */
  toMap(): Map<string, BlueprintEntry> {
    return new Map(this.data);
  }
}

// ─── Serialization ─────────────────────────────────────────────────────────

/**
 * Serialize a blueprint Map to a binary Buffer.
 * Used for offline computation -> file storage.
 */
export function serializeBlueprint(data: Map<string, BlueprintEntry>): Buffer {
  // Determine the set of all actions used across all entries
  const actionSet = new Set<string>();
  for (const entry of data.values()) {
    for (const action of Object.keys(entry.strategy)) {
      actionSet.add(action);
    }
  }
  const actions = [...actionSet].sort();
  const numActions = actions.length;

  // Calculate buffer size
  // Header: 16 bytes + (action names as JSON, length-prefixed)
  const actionListJson = JSON.stringify(actions);
  const actionListBytes = Buffer.from(actionListJson, 'utf-8');

  let totalSize = 16 + 4 + actionListBytes.length; // header + action list length + action list

  for (const [key] of data) {
    const keyBytes = Buffer.from(key, 'utf-8');
    totalSize += 2 + keyBytes.length;              // key length + key
    totalSize += numActions * 4;                    // strategy floats
    totalSize += 4;                                 // value float
  }

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // Header
  buf.writeUInt32LE(BLUEPRINT_MAGIC, offset); offset += 4;
  buf.writeUInt32LE(BLUEPRINT_VERSION, offset); offset += 4;
  buf.writeUInt32LE(data.size, offset); offset += 4;
  buf.writeUInt32LE(numActions, offset); offset += 4;

  // Action list
  buf.writeUInt32LE(actionListBytes.length, offset); offset += 4;
  actionListBytes.copy(buf, offset); offset += actionListBytes.length;

  // Entries
  for (const [key, entry] of data) {
    const keyBytes = Buffer.from(key, 'utf-8');
    buf.writeUInt16LE(keyBytes.length, offset); offset += 2;
    keyBytes.copy(buf, offset); offset += keyBytes.length;

    // Strategy vector (in canonical action order)
    for (const action of actions) {
      buf.writeFloatLE(entry.strategy[action] ?? 0, offset); offset += 4;
    }

    // Expected value
    buf.writeFloatLE(entry.value, offset); offset += 4;
  }

  return buf;
}

/**
 * Deserialize a blueprint from a binary Buffer.
 */
export function deserializeBlueprint(buf: Buffer): Map<string, BlueprintEntry> {
  let offset = 0;

  // Header
  const magic = buf.readUInt32LE(offset); offset += 4;
  if (magic !== BLUEPRINT_MAGIC) {
    throw new Error(`Invalid blueprint file: bad magic number 0x${magic.toString(16)}`);
  }
  const version = buf.readUInt32LE(offset); offset += 4;
  if (version !== BLUEPRINT_VERSION) {
    throw new Error(`Unsupported blueprint version: ${version}`);
  }
  const numEntries = buf.readUInt32LE(offset); offset += 4;
  const numActions = buf.readUInt32LE(offset); offset += 4;

  // Action list
  const actionListLen = buf.readUInt32LE(offset); offset += 4;
  const actionListJson = buf.subarray(offset, offset + actionListLen).toString('utf-8');
  offset += actionListLen;
  const actions: string[] = JSON.parse(actionListJson);

  if (actions.length !== numActions) {
    throw new Error(`Action count mismatch: header says ${numActions}, list has ${actions.length}`);
  }

  // Entries
  const data = new Map<string, BlueprintEntry>();

  for (let i = 0; i < numEntries; i++) {
    const keyLen = buf.readUInt16LE(offset); offset += 2;
    const key = buf.subarray(offset, offset + keyLen).toString('utf-8');
    offset += keyLen;

    const strategy: ActionProbabilities = {};
    for (const action of actions) {
      strategy[action] = buf.readFloatLE(offset); offset += 4;
    }

    const value = buf.readFloatLE(offset); offset += 4;

    data.set(key, { strategy, value });
  }

  return data;
}

// ─── Singleton blueprint instance ──────────────────────────────────────────

/**
 * Global blueprint instance. Loaded at startup from a precomputed file.
 * Falls back gracefully when no blueprint file exists.
 */
export const blueprint = new FileBlueprint();

/**
 * Map an actual bet amount to the nearest abstract action.
 *
 * @param amount    - Actual bet/raise amount
 * @param pot       - Current pot size
 * @param stack     - Player's remaining stack
 * @param toCall    - Amount to call (0 if not facing a bet)
 * @returns The closest abstract action
 */
export function mapToAbstractAction(
  amount: number,
  pot: number,
  stack: number,
  toCall: number,
): AbstractAction {
  if (amount <= 0) {
    return toCall > 0 ? 'fold' : 'check';
  }

  // All-in detection: within 90% of stack
  if (amount >= stack * 0.9) {
    return 'allin';
  }

  // Compute bet as fraction of pot
  const effectivePot = Math.max(pot, 1);
  const betFraction = amount / effectivePot;

  // Map to nearest abstract size
  if (betFraction <= 0.50) return 'bet_33';
  if (betFraction <= 0.83) return 'bet_67';
  if (betFraction <= 1.25) return 'bet_100';
  return 'bet_150';
}

/**
 * Map an abstract action to an actual bet amount.
 *
 * @param action   - Abstract action to convert
 * @param pot      - Current pot size
 * @param stack    - Player's remaining stack
 * @param minRaise - Minimum legal raise
 * @param toCall   - Amount needed to call
 * @returns Actual chip amount (0 for fold/check/call)
 */
export function abstractToActualAmount(
  action: AbstractAction,
  pot: number,
  stack: number,
  minRaise: number,
  toCall: number,
): number {
  switch (action) {
    case 'fold':
    case 'check':
      return 0;
    case 'call':
      return Math.min(toCall, stack);
    case 'allin':
      return stack;
    case 'bet_33':
      return clampBet(Math.round(pot * 0.33), minRaise, stack);
    case 'bet_67':
      return clampBet(Math.round(pot * 0.67), minRaise, stack);
    case 'bet_100':
      return clampBet(pot, minRaise, stack);
    case 'bet_150':
      return clampBet(Math.round(pot * 1.5), minRaise, stack);
  }
}

function clampBet(amount: number, minRaise: number, stack: number): number {
  const clamped = Math.max(minRaise, Math.min(stack, amount));
  // Don't leave crumbs: if bet is >85% of stack, just go all-in
  if (clamped > stack * 0.85) return stack;
  return clamped;
}
