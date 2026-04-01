# Bot Intelligence Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade all 11 system bots with real equity calculation, position awareness, bet sizing reads, multi-street memory, universal opponent modeling, and dynamic human pressure — while preserving each bot's distinct personality.

**Architecture:** Engine-layer upgrade within existing `BuiltinBotAgent` class in `agents.ts`. New `StyleParams` fields control how much each bot utilizes each new capability. PBP `new_hand` message extended with `isBot` and `elo` fields populated by `TableManager`.

**Tech Stack:** TypeScript, Vitest, pokersolver, existing `monteCarloEquity()` from `hand-eval.ts`

---

### Task 1: Extend StyleParams and STYLE_CONFIG with new sensitivity fields

**Files:**
- Modify: `src/server/poker/agents.ts:250-273`

- [ ] **Step 1: Write the failing test**

Create `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// We'll import internals via a test helper. For now, test the STYLE_CONFIG shape.
// Since STYLE_CONFIG is not exported, we test via the module's behavior.
// First: verify the new fields exist by importing the type check.

describe('StyleParams extensions', () => {
  it('STYLE_CONFIG has new sensitivity fields for all styles', async () => {
    // Dynamic import to get the module
    const mod = await import('../agents') as any;
    // Access STYLE_CONFIG via the module (we'll export it for testing)
    const config = mod.STYLE_CONFIG_FOR_TEST;
    expect(config).toBeDefined();

    const requiredFields = [
      'positionSensitivity',
      'sizingSensitivity',
      'patternSensitivity',
      'exploitWeight',
    ];

    const styles = ['nit', 'tag', 'lag', 'station', 'maniac', 'trapper', 'bully', 'tilter', 'shortstack', 'adaptive', 'gto'];
    for (const style of styles) {
      for (const field of requiredFields) {
        expect(config[style], `${style} missing`).toBeDefined();
        expect(typeof config[style][field], `${style}.${field} should be number`).toBe('number');
        expect(config[style][field]).toBeGreaterThanOrEqual(0);
        expect(config[style][field]).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `STYLE_CONFIG_FOR_TEST` is undefined

- [ ] **Step 3: Add new fields to StyleParams and STYLE_CONFIG**

In `src/server/poker/agents.ts`, update the `StyleParams` interface (line ~250):

```typescript
interface StyleParams {
  label: string;
  aggression: number;
  looseness: number;
  bluffRate: number;
  raiseBias: number;
  crowdSensitivity: number;
  slowplayRate: number;
  checkRaiseRate: number;
  positionSensitivity: number;
  sizingSensitivity: number;
  patternSensitivity: number;
  exploitWeight: number;
}
```

Update every entry in `STYLE_CONFIG` (line ~261) to include the four new fields:

```typescript
const STYLE_CONFIG: Record<SystemBotStyle, StyleParams> = {
  nit:        { label: '司马懿', aggression: 0.28, looseness: 0.18, bluffRate: 0.01, raiseBias: 0.08, crowdSensitivity: 1.0,  slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.5, sizingSensitivity: 0.8, patternSensitivity: 0.6, exploitWeight: 0.3 },
  tag:        { label: '赵云',   aggression: 0.52, looseness: 0.42, bluffRate: 0.04, raiseBias: 0.18, crowdSensitivity: 0.7,  slowplayRate: 0,    checkRaiseRate: 0.05, positionSensitivity: 0.9, sizingSensitivity: 0.7, patternSensitivity: 0.6, exploitWeight: 0.7 },
  lag:        { label: '孙悟空', aggression: 0.72, looseness: 0.65, bluffRate: 0.08, raiseBias: 0.28, crowdSensitivity: 0.4,  slowplayRate: 0,    checkRaiseRate: 0.08, positionSensitivity: 0.7, sizingSensitivity: 0.5, patternSensitivity: 0.4, exploitWeight: 0.7 },
  station:    { label: '猪八戒', aggression: 0.16, looseness: 0.72, bluffRate: 0,    raiseBias: 0.04, crowdSensitivity: 0.15, slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.1, sizingSensitivity: 0.1, patternSensitivity: 0.1, exploitWeight: 0.1 },
  maniac:     { label: '张飞',   aggression: 0.88, looseness: 0.82, bluffRate: 0.18, raiseBias: 0.45, crowdSensitivity: 0.2,  slowplayRate: 0,    checkRaiseRate: 0.10, positionSensitivity: 0.1, sizingSensitivity: 0.2, patternSensitivity: 0.1, exploitWeight: 0.3 },
  trapper:    { label: '王熙凤', aggression: 0.38, looseness: 0.45, bluffRate: 0.03, raiseBias: 0.12, crowdSensitivity: 0.6,  slowplayRate: 0.55, checkRaiseRate: 0.40, positionSensitivity: 0.6, sizingSensitivity: 0.5, patternSensitivity: 0.8, exploitWeight: 0.6 },
  bully:      { label: '鲁智深', aggression: 0.62, looseness: 0.55, bluffRate: 0.10, raiseBias: 0.30, crowdSensitivity: 0.5,  slowplayRate: 0,    checkRaiseRate: 0.06, positionSensitivity: 0.5, sizingSensitivity: 0.5, patternSensitivity: 0.4, exploitWeight: 0.5 },
  tilter:     { label: '林冲',   aggression: 0.48, looseness: 0.38, bluffRate: 0.03, raiseBias: 0.15, crowdSensitivity: 0.7,  slowplayRate: 0,    checkRaiseRate: 0.04, positionSensitivity: 0.7, sizingSensitivity: 0.5, patternSensitivity: 0.5, exploitWeight: 0.5 },
  shortstack: { label: '燕青',   aggression: 0.55, looseness: 0.40, bluffRate: 0.05, raiseBias: 0.20, crowdSensitivity: 0.6,  slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.4, sizingSensitivity: 0.5, patternSensitivity: 0.3, exploitWeight: 0.4 },
  adaptive:   { label: '曹操',   aggression: 0.50, looseness: 0.45, bluffRate: 0.06, raiseBias: 0.20, crowdSensitivity: 0.5,  slowplayRate: 0.05, checkRaiseRate: 0.08, positionSensitivity: 0.8, sizingSensitivity: 0.8, patternSensitivity: 1.0, exploitWeight: 1.0 },
  gto:        { label: '诸葛亮', aggression: 0.50, looseness: 0.42, bluffRate: 0.07, raiseBias: 0.22, crowdSensitivity: 0.5,  slowplayRate: 0.10, checkRaiseRate: 0.12, positionSensitivity: 0.9, sizingSensitivity: 0.9, patternSensitivity: 0.7, exploitWeight: 0.2 },
};
```

Add a test export at the bottom of agents.ts (before the closing of the file):

```typescript
/** @internal — exported only for tests */
export const STYLE_CONFIG_FOR_TEST = STYLE_CONFIG;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to confirm no regression**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): extend StyleParams with position/sizing/pattern/exploit fields"
```

---

### Task 2: Position awareness

**Files:**
- Modify: `src/server/poker/agents.ts` (BuiltinBotAgent class + new helper functions)
- Modify: `src/server/poker/__tests__/bot-intelligence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { calcPosition, getPositionFactor } from '../agents';

describe('Position awareness', () => {
  // 6-player table, seats [0,1,2,3,4,5], button=3
  // Order after button: 4=SB, 5=BB, 0=EP, 1=MP, 2=CO, 3=BTN
  it('calculates BTN position correctly', () => {
    expect(calcPosition(3, 3, [0, 1, 2, 3, 4, 5])).toBe('BTN');
  });

  it('calculates SB position correctly', () => {
    expect(calcPosition(4, 3, [0, 1, 2, 3, 4, 5])).toBe('SB');
  });

  it('calculates BB position correctly', () => {
    expect(calcPosition(5, 3, [0, 1, 2, 3, 4, 5])).toBe('BB');
  });

  it('calculates EP position correctly', () => {
    expect(calcPosition(0, 3, [0, 1, 2, 3, 4, 5])).toBe('EP');
  });

  it('calculates CO position correctly', () => {
    expect(calcPosition(2, 3, [0, 1, 2, 3, 4, 5])).toBe('CO');
  });

  it('handles 3-player table (BTN/SB/BB only)', () => {
    // seats [1,3,5], button=3 → 5=SB, 1=BB, 3=BTN
    expect(calcPosition(3, 3, [1, 3, 5])).toBe('BTN');
    expect(calcPosition(5, 3, [1, 3, 5])).toBe('SB');
    expect(calcPosition(1, 3, [1, 3, 5])).toBe('BB');
  });

  it('handles 2-player table (heads-up: BTN=SB)', () => {
    // In heads-up, button is SB, other is BB
    expect(calcPosition(0, 0, [0, 3])).toBe('SB');
    expect(calcPosition(3, 0, [0, 3])).toBe('BB');
  });

  it('getPositionFactor returns correct values', () => {
    expect(getPositionFactor('BTN')).toBe(0.08);
    expect(getPositionFactor('CO')).toBe(0.06);
    expect(getPositionFactor('MP')).toBe(0);
    expect(getPositionFactor('EP')).toBe(-0.06);
    expect(getPositionFactor('SB')).toBe(-0.06);
    expect(getPositionFactor('BB')).toBe(-0.02);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `calcPosition` and `getPositionFactor` are not exported

- [ ] **Step 3: Implement position calculation**

Add these exported functions to `src/server/poker/agents.ts` (before the `BuiltinBotAgent` class):

```typescript
export type Position = 'EP' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export function calcPosition(mySeat: number, buttonSeat: number, seatList: number[]): Position {
  const n = seatList.length;
  if (n <= 1) return 'BTN';

  // Sort seats in clockwise order starting from the seat after the button
  const sorted = [...seatList].sort((a, b) => a - b);
  const btnIdx = sorted.indexOf(buttonSeat);
  // Rotate so position 0 = button
  const rotated: number[] = [];
  for (let i = 0; i < n; i++) {
    rotated.push(sorted[(btnIdx + i) % n]);
  }
  // rotated[0] = BTN, rotated[1] = SB, rotated[2] = BB, ...

  const myIdx = rotated.indexOf(mySeat);

  // Heads-up special case: BTN is SB
  if (n === 2) return myIdx === 0 ? 'SB' : 'BB';

  if (myIdx === 0) return 'BTN';
  if (myIdx === 1) return 'SB';
  if (myIdx === 2) return 'BB';
  if (myIdx === n - 1) return 'CO';  // last before button = CO

  // Remaining seats: split into EP and MP
  // Seats 3..n-2 → first half EP, second half MP
  const middleCount = n - 4; // exclude BTN, SB, BB, CO
  if (middleCount <= 0) return 'MP'; // 4-player: seat index 3 is CO, already handled
  const epCount = Math.ceil(middleCount / 2);
  const posInMiddle = myIdx - 3; // 0-based index among middle seats
  return posInMiddle < epCount ? 'EP' : 'MP';
}

export function getPositionFactor(position: Position): number {
  switch (position) {
    case 'BTN': return 0.08;
    case 'CO':  return 0.06;
    case 'MP':  return 0;
    case 'EP':  return -0.06;
    case 'SB':  return -0.06;
    case 'BB':  return -0.02;
  }
}
```

Then add position tracking state to `BuiltinBotAgent`:

```typescript
// Add to class fields:
private myPosition: Position = 'MP';

// In notify(), case 'new_hand':
this.myPosition = calcPosition(
  msg.seat,
  msg.buttonSeat,
  msg.players.map(p => p.seat),
);
```

Then apply position in `requestAction()`, in the standard path (before `chooseBuiltinAction` call):

```typescript
// Position adjustment (before strength is used)
const posFactor = getPositionFactor(this.myPosition) * cfg.positionSensitivity;
const adjustedStrength = clamp01(strength - crowdPenalty + cfg.looseness * 0.25 + posFactor);

// Postflop bluff rate adjustment for position
const isLatePosition = this.myPosition === 'BTN' || this.myPosition === 'CO';
cfg.bluffRate = clamp01(cfg.bluffRate + (isLatePosition ? 0.03 : -0.02) * cfg.positionSensitivity);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): add position awareness to all system bots"
```

---

### Task 3: Bet sizing reads

**Files:**
- Modify: `src/server/poker/agents.ts`
- Modify: `src/server/poker/__tests__/bot-intelligence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { getBetSizingMultiplier } from '../agents';

describe('Bet sizing reads', () => {
  it('small bet (< 0.4 pot) returns < 1.0 multiplier', () => {
    expect(getBetSizingMultiplier(0.2)).toBeCloseTo(0.85, 2);
    expect(getBetSizingMultiplier(0.39)).toBeCloseTo(0.85, 2);
  });

  it('medium bet (0.4-0.8 pot) returns 1.0 multiplier', () => {
    expect(getBetSizingMultiplier(0.5)).toBeCloseTo(1.0, 2);
    expect(getBetSizingMultiplier(0.8)).toBeCloseTo(1.0, 2);
  });

  it('large bet (0.8-1.3 pot) returns > 1.0 multiplier', () => {
    expect(getBetSizingMultiplier(1.0)).toBeCloseTo(1.10, 2);
    expect(getBetSizingMultiplier(1.3)).toBeCloseTo(1.10, 2);
  });

  it('overbet (> 1.3 pot) returns 1.2 multiplier', () => {
    expect(getBetSizingMultiplier(1.5)).toBeCloseTo(1.20, 2);
    expect(getBetSizingMultiplier(3.0)).toBeCloseTo(1.20, 2);
  });

  it('zero bet returns 1.0 (no adjustment)', () => {
    expect(getBetSizingMultiplier(0)).toBeCloseTo(1.0, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `getBetSizingMultiplier` not exported

- [ ] **Step 3: Implement bet sizing reads**

Add to `src/server/poker/agents.ts`:

```typescript
/** Returns a callThreshold multiplier based on bet-to-pot ratio. */
export function getBetSizingMultiplier(betSizeRatio: number): number {
  if (betSizeRatio <= 0) return 1.0;
  if (betSizeRatio < 0.4) return 0.85;
  if (betSizeRatio <= 0.8) return 1.0;
  if (betSizeRatio <= 1.3) return 1.10;
  return 1.20;
}
```

Then integrate into `chooseBuiltinAction()`. After `callThreshold` and `raiseThreshold` are calculated:

```typescript
// Bet sizing adjustment
const betSizeRatio = req.toCall / Math.max(req.pot, 1);
const sizingMult = getBetSizingMultiplier(betSizeRatio);
const adjustedCallThreshold = callThreshold * lerp(1.0, sizingMult, cfg.sizingSensitivity);
const adjustedRaiseThreshold = raiseThreshold * lerp(1.0, sizingMult, cfg.sizingSensitivity);
```

Add `lerp` helper:

```typescript
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

Use `adjustedCallThreshold` and `adjustedRaiseThreshold` in place of the originals throughout the rest of `chooseBuiltinAction`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): add bet sizing reads to decision engine"
```

---

### Task 4: Multi-street memory

**Files:**
- Modify: `src/server/poker/agents.ts`
- Modify: `src/server/poker/__tests__/bot-intelligence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { detectPatterns, type HandActionRecord } from '../agents';

describe('Multi-street memory', () => {
  it('detects checkThenBet pattern', () => {
    const actions: HandActionRecord = {
      preflop: [],
      flop: [{ seat: 2, action: 'check', amount: 0 }],
      turn: [{ seat: 2, action: 'raise', amount: 100 }],
      river: [],
    };
    const patterns = detectPatterns(2, actions, 'turn');
    expect(patterns.checkThenBet).toBe(true);
  });

  it('detects betBetBet pattern', () => {
    const actions: HandActionRecord = {
      preflop: [{ seat: 1, action: 'raise', amount: 40 }],
      flop: [{ seat: 1, action: 'raise', amount: 80 }],
      turn: [{ seat: 1, action: 'raise', amount: 160 }],
      river: [],
    };
    const patterns = detectPatterns(1, actions, 'turn');
    expect(patterns.betBetBet).toBe(true);
  });

  it('detects checkCheckBet pattern', () => {
    const actions: HandActionRecord = {
      preflop: [],
      flop: [{ seat: 3, action: 'check', amount: 0 }],
      turn: [{ seat: 3, action: 'check', amount: 0 }],
      river: [{ seat: 3, action: 'raise', amount: 200 }],
    };
    const patterns = detectPatterns(3, actions, 'river');
    expect(patterns.checkCheckBet).toBe(true);
  });

  it('counts timesRaised correctly', () => {
    const actions: HandActionRecord = {
      preflop: [{ seat: 1, action: 'raise', amount: 40 }],
      flop: [{ seat: 1, action: 'raise', amount: 80 }, { seat: 1, action: 'raise', amount: 160 }],
      turn: [],
      river: [],
    };
    const patterns = detectPatterns(1, actions, 'flop');
    expect(patterns.timesRaised).toBe(3);
  });

  it('returns no patterns for passive play', () => {
    const actions: HandActionRecord = {
      preflop: [{ seat: 0, action: 'call', amount: 20 }],
      flop: [{ seat: 0, action: 'call', amount: 40 }],
      turn: [{ seat: 0, action: 'call', amount: 80 }],
      river: [],
    };
    const patterns = detectPatterns(0, actions, 'turn');
    expect(patterns.checkThenBet).toBe(false);
    expect(patterns.betBetBet).toBe(false);
    expect(patterns.checkCheckBet).toBe(false);
    expect(patterns.timesRaised).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `detectPatterns` and `HandActionRecord` not exported

- [ ] **Step 3: Implement multi-street memory**

Add types and detection function to `src/server/poker/agents.ts`:

```typescript
export type HandActionRecord = Record<
  'preflop' | 'flop' | 'turn' | 'river',
  Array<{ seat: number; action: ActionType; amount: number }>
>;

export interface OpponentHandPattern {
  checkThenBet: boolean;
  betBetBet: boolean;
  checkCheckBet: boolean;
  timesRaised: number;
}

const STREET_ORDER: Array<'preflop' | 'flop' | 'turn' | 'river'> = ['preflop', 'flop', 'turn', 'river'];

const AGG_ACTIONS = new Set<ActionType>(['raise', 'allin']);
const PASSIVE_ACTIONS = new Set<ActionType>(['check']);

export function detectPatterns(
  seat: number,
  actions: HandActionRecord,
  currentStreet: 'preflop' | 'flop' | 'turn' | 'river',
): OpponentHandPattern {
  const streetIdx = STREET_ORDER.indexOf(currentStreet);

  // Collect per-street summary for this seat: 'agg' | 'passive' | 'call' | 'none'
  function streetSummary(street: 'preflop' | 'flop' | 'turn' | 'river'): 'agg' | 'passive' | 'call' | 'none' {
    const seatActions = actions[street].filter(a => a.seat === seat);
    if (seatActions.length === 0) return 'none';
    if (seatActions.some(a => AGG_ACTIONS.has(a.action))) return 'agg';
    if (seatActions.some(a => a.action === 'check')) return 'passive';
    return 'call';
  }

  const summaries = STREET_ORDER.slice(0, streetIdx + 1).map(s => streetSummary(s));

  // checkThenBet: previous street was passive, current street is aggressive
  const checkThenBet = summaries.length >= 2
    && summaries[summaries.length - 2] === 'passive'
    && summaries[summaries.length - 1] === 'agg';

  // betBetBet: aggressive on 2+ consecutive streets up to current
  const aggStreaks = summaries.filter(s => s === 'agg').length;
  const betBetBet = aggStreaks >= 2 && summaries[summaries.length - 1] === 'agg';

  // checkCheckBet: 2+ passive streets then aggressive
  let checkCheckBet = false;
  if (summaries.length >= 3 && summaries[summaries.length - 1] === 'agg') {
    const prevPassive = summaries.slice(0, -1).filter(s => s === 'passive').length;
    checkCheckBet = prevPassive >= 2;
  }

  // timesRaised: total raise/allin actions across all streets
  let timesRaised = 0;
  for (const street of STREET_ORDER.slice(0, streetIdx + 1)) {
    timesRaised += actions[street].filter(a => a.seat === seat && AGG_ACTIONS.has(a.action)).length;
  }

  return { checkThenBet, betBetBet, checkCheckBet, timesRaised };
}
```

Add to `BuiltinBotAgent` class fields:

```typescript
private handActions: HandActionRecord = { preflop: [], flop: [], turn: [], river: [] };
```

Update `notify()`:
- In `case 'new_hand'`: add `this.handActions = { preflop: [], flop: [], turn: [], river: [] };`
- In `case 'player_action'`: add `this.handActions[this.currentStreet].push({ seat: msg.seat, action: msg.action, amount: msg.amount });`

Apply patterns in `requestAction()`, in the standard path, after computing `adjustedCallThreshold`:

```typescript
// Multi-street pattern adjustment
if (req.toCall > 0) {
  // Find the primary opponent (the one who last bet/raised)
  const lastAggressor = req.history.filter(h => h.action === 'raise' || h.action === 'allin').pop();
  if (lastAggressor && lastAggressor.seat !== this.mySeat) {
    const patterns = detectPatterns(lastAggressor.seat, this.handActions, req.street);
    let patternAdj = 0;
    if (patterns.checkThenBet) patternAdj += 0.05;
    if (patterns.betBetBet) patternAdj += 0.06;
    if (patterns.checkCheckBet) patternAdj += 0.08;
    if (patterns.timesRaised >= 2) patternAdj += 0.10;
    adjustedCallThreshold += patternAdj * cfg.patternSensitivity;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): add multi-street memory with pattern detection"
```

---

### Task 5: Universal opponent modeling

**Files:**
- Modify: `src/server/poker/agents.ts`
- Modify: `src/server/poker/__tests__/bot-intelligence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { computeExploit } from '../agents';

describe('Universal opponent modeling', () => {
  it('exploits calling station (high VPIP, low AF)', () => {
    const result = computeExploit({
      hands: 30, vpipRate: 0.70, pfrRate: 0.10, af: 0.4,
      cbetRate: 0.5, foldToCbetRate: 0.2, wtsdRate: 0.45,
    });
    // vs station: reduce bluffs, increase value
    expect(result.bluffDelta).toBeLessThan(0);
    expect(result.aggressionDelta).toBeGreaterThan(0);
  });

  it('exploits nit (low VPIP)', () => {
    const result = computeExploit({
      hands: 30, vpipRate: 0.15, pfrRate: 0.10, af: 1.5,
      cbetRate: 0.7, foldToCbetRate: 0.5, wtsdRate: 0.20,
    });
    // vs nit: steal more
    expect(result.bluffDelta).toBeGreaterThan(0);
  });

  it('exploits aggro player (high AF)', () => {
    const result = computeExploit({
      hands: 30, vpipRate: 0.40, pfrRate: 0.30, af: 3.5,
      cbetRate: 0.8, foldToCbetRate: 0.3, wtsdRate: 0.35,
    });
    // vs aggro: trap more
    expect(result.slowplayDelta).toBeGreaterThan(0);
    expect(result.checkRaiseDelta).toBeGreaterThan(0);
  });

  it('returns zero deltas with insufficient hands', () => {
    const result = computeExploit({
      hands: 3, vpipRate: 0.5, pfrRate: 0.5, af: 2.0,
      cbetRate: 0.5, foldToCbetRate: 0.5, wtsdRate: 0.3,
    });
    expect(result.aggressionDelta).toBe(0);
    expect(result.bluffDelta).toBe(0);
    expect(result.callThresholdDelta).toBe(0);
    expect(result.slowplayDelta).toBe(0);
    expect(result.checkRaiseDelta).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `computeExploit` not exported

- [ ] **Step 3: Implement universal exploit computation**

First, extend the `OpponentStats` interface in `src/server/poker/agents.ts`:

```typescript
interface OpponentStats {
  hands: number;
  vpip: number;
  pfr: number;
  aggActions: number;
  passActions: number;
  cbetOpportunities: number;
  cbets: number;
  foldToCbetCount: number;
  foldToCbetOpportunities: number;
  wtsdCount: number;
  wtsdOpportunities: number;
}
```

Update the init in `notify()` `case 'new_hand'` where stats are first created:

```typescript
this.opponentStats.set(p.seat, {
  hands: 0, vpip: 0, pfr: 0, aggActions: 0, passActions: 0,
  cbetOpportunities: 0, cbets: 0, foldToCbetCount: 0,
  foldToCbetOpportunities: 0, wtsdCount: 0, wtsdOpportunities: 0,
});
```

Add the opponent profile type and `computeExploit`:

```typescript
export interface OpponentProfile {
  hands: number;
  vpipRate: number;
  pfrRate: number;
  af: number;
  cbetRate: number;
  foldToCbetRate: number;
  wtsdRate: number;
}

export interface ExploitDeltas {
  aggressionDelta: number;
  bluffDelta: number;
  callThresholdDelta: number;
  slowplayDelta: number;
  checkRaiseDelta: number;
}

export function computeExploit(opp: OpponentProfile): ExploitDeltas {
  if (opp.hands < 8) {
    return { aggressionDelta: 0, bluffDelta: 0, callThresholdDelta: 0, slowplayDelta: 0, checkRaiseDelta: 0 };
  }

  let aggressionDelta = 0;
  let bluffDelta = 0;
  let callThresholdDelta = 0;
  let slowplayDelta = 0;
  let checkRaiseDelta = 0;

  // vs calling station (high VPIP, low AF): value bet thinner, don't bluff
  if (opp.vpipRate > 0.55 && opp.af < 0.8) {
    aggressionDelta += 0.12;
    bluffDelta -= 0.06;
  }

  // vs nit (low VPIP): steal more
  if (opp.vpipRate < 0.25) {
    bluffDelta += 0.08;
    aggressionDelta += 0.06;
  }

  // vs passive (low AF): bluff more, pressure
  if (opp.af < 0.8 && opp.vpipRate <= 0.55) {
    bluffDelta += 0.05;
  }

  // vs aggro (high AF): trap more
  if (opp.af > 2.5) {
    slowplayDelta += 0.12;
    checkRaiseDelta += 0.10;
  }

  // vs high fold-to-cbet: c-bet relentlessly (lower our call threshold = we bet more)
  if (opp.foldToCbetRate > 0.6) {
    aggressionDelta += 0.08;
    bluffDelta += 0.04;
  }

  // vs low fold-to-cbet: only value bet
  if (opp.foldToCbetRate < 0.3 && opp.foldToCbetRate > 0) {
    bluffDelta -= 0.04;
  }

  // vs high WTSD: value bet thinner, don't bluff
  if (opp.wtsdRate > 0.35) {
    aggressionDelta += 0.06;
    bluffDelta -= 0.04;
  }

  return { aggressionDelta, bluffDelta, callThresholdDelta, slowplayDelta, checkRaiseDelta };
}
```

Update `getAverageOpponentProfile()` to return an `OpponentProfile`:

```typescript
private getAverageOpponentProfile(): OpponentProfile {
  let totalHands = 0, totalVpip = 0, totalPfr = 0, totalAgg = 0, totalPass = 0;
  let totalCbetOpp = 0, totalCbets = 0, totalFoldCbetOpp = 0, totalFoldCbet = 0;
  let totalWtsdOpp = 0, totalWtsd = 0;
  for (const [seat, s] of this.opponentStats) {
    if (seat === this.mySeat || s.hands < 3) continue;
    totalHands += s.hands;
    totalVpip += s.vpip;
    totalPfr += s.pfr;
    totalAgg += s.aggActions;
    totalPass += s.passActions;
    totalCbetOpp += s.cbetOpportunities;
    totalCbets += s.cbets;
    totalFoldCbetOpp += s.foldToCbetOpportunities;
    totalFoldCbet += s.foldToCbetCount;
    totalWtsdOpp += s.wtsdOpportunities;
    totalWtsd += s.wtsdCount;
  }
  if (totalHands === 0) {
    return { hands: 0, vpipRate: 0.4, pfrRate: 0.2, af: 1.5, cbetRate: 0.5, foldToCbetRate: 0.4, wtsdRate: 0.3 };
  }
  return {
    hands: totalHands,
    vpipRate: totalVpip / totalHands,
    pfrRate: totalPfr / totalHands,
    af: totalPass > 0 ? totalAgg / totalPass : totalAgg > 0 ? 3 : 1,
    cbetRate: totalCbetOpp > 0 ? totalCbets / totalCbetOpp : 0.5,
    foldToCbetRate: totalFoldCbetOpp > 0 ? totalFoldCbet / totalFoldCbetOpp : 0.4,
    wtsdRate: totalWtsdOpp > 0 ? totalWtsd / totalWtsdOpp : 0.3,
  };
}
```

Apply exploits in `requestAction()` for ALL styles (not just adaptive), controlled by `exploitWeight`:

```typescript
// Universal opponent modeling
const oppProfile = this.getAverageOpponentProfile();
if (oppProfile.hands >= 8) {
  const exploit = computeExploit(oppProfile);
  cfg.aggression = clamp01(cfg.aggression + exploit.aggressionDelta * cfg.exploitWeight);
  cfg.bluffRate = clamp01(cfg.bluffRate + exploit.bluffDelta * cfg.exploitWeight);
  cfg.slowplayRate = clamp01(cfg.slowplayRate + exploit.slowplayDelta * cfg.exploitWeight);
  cfg.checkRaiseRate = clamp01(cfg.checkRaiseRate + exploit.checkRaiseDelta * cfg.exploitWeight);
}
```

Remove the old adaptive-only exploit code block (the `if (style === 'adaptive')` block that adjusted cfg based on `opp.vpipRate` and `opp.af`), since the new universal system supersedes it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): universal opponent modeling for all system bots"
```

---

### Task 6: Real postflop equity via Monte Carlo

**Files:**
- Modify: `src/server/poker/agents.ts`
- Modify: `src/server/poker/__tests__/bot-intelligence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { postflopStrengthMC } from '../agents';
import type { Card } from '@/lib/types';

describe('Monte Carlo postflop equity', () => {
  it('pocket aces on low board has high equity', () => {
    const holeCards: [Card, Card] = ['Ah', 'As'];
    const board: Card[] = ['2c', '7d', '4h'];
    const eq = postflopStrengthMC(holeCards, board, 1);
    expect(eq).toBeGreaterThan(0.75);
  });

  it('72o on AKQ board has low equity', () => {
    const holeCards: [Card, Card] = ['7h', '2d'];
    const board: Card[] = ['Ac', 'Kd', 'Qh'];
    const eq = postflopStrengthMC(holeCards, board, 1);
    expect(eq).toBeLessThan(0.15);
  });

  it('equity decreases with more opponents', () => {
    const holeCards: [Card, Card] = ['Jh', 'Ts'];
    const board: Card[] = ['9c', '3d', '2h'];
    const eq1 = postflopStrengthMC(holeCards, board, 1);
    const eq3 = postflopStrengthMC(holeCards, board, 3);
    expect(eq1).toBeGreaterThan(eq3);
  });

  it('returns value between 0 and 1', () => {
    const holeCards: [Card, Card] = ['5h', '5d'];
    const board: Card[] = ['Tc', '8d', '3h', 'Js'];
    const eq = postflopStrengthMC(holeCards, board, 2);
    expect(eq).toBeGreaterThanOrEqual(0);
    expect(eq).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `postflopStrengthMC` not exported

- [ ] **Step 3: Implement MC-based postflop strength**

Add import at top of `src/server/poker/agents.ts`:

```typescript
import { evaluateHand, monteCarloEquity } from './hand-eval';
```

(Replace the existing `import { evaluateHand } from './hand-eval';`)

Add the new function:

```typescript
/**
 * Monte Carlo postflop equity estimation.
 * Runs MC against `opponents` random hands. Includes draw bonus smoothing.
 */
export function postflopStrengthMC(
  holeCards: [Card, Card],
  board: Card[],
  opponents: number,
): number {
  const iterations = Math.round(1500 / Math.max(opponents, 1));
  // Build random opponent hands array for MC
  const hands: Array<[Card, Card]> = [holeCards];
  // monteCarloEquity handles random opponent cards internally — we pass just our hand
  // and it simulates against N opponents. But the current API takes explicit hands.
  // So we need to call it with only our hand and 1 opponent at a time, averaging.
  // Actually, the simplest correct approach: run MC with our hand vs 1 random opponent
  // and adjust for multiple opponents via the power rule: equity_n ≈ equity_1^(n*0.7)
  const { equities } = monteCarloEquity([holeCards], board, [], iterations);
  const headsUpEquity = equities[0];

  // Multi-opponent adjustment: equity drops roughly as equity^(n*factor)
  const multiAdj = opponents <= 1 ? headsUpEquity : Math.pow(headsUpEquity, 1 + (opponents - 1) * 0.35);

  // Draw bonus smoothing (MC with limited iterations has noise on draws)
  const drawBonus = flushDrawBonus(holeCards, board) * 0.5
                  + straightDrawBonus(holeCards, board) * 0.5;

  return clamp01(multiAdj + drawBonus);
}
```

Note: `monteCarloEquity` with a single hand in the array simulates against 1 random opponent by dealing random hole cards for the opponent in each iteration.

Wait — reading the `monteCarloEquity` function again, it takes an array of known hands and simulates boards. It does NOT generate random opponent hands. We need to modify the approach.

Instead, generate random opponent hands ourselves:

```typescript
export function postflopStrengthMC(
  holeCards: [Card, Card],
  board: Card[],
  opponents: number,
): number {
  const iterations = Math.max(500, Math.round(1500 / Math.max(opponents, 1)));
  const usedCards = new Set<Card>([...holeCards, ...board]);
  const remaining = freshDeck().filter(c => !usedCards.has(c));

  let wins = 0;
  let ties = 0;

  for (let i = 0; i < iterations; i++) {
    // Shuffle remaining cards, deal opponent hands and remaining board
    const deck = [...remaining];
    // Fisher-Yates partial shuffle
    const needed = opponents * 2 + (5 - board.length);
    for (let j = 0; j < needed && j < deck.length; j++) {
      const idx = j + Math.floor(Math.random() * (deck.length - j));
      [deck[j], deck[idx]] = [deck[idx], deck[j]];
    }

    // Deal opponent hands
    let di = 0;
    const oppHands: Array<[Card, Card]> = [];
    for (let o = 0; o < opponents; o++) {
      oppHands.push([deck[di++], deck[di++]]);
    }

    // Complete the board
    const simBoard = [...board];
    while (simBoard.length < 5) {
      simBoard.push(deck[di++]);
    }

    // Evaluate all hands
    const myHand = Hand.solve([...holeCards, ...simBoard]);
    const oppSolved = oppHands.map(h => Hand.solve([...h, ...simBoard]));

    // Check if we win against all opponents
    let iWin = true;
    let isTie = false;
    for (const oh of oppSolved) {
      const winners = Hand.winners([myHand, oh]);
      if (winners.length === 2) {
        isTie = true;
      } else if (winners[0] !== myHand) {
        iWin = false;
        break;
      }
    }
    if (iWin && !isTie) wins++;
    else if (iWin && isTie) ties++;
  }

  const equity = (wins + ties * 0.5) / iterations;

  const drawBonus = flushDrawBonus(holeCards, board) * 0.5
                  + straightDrawBonus(holeCards, board) * 0.5;

  return clamp01(equity + drawBonus);
}
```

Add import of `Hand` from pokersolver and `freshDeck` from deck at top of file:

```typescript
import { Hand } from 'pokersolver';
import { freshDeck } from './deck';
```

Then update `requestAction()` to use the new function. Replace the existing strength calculation in the standard path:

```typescript
const strength = req.street === 'preflop'
  ? preflopStrength(this.holeCards)
  : postflopStrengthMC(this.holeCards, req.board, opponents);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS (note: MC tests are probabilistic; the thresholds are conservative enough to pass reliably)

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): replace postflop lookup with Monte Carlo equity calculation"
```

---

### Task 7: Extend PBP new_hand with isBot and elo fields

**Files:**
- Modify: `src/lib/types.ts:298-308`
- Modify: `src/server/table-manager.ts:309-323`

- [ ] **Step 1: Write the failing test**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
describe('PBP new_hand extension type check', () => {
  it('PbpServerMessage new_hand type includes isBot and elo', () => {
    // Type-level test: if this compiles, the fields exist
    const msg: PbpServerMessage = {
      type: 'new_hand',
      handId: 'test',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'Alice', stack: 1000, isBot: false, elo: 1200 },
        { seat: 1, displayName: 'Bot1', stack: 1000, isBot: true },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    };
    expect(msg.players[0].isBot).toBe(false);
    expect(msg.players[0].elo).toBe(1200);
    expect(msg.players[1].isBot).toBe(true);
    expect(msg.players[1].elo).toBeUndefined();
  });
});
```

Add the import at top of the test file:

```typescript
import type { PbpServerMessage } from '@/lib/types';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — TypeScript error, `isBot` and `elo` don't exist on the player type

- [ ] **Step 3: Extend PbpServerMessage type**

In `src/lib/types.ts`, update the `new_hand` variant (line ~304):

```typescript
  | {
      type: 'new_hand';
      handId: string;
      seat: number;
      stack: number;
      players: Array<{ seat: number; displayName: string; stack: number; isBot: boolean; elo?: number }>;
      smallBlind: number;
      bigBlind: number;
      buttonSeat: number;
    }
```

- [ ] **Step 4: Update TableManager to populate new fields**

In `src/server/table-manager.ts`, update the `new_hand` notification (line ~317):

```typescript
players: this.state.players
  .filter((pl): pl is PlayerState => pl !== null)
  .map(pl => {
    const seatInfo = this.agents.get(pl.seatIndex);
    const isBot = seatInfo?.botId !== null;
    // Look up elo for human players
    let elo: number | undefined;
    if (!isBot) {
      const user = getUserById(pl.userId);
      if (user) elo = user.elo;
    }
    return { seat: pl.seatIndex, displayName: pl.displayName, stack: pl.stack, isBot, elo };
  }),
```

Add import at top of `table-manager.ts` if not already present:

```typescript
import { getUserById } from '@/db/queries';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/server/table-manager.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(pbp): extend new_hand message with isBot and elo fields"
```

---

### Task 8: Human pressure module

**Files:**
- Modify: `src/server/poker/agents.ts`
- Modify: `src/server/poker/__tests__/bot-intelligence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
import { assessHumanSkill, calcHumanPressure } from '../agents';

describe('Human pressure module', () => {
  describe('assessHumanSkill', () => {
    it('low elo = low skill', () => {
      expect(assessHumanSkill(1050, undefined)).toBe('low');
    });

    it('high elo = high skill', () => {
      expect(assessHumanSkill(1500, undefined)).toBe('high');
    });

    it('default elo = mid skill', () => {
      expect(assessHumanSkill(1200, undefined)).toBe('mid');
    });

    it('high VPIP with enough hands = low skill regardless of elo', () => {
      const stats = { hands: 25, vpipRate: 0.60, af: 0.8 };
      expect(assessHumanSkill(1250, stats)).toBe('low');
    });

    it('good stats with high elo = high skill', () => {
      const stats = { hands: 25, vpipRate: 0.30, af: 2.0 };
      expect(assessHumanSkill(1450, stats)).toBe('high');
    });
  });

  describe('calcHumanPressure', () => {
    it('returns higher pressure for low skill', () => {
      const low = calcHumanPressure('low', 'tag');
      const high = calcHumanPressure('high', 'tag');
      expect(low).toBeGreaterThan(high);
    });

    it('caps pressure for station at 0.05', () => {
      const p = calcHumanPressure('low', 'station');
      expect(p).toBeLessThanOrEqual(0.05);
    });

    it('caps pressure for maniac at 0.05', () => {
      const p = calcHumanPressure('low', 'maniac');
      expect(p).toBeLessThanOrEqual(0.05);
    });

    it('allows higher cap for nit (0.12)', () => {
      const p = calcHumanPressure('low', 'nit');
      expect(p).toBeLessThanOrEqual(0.12);
      expect(p).toBeGreaterThan(0.05);
    });

    it('always returns a non-negative value', () => {
      expect(calcHumanPressure('high', 'gto')).toBeGreaterThanOrEqual(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL — `assessHumanSkill` and `calcHumanPressure` not exported

- [ ] **Step 3: Implement human pressure functions**

Add to `src/server/poker/agents.ts`:

```typescript
export type HumanSkillLevel = 'low' | 'mid' | 'high';

export function assessHumanSkill(
  elo: number | undefined,
  stats: { hands: number; vpipRate: number; af: number } | undefined,
): HumanSkillLevel {
  const eloScore = elo ?? 1200;

  if (stats && stats.hands >= 20) {
    if (eloScore < 1100 || stats.vpipRate > 0.55 || stats.af < 0.5) return 'low';
    if (eloScore > 1400 && stats.vpipRate >= 0.22 && stats.vpipRate <= 0.38 && stats.af > 1.5) return 'high';
  } else {
    if (eloScore < 1100) return 'low';
    if (eloScore > 1400) return 'high';
  }
  return 'mid';
}

export function calcHumanPressure(skill: HumanSkillLevel, style: SystemBotStyle): number {
  const base: Record<HumanSkillLevel, number> = {
    low: 0.08,
    mid: 0.05,
    high: 0.01,
  };

  const cap: Partial<Record<SystemBotStyle, number>> = {
    station: 0.05,
    maniac: 0.05,
    nit: 0.12,
  };

  const pressure = base[skill] + 0.03;
  const maxPressure = cap[style] ?? 0.10;
  return Math.min(pressure, maxPressure);
}
```

Add player metadata tracking to `BuiltinBotAgent`:

```typescript
// Add to class fields:
private playerMeta = new Map<number, { isBot: boolean; elo?: number }>();
```

Update `notify()` `case 'new_hand'`:

```typescript
this.playerMeta.clear();
for (const p of msg.players) {
  this.playerMeta.set(p.seat, { isBot: p.isBot ?? true, elo: p.elo });
}
```

Apply human pressure as the final layer in `requestAction()`, after all other cfg adjustments and before `chooseBuiltinAction` is called:

```typescript
// Human pressure (final adjustment layer)
for (const [seat, meta] of this.playerMeta) {
  if (seat === this.mySeat || meta.isBot) continue;
  const oppStats = this.opponentStats.get(seat);
  let statsForAssess: { hands: number; vpipRate: number; af: number } | undefined;
  if (oppStats && oppStats.hands >= 3) {
    statsForAssess = {
      hands: oppStats.hands,
      vpipRate: oppStats.vpip / oppStats.hands,
      af: oppStats.passActions > 0 ? oppStats.aggActions / oppStats.passActions : 1,
    };
  }
  const skill = assessHumanSkill(meta.elo, statsForAssess);
  const pressure = calcHumanPressure(skill, this.definition.style);
  cfg.aggression = clamp01(cfg.aggression + pressure);
  cfg.bluffRate = clamp01(cfg.bluffRate + pressure * 0.5);
  break; // Apply pressure based on weakest human found (first non-bot)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): add dynamic human pressure module"
```

---

### Task 9: Update GTO bot to use new modules

**Files:**
- Modify: `src/server/poker/agents.ts` (the `chooseGtoAction` function and its callsite)

The GTO bot (诸葛亮) currently bypasses the standard path entirely via an early return. It needs to benefit from the new modules too.

- [ ] **Step 1: Write the failing test**

Append to `src/server/poker/__tests__/bot-intelligence.test.ts`:

```typescript
describe('GTO bot uses MC equity', () => {
  it('GTO chooseGtoAction uses real equity when board is present', async () => {
    // We test indirectly: create a BuiltinBotAgent with GTO style and verify
    // its action includes debug info with equity that reflects MC calculation
    const { BuiltinBotAgent } = await import('../agents');
    const { SYSTEM_BOTS } = await import('@/lib/system-bots');
    const gtoDef = SYSTEM_BOTS.find(b => b.style === 'gto')!;
    const agent = new BuiltinBotAgent('test-user', gtoDef);

    // Notify: new hand
    agent.notify({
      type: 'new_hand',
      handId: 'test-1',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'GTO', stack: 1000, isBot: true },
        { seat: 1, displayName: 'Opp', stack: 1000, isBot: true },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    });

    // Notify: hole cards (pocket aces)
    agent.notify({ type: 'hole_cards', cards: ['Ah', 'As'] });

    // Notify: flop
    agent.notify({ type: 'street', name: 'flop', board: ['2c', '7d', '4h'] });

    // Request action on flop
    const result = await agent.requestAction({
      street: 'flop',
      board: ['2c', '7d', '4h'],
      pot: 40,
      currentBet: 0,
      toCall: 0,
      minRaise: 20,
      stack: 980,
      history: [],
    });

    // GTO with AA on a dry board should have high equity
    expect(result.debug?.equity).toBeGreaterThan(0.7);
    // Should bet (not check) with such a strong hand most of the time
    // (probabilistic, but AA on 274r should bet >80% of the time)
    expect(['raise', 'check', 'allin']).toContain(result.action);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: FAIL or the equity value is based on old lookup (0.48 for pair) rather than MC

- [ ] **Step 3: Update GTO bot to use MC equity**

In `src/server/poker/agents.ts`, update `chooseGtoAction` to accept and use MC equity:

```typescript
function chooseGtoAction(
  holeCards: [Card, Card],
  req: ActionRequest,
  playerCount: number,
): { result: PokerAction; strength: number; potOdds: number; foldFreq: number; callFreq: number; raiseFreq: number } {
  const opponents = Math.max(1, playerCount - 1);
  const strength = req.street === 'preflop'
    ? preflopStrength(holeCards)
    : postflopStrengthMC(holeCards, req.board, opponents);
  // ... rest of function unchanged
```

This replaces the old:
```typescript
  const strength = req.street === 'preflop'
    ? preflopStrength(holeCards)
    : postflopStrength(holeCards, req.board);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/poker/__tests__/bot-intelligence.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/poker/agents.ts src/server/poker/__tests__/bot-intelligence.test.ts
git commit -m "feat(bots): upgrade GTO bot to use Monte Carlo equity"
```

---

### Task 10: Integration test — full hand simulation

**Files:**
- Create: `src/server/poker/__tests__/bot-integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `src/server/poker/__tests__/bot-integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BuiltinBotAgent } from '../agents';
import { SYSTEM_BOTS, type SystemBotDefinition } from '@/lib/system-bots';
import type { Card, PbpServerMessage } from '@/lib/types';

function createAgent(style: string): BuiltinBotAgent {
  const def = SYSTEM_BOTS.find(b => b.style === style)!;
  return new BuiltinBotAgent(def.userId, def);
}

function notifyNewHand(agent: BuiltinBotAgent, seat: number, stack: number, buttonSeat: number): void {
  agent.notify({
    type: 'new_hand',
    handId: `hand-${Date.now()}`,
    seat,
    stack,
    players: [
      { seat: 0, displayName: 'P0', stack: 1000, isBot: true },
      { seat: 1, displayName: 'P1', stack: 1000, isBot: false, elo: 1100 },
      { seat: 2, displayName: 'P2', stack: 1000, isBot: true },
    ],
    smallBlind: 10,
    bigBlind: 20,
    buttonSeat,
  });
}

describe('Bot integration', () => {
  it('all 11 bot styles produce valid actions preflop', async () => {
    for (const def of SYSTEM_BOTS) {
      const agent = new BuiltinBotAgent(def.userId, def);
      notifyNewHand(agent, 0, 1000, 2);
      agent.notify({ type: 'hole_cards', cards: ['Ah', 'Kd'] });

      const action = await agent.requestAction({
        street: 'preflop',
        board: [],
        pot: 30,
        currentBet: 20,
        toCall: 20,
        minRaise: 20,
        stack: 980,
        history: [{ seat: 1, action: 'call', amount: 20 }],
      });

      expect(['fold', 'check', 'call', 'raise', 'allin']).toContain(action.action);
      expect(action.debug).toBeDefined();
      expect(action.debug!.reasoning).toContain(def.name);
    }
  });

  it('all 11 bot styles produce valid actions postflop', async () => {
    for (const def of SYSTEM_BOTS) {
      const agent = new BuiltinBotAgent(def.userId, def);
      notifyNewHand(agent, 0, 1000, 2);
      agent.notify({ type: 'hole_cards', cards: ['Td', 'Tc'] });
      agent.notify({ type: 'street', name: 'flop', board: ['2h', '7d', 'Jc'] });

      const action = await agent.requestAction({
        street: 'flop',
        board: ['2h', '7d', 'Jc'],
        pot: 60,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 960,
        history: [],
      });

      expect(['fold', 'check', 'call', 'raise', 'allin']).toContain(action.action);
      expect(action.debug).toBeDefined();
    }
  }, 30000); // 30s timeout for MC calculations across 11 bots

  it('nit folds weak hands more than maniac', async () => {
    const trials = 20;
    let nitFolds = 0;
    let maniacFolds = 0;

    for (let i = 0; i < trials; i++) {
      const nit = createAgent('nit');
      const maniac = createAgent('maniac');

      for (const agent of [nit, maniac]) {
        notifyNewHand(agent, 0, 1000, 2);
        agent.notify({ type: 'hole_cards', cards: ['8h', '3d'] }); // weak hand
      }

      const nitAction = await nit.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 20, minRaise: 20, stack: 980,
        history: [{ seat: 1, action: 'raise', amount: 60 }],
      });

      const maniacAction = await maniac.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 20, minRaise: 20, stack: 980,
        history: [{ seat: 1, action: 'raise', amount: 60 }],
      });

      if (nitAction.action === 'fold') nitFolds++;
      if (maniacAction.action === 'fold') maniacFolds++;
    }

    // Nit should fold 83o to a raise much more often than maniac
    expect(nitFolds).toBeGreaterThan(maniacFolds);
  });

  it('human pressure increases aggression vs human players', async () => {
    const trials = 30;
    let raiseCountWithHuman = 0;
    let raiseCountWithoutHuman = 0;

    for (let i = 0; i < trials; i++) {
      // With human (low elo)
      const agentH = createAgent('tag');
      agentH.notify({
        type: 'new_hand', handId: `h-${i}`, seat: 0, stack: 1000,
        players: [
          { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
          { seat: 1, displayName: 'Human', stack: 1000, isBot: false, elo: 1000 },
        ],
        smallBlind: 10, bigBlind: 20, buttonSeat: 0,
      });
      agentH.notify({ type: 'hole_cards', cards: ['Jh', 'Ts'] });
      const actionH = await agentH.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 10, minRaise: 20, stack: 990,
        history: [],
      });
      if (actionH.action === 'raise' || actionH.action === 'allin') raiseCountWithHuman++;

      // Without human (all bots)
      const agentB = createAgent('tag');
      agentB.notify({
        type: 'new_hand', handId: `b-${i}`, seat: 0, stack: 1000,
        players: [
          { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
          { seat: 1, displayName: 'Bot2', stack: 1000, isBot: true },
        ],
        smallBlind: 10, bigBlind: 20, buttonSeat: 0,
      });
      agentB.notify({ type: 'hole_cards', cards: ['Jh', 'Ts'] });
      const actionB = await agentB.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 10, minRaise: 20, stack: 990,
        history: [],
      });
      if (actionB.action === 'raise' || actionB.action === 'allin') raiseCountWithoutHuman++;
    }

    // Should raise more often when a low-skill human is present
    expect(raiseCountWithHuman).toBeGreaterThanOrEqual(raiseCountWithoutHuman);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/server/poker/__tests__/bot-integration.test.ts --timeout 60000`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass including pot.test.ts and state-machine.test.ts

- [ ] **Step 4: Commit**

```bash
git add src/server/poker/__tests__/bot-integration.test.ts
git commit -m "test(bots): add integration tests for upgraded bot intelligence"
```

---

### Task 11: Clean up old postflopStrength and unused code

**Files:**
- Modify: `src/server/poker/agents.ts`

- [ ] **Step 1: Remove old postflopStrength function**

The old `postflopStrength` function (which used `madeHandStrength` lookup) is now replaced by `postflopStrengthMC`. Remove:
- `function postflopStrength(holeCards: [Card, Card], board: Card[]): number` 
- `function madeHandStrength(name: string): number`
- `function pairQualityBonus(holeCards: [Card, Card], board: Card[]): number`

Keep `flushDrawBonus` and `straightDrawBonus` as they are still used by `postflopStrengthMC` for draw smoothing.

Also remove the old adaptive-only exploit block (the `if (style === 'adaptive')` section that was replaced in Task 5).

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All pass — nothing should reference the removed functions

- [ ] **Step 3: Commit**

```bash
git add src/server/poker/agents.ts
git commit -m "refactor(bots): remove old postflop lookup and redundant adaptive-only code"
```

---

### Task 12: Performance verification

**Files:**
- Create: `src/server/poker/__tests__/bot-perf.test.ts`

- [ ] **Step 1: Write performance test**

Create `src/server/poker/__tests__/bot-perf.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BuiltinBotAgent } from '../agents';
import { SYSTEM_BOTS } from '@/lib/system-bots';

describe('Bot decision performance', () => {
  it('postflop decision completes within 300ms', async () => {
    const def = SYSTEM_BOTS.find(b => b.style === 'tag')!;
    const agent = new BuiltinBotAgent(def.userId, def);

    agent.notify({
      type: 'new_hand',
      handId: 'perf-test',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
        { seat: 1, displayName: 'Opp', stack: 1000, isBot: false, elo: 1200 },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    });
    agent.notify({ type: 'hole_cards', cards: ['Jh', 'Ts'] });
    agent.notify({ type: 'street', name: 'flop', board: ['9c', '3d', '2h'] });

    const start = performance.now();
    await agent.requestAction({
      street: 'flop',
      board: ['9c', '3d', '2h'],
      pot: 60,
      currentBet: 40,
      toCall: 40,
      minRaise: 40,
      stack: 960,
      history: [{ seat: 1, action: 'raise', amount: 40 }],
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(300);
  });

  it('preflop decision completes within 5ms (no MC)', async () => {
    const def = SYSTEM_BOTS.find(b => b.style === 'gto')!;
    const agent = new BuiltinBotAgent(def.userId, def);

    agent.notify({
      type: 'new_hand',
      handId: 'perf-test-2',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
        { seat: 1, displayName: 'Opp', stack: 1000, isBot: true },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    });
    agent.notify({ type: 'hole_cards', cards: ['Ah', 'Kd'] });

    const start = performance.now();
    await agent.requestAction({
      street: 'preflop',
      board: [],
      pot: 30,
      currentBet: 20,
      toCall: 20,
      minRaise: 20,
      stack: 980,
      history: [],
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run performance test**

Run: `npx vitest run src/server/poker/__tests__/bot-perf.test.ts`
Expected: PASS — postflop < 300ms, preflop < 5ms

- [ ] **Step 3: Commit**

```bash
git add src/server/poker/__tests__/bot-perf.test.ts
git commit -m "test(bots): add performance tests for decision latency"
```

---

### Task 13: Final full regression

- [ ] **Step 1: Run complete test suite**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Successful build, no TypeScript errors

- [ ] **Step 4: Final commit (if any lint/build fixes needed)**

```bash
git add -A
git commit -m "chore: fix any lint/build issues from bot intelligence upgrade"
```
