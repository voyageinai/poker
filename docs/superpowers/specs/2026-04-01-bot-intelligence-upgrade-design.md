# Bot Intelligence Upgrade v2 — Competitive-Level Design Spec

**Date:** 2026-04-01
**Target:** Competitive system bots with distinct personalities (improved heuristic engine, not solver-level)
**Scope:** Fix dead code, decompose agents.ts into strategy modules, add positional ranges, board texture, per-opponent per-street modeling, geometric sizing, stack-depth awareness, and formula-based balanced strategy engine
**Reviewed:** Codex adversarial review completed — 10 findings addressed below

---

## 1. Problem Statement

The current bot strategy engine (`agents.ts`, 1268 lines) has:

1. **Dead code**: `cbetOpportunities`, `foldToCbetCount`, `wtsdCount` in `OpponentStats` are never incremented. Three `computeExploit()` branches never trigger.
2. **Pooled opponent model**: All opponents averaged into one profile — a nit and maniac at the same table become one "medium" opponent.
3. **No positional preflop ranges**: `preflopStrength()` gives the same score for AKo from UTG and BTN.
4. **No board texture analysis**: Strategy doesn't differentiate dry vs. wet boards.
5. **No stack-depth awareness**: Same hand evaluation at 20BB and 200BB.
6. **Pseudo-GTO**: `chooseGtoAction` uses MDF + simple curves, not a principled mixed-strategy model.
7. **Low MC iterations**: 250 samples at 6 opponents — high variance.
8. **Monolithic file**: All logic in one 1268-line file, untestable in isolation.

## 2. Design Decisions

| Dimension | Choice | Rationale |
|-----------|--------|-----------|
| Target level | Competitive heuristic (not "GTO") | Honest naming: improved heuristic engine, no solver claims |
| Code organization | Split into `strategy/` modules | Each module independently testable |
| Preflop ranges | GTO-informed hardcoded baseline + style offset | Anchored quality + personality differentiation |
| Opponent modeling | Per-player (userId key) + per-street stats | Stable identity across seat changes (Codex #1 fix) |
| Balanced strategy | Formula-based approximation | Self-contained, no external solver dependency |
| Performance | Hard 200ms decision budget | Perf gates per module (Codex #3 fix) |

## 3. File Structure

```
src/server/poker/
  agents.ts                    # Thin orchestrator: Agent interfaces + decision pipeline
                               # Re-exports strategy helpers for test compatibility (Codex #10)
  strategy/
    types.ts                   # Shared types (Position, StreetStats, BoardTexture, etc.)
    style-config.ts            # STYLE_CONFIG + StyleParams type definitions
    preflop-ranges.ts          # Positional range tables + style offsets
    board-texture.ts           # Board texture analysis
    opponent-model.ts          # Per-player OpponentStats + per-street tracking + exploit
    bet-sizing.ts              # Geometric sizing + texture/SPR adjustments + legal move clamping
    balanced-strategy.ts       # Formula-based mixed strategy engine (renamed from gto-strategy)
    stack-depth.ts             # Stack-depth-aware hand evaluation
    equity.ts                  # Monte Carlo equity (consolidated — replaces agents.ts version)
  __tests__/
    preflop-ranges.test.ts
    board-texture.test.ts
    opponent-model.test.ts
    bet-sizing.test.ts
    balanced-strategy.test.ts
    stack-depth.test.ts
    equity.test.ts
```

## 4. Module Designs

### 4.1 PBP Protocol Changes (Prerequisites)

**Codex review revealed that the current PBP event stream is insufficient for proper opponent modeling.**

Changes to `new_hand` player entries:
```typescript
players: Array<{
  seat: number
  playerId: string     // NEW — stable user ID, survives seat changes
  displayName: string
  stack: number
  isBot: boolean
  elo?: number
}>
```

New PBP message type — `showdown_result` (sent after `hand_over`):
```typescript
{
  type: 'showdown_result'
  players: Array<{ seat: number, cards: [string, string] }>  // All players who reached showdown
}
```

This enables WTSD tracking: any player in `showdown_result.players` went to showdown.

**Impact:** `TableManager` constructs PBP messages — this is a TableManager change, not a state machine change. External bots (PBP protocol users) gain richer data. The state machine remains pure.

### 4.2 Bug Fix: cbet/WTSD Statistics (`opponent-model.ts`)

**Root cause:** `notify()` in the current `BuiltinBotAgent` only tracks preflop VPIP/PFR and postflop aggregate agg/pass counts. It never increments cbet, fold-to-cbet, or WTSD counters.

**Fix — precise cbet definition (Codex #2 fix):**
- **cbet opportunity**: The preflop aggressor (last raiser preflop) makes a bet on the flop. This applies regardless of action order (IP or OOP). NOT triggered in limp pots (no preflop raiser). NOT triggered on donk bets (non-raiser betting first).
- **fold-to-cbet**: A non-raiser faces a cbet on the flop. If they fold, `foldToCbetCount++`.
- **WTSD**: Tracked via `showdown_result` PBP message. Any player present in `showdown_result.players` increments `wtsdCount`. `wtsdOpportunity` incremented for any player who sees the flop.

**Edge case definitions (Codex #9 fix):**
- Limp pots: No player is tagged as preflop aggressor → no cbet tracking on flop
- 3-bet pots: The 3-bettor is the preflop aggressor
- Donk bets (non-raiser betting into raiser): NOT a cbet — tracked as regular postflop aggression
- All-in preflop → no postflop streets → no cbet/street tracking (only WTSD via showdown_result)
- Folded-before-flop players: Not included in wtsdOpportunities
- Flop check-through: If preflop aggressor checks, `cbetOpportunity++` but NOT `cbets++`

### 4.3 Per-Player Opponent Modeling (`opponent-model.ts`)

**Codex #1 fix:** Key by `playerId` (stable user ID), not `seatIndex`.

**Current:** `getAverageOpponentProfile()` pools all opponents into one stat block.

**New:** `Map<playerId, OpponentStats>` with per-player, per-street tracking. Stats survive seat changes and carry across hands at the same table.

```typescript
interface StreetStats {
  bets: number
  checks: number
  calls: number
  raises: number
  folds: number
}

interface OpponentStats {
  playerId: string
  hands: number
  vpip: number
  pfr: number
  streets: Record<'preflop' | 'flop' | 'turn' | 'river', StreetStats>
  cbetOpportunities: number
  cbets: number
  foldToCbetOpportunities: number
  foldToCbetCount: number
  wtsdOpportunities: number
  wtsdCount: number
}
```

**Derived stats (computed, not stored):**
- `aggFactor(street)` = `(bets + raises) / max(1, calls)` per street
- `cbetRate` = `cbets / max(1, cbetOpportunities)`
- `foldToCbetRate` = `foldToCbetCount / max(1, foldToCbetOpportunities)`
- `wtsdRate` = `wtsdCount / max(1, wtsdOpportunities)`

**Exploit computation:** `computeExploit(targetPlayerId, cfg)` queries the individual opponent's stats. In multi-way pots, target the most relevant opponent (last aggressor, or positionally next to act).

**Per-street exploit additions:**
- Opponent flop AF > 2.5 but turn AF < 0.8 → "bluff-then-give-up" → increase flop float frequency
- Opponent turn AF > 2.0 and river AF > 2.0 → "double/triple barrel" → tighten later-street calling range

**Minimum sample sizes:** Exploit adjustments only activate with ≥8 hands total. Per-street exploits require ≥5 observations on the relevant street. Below threshold, use defaults (current behavior).

### 4.4 Positional Preflop Ranges (`preflop-ranges.ts`)

**Data structure:** 169-combo matrix (13x13: diagonal=pairs, upper-triangle=suited, lower-triangle=offsuit).

```typescript
type HandCombo = string  // "AKs", "QTo", "88"
type RangeTable = Map<HandCombo, number>  // combo → frequency 0~1

interface PositionalRanges {
  RFI: Record<Position, RangeTable>       // Open-raise ranges by position
  vs3Bet: Record<Position, RangeTable>    // Continue vs 3bet ranges
}
```

**GTO-informed baseline (6-max 100BB):**

| Position | RFI % | Boundary examples |
|----------|-------|-------------------|
| UTG | ~15% | 77+, ATo+, ATs+, KQs, KJs |
| MP | ~18% | 66+, A9o+, A8s+, KQo, KTs+ |
| CO | ~27% | 55+, A5o+, A2s+, KTo+, K8s+, QTo+, Q9s+, J9s+, T9s |
| BTN | ~42% | 22+, A2+, K5o+, K2s+, Q8o+, Q5s+, J8o+, J7s+, T8o+ |
| SB | ~36% | Similar to BTN, slightly tighter |
| BB | ~40-55% defend | Based on MDF vs opener position |

**Style offset system:**

```typescript
interface StyleRangeModifier {
  rfiShift: number       // Positive = loosen, negative = tighten
  premiumBoost: number   // 3bet frequency adjustment for premium hands
  suitedBonus: number    // Extra inclusion for suited hands
  speculative: number    // Extra inclusion for small pairs + suited connectors
}
```

Example offsets:
- **nit**: `rfiShift=-0.15` → UTG ~8%, BTN ~28%
- **lag**: `rfiShift=+0.12, speculative=+0.20` → BTN ~55%+
- **maniac**: `rfiShift=+0.25` → most positions 50%+
- **station**: `rfiShift=+0.18, premiumBoost=-0.10` → calls everything, rarely 3bets

**Interface:**

```typescript
function getPreflopAction(
  cards: [string, string],
  position: Position,
  style: SystemBotStyle,
  context: { facing3Bet: boolean, raisersAhead: number, stackBB: number }
): { action: 'fold' | 'call' | 'raise', frequency: number }

// Replaces current preflopStrength() — still returns 0~1 but position-aware
function preflopHandStrength(
  cards: [string, string],
  position: Position,
  style: SystemBotStyle
): number
```

### 4.5 Board Texture Analysis (`board-texture.ts`)

```typescript
interface BoardTexture {
  wetness: number                                           // 0 (K72r) ~ 1 (JTs9hh)
  pairedness: 'none' | 'paired' | 'trips'
  flushDraw: 'none' | 'backdoor' | 'possible' | 'monotone'
  straightDraw: 'none' | 'backdoor' | 'open' | 'connected'
  highCard: number                                          // Highest rank on board
  connectivity: number                                      // 0~1, how connected the ranks are
}

function analyzeBoard(board: string[]): BoardTexture
```

**Wetness formula:**
```
wetness = flushComponent + straightComponent + pairComponent
  flushComponent:    monotone=0.4, possible=0.25, backdoor=0.10, none=0
  straightComponent: connected=0.35, open=0.25, backdoor=0.10, none=0
  pairComponent:     trips=0.15, paired=0.10, none=0
  // Clamped to [0, 1]
```

**Strategy impact:**

| Texture | cbet frequency | cbet size | Check-raise freq |
|---------|---------------|-----------|-----------------|
| Dry (wetness < 0.25) | High (70-80%) | Small (33% pot) | Low |
| Medium (0.25-0.55) | Medium (50-65%) | Medium (50-60% pot) | Medium |
| Wet (wetness > 0.55) | Low (35-50%) | Large (67-75% pot) | High |
| Paired | High (75%+) | Small (25-33% pot) | Low |
| Monotone | Low (30-40%) | Large (75% pot) | High with FD |

**Performance:** Pure computation on 3-5 cards — sub-microsecond. No perf concern.

### 4.6 Bet Sizing (`bet-sizing.ts`)

**Geometric sizing model:**

Given pot size, remaining stack, and streets left, calculate the bet size that naturally commits all chips by river:

```
geometricBetFraction(pot, stack, streetsLeft) =
  (stack/pot + 1)^(1/streetsLeft) - 1

// Example: pot=100, stack=300, 3 streets → ~59% pot each street
// Example: pot=100, stack=150, 2 streets → ~58% pot each street
```

**Adjustments on geometric base:**

| Factor | Multiplier |
|--------|-----------|
| Dry board | x 0.55 |
| Wet board | x 1.25 |
| Monotone | x 1.35 |
| SPR < 3 | Shove directly |
| SPR < 1.5 | Always shove |
| Value hand (strength > 0.80) | x 1.10 |
| Bluff | x 1.15 (need fold equity) |

**Style modifiers:** maniac +20%, nit -20%, lag +10%.

**Legal move clamping (Codex #6 fix):**

All bet sizes MUST be clamped to the state machine's legal constraints:
```typescript
function clampToLegal(
  desiredAmount: number,
  minRaise: number,      // from ActionRequest
  currentBet: number,    // from ActionRequest
  stack: number,         // player's remaining stack
  raiseCap?: number      // max raises per street (from state machine)
): { action: 'raise' | 'call' | 'check', amount: number }
```

Rules:
- If `desiredAmount < minRaise` → either call (if desired was a thin raise) or raise to `minRaise`
- If `desiredAmount > stack` → all-in
- If raise cap reached → call instead of raise
- Incomplete all-in raises that don't meet minRaise are still legal (all-in exception) but don't reopen action

**Interface:**

```typescript
function chooseBetSize(
  pot: number,
  stack: number,
  streetsRemaining: number,
  texture: BoardTexture,
  strength: number,
  style: SystemBotStyle,
  isBluff: boolean,
  legalConstraints: { minRaise: number, currentBet: number, raiseCap?: number }
): { amount: number, action: 'raise' | 'call' | 'check' }

function shouldShove(stack: number, pot: number, currentBet: number): boolean
```

### 4.7 Stack-Depth Awareness (`stack-depth.ts`)

```typescript
function adjustForStackDepth(
  hand: [string, string],
  strengthRaw: number,
  stackBB: number,
  handCategory: 'premium' | 'broadway' | 'suited-connector' | 'small-pair' | 'suited-gapper' | 'offsuit'
): number
```

**Adjustment table:**

| Stack depth | Premium | Broadway | Suited connectors | Small pairs | Bare offsuit |
|-------------|---------|----------|-------------------|-------------|-------------|
| <=15BB | +0.00 | +0.03 | -0.06 | -0.04 | +0.02 |
| 16-25BB | +0.00 | +0.02 | -0.03 | -0.02 | +0.01 |
| 26-60BB | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 |
| 61-100BB | +0.00 | -0.01 | +0.03 | +0.03 | -0.01 |
| 100BB+ | +0.00 | -0.03 | +0.06 | +0.06 | -0.03 |

**Key principle:** Deep stacks favor speculative hands (set-mining, straight/flush potential with implied odds). Shallow stacks favor raw equity. Push/fold at <=15BB applies to ALL styles (not just shortstack).

**Performance:** Pure arithmetic — sub-microsecond. No perf concern.

### 4.8 Balanced Strategy Engine (`balanced-strategy.ts`)

*Renamed from `gto-strategy.ts` — this is an improved heuristic engine using game-theory-informed principles, not a solver (Codex #8 fix).*

**Core concepts:**

1. **MDF (Minimum Defense Frequency):**
   ```
   MDF = 1 - betSize / (pot + betSize)
   ```

2. **Polarized bet range model:**
   ```
   valueCutoff = 1 - (betSize / (pot + 2*betSize))  // Top X%
   bluffRatio  = betSize / (pot + betSize)           // Bluffs per value bet
   bluffFloor  = bluffRatio * valueCutoff             // Bottom Y% used as bluffs
   ```
   Hands between value and bluff → check (protection + pot control).

3. **Geometric bet sizing** from `bet-sizing.ts`, texture-adjusted, **clamped to legal moves**.

4. **Frequency-based action selection:**
   Every decision point outputs `{ raise: p1, call: p2, fold: p3 }` probabilities, random roll selects action. No hard thresholds.

5. **Board texture integration:**
   Dry boards → higher cbet frequency, smaller size, more range-betting.
   Wet boards → lower cbet frequency, larger size, more polarized.

6. **SPR-aware simplification:**
   - SPR < 2: binary (shove or fold/check)
   - SPR 2-4: two-street model (bet-bet or bet-shove)
   - SPR > 4: full multi-street geometric model

**No-bet decision flow:**
```
if SPR < 2 and strength > 0.40 → shove
if strength > valueCutoff → bet (geometric size, texture-adjusted, legally clamped)
if strength < bluffFloor and roll(bluffFreq) → bet (same size for balance)
else → check
```

**Facing-bet decision flow:**
```
continueFreq = max(MDF, strengthBasedContinue)
raiseFreq    = polarized raise range (top of continue + bluffs)
callFreq     = continueFreq - raiseFreq
foldFreq     = 1 - continueFreq
roll → raise | call | fold
```

**Relationship to styles:**
- `gto` style: 100% this engine (renamed internally, same bot personality)
- `adaptive` style: this engine as baseline, then `exploitWeight * computeExploit()` deltas applied to frequencies

### 4.9 Equity Module (`equity.ts`)

**Consolidated — single source of truth (Codex #5 fix):**

`strategy/equity.ts` replaces the inline `postflopStrengthMC()` from `agents.ts`. The `monteCarloEquity()` in `hand-eval.ts` remains for UI display purposes but internally calls the same core simulation function from `equity.ts`.

**Iteration count upgrade:**
```
iterations = max(800, round(2000 / opponents))
// 1 opponent: 2000, 2 opponents: 1000, 3+: 800 minimum
// Previous: max(500, round(1500 / opponents)) → 250 at 6 opponents
```

**Performance budget (Codex #3 fix):** MC equity is the most expensive computation. At 2000 iterations with pokersolver: ~80-150ms. If this exceeds the 200ms total budget after adding other modules, reduce to `max(600, round(1500 / opponents))`. Perf test gate: `equity.test.ts` must include a latency assertion.

**Draw bonus retained** (variance smoothing):
- Flush draw (4 to suit): +0.04
- Backdoor flush (3 to suit on flop): +0.015
- OESD (4 in window): +0.035
- Backdoor straight (3 in window on flop): +0.01

## 5. Style-Specific Overrides Preservation (Codex #7 fix)

**The following bespoke style behaviors are preserved as pipeline step 2, not absorbed into generic modules:**

### Bully
- Computes `stackRatio = myStack / avgOpponentStack`
- If ratio > 1.5: boosts aggression, looseness, bluffRate proportionally (capped +0.30 on aggression)
- This override happens BEFORE opponent modeling and ranges — it's a meta-strategy

### Tilter
- Tracks last 8 `hand_over` results
- Tilt level = `min(1, recentLosses / 5 * 1.2)` over last 5 results
- When tilted: aggression up to +0.40, looseness +0.30, bluffRate +0.15, raiseBias +0.25
- `patternSensitivity` decays with tilt (loses ability to read opponents)

### Shortstack
- At <=15BB preflop: pure push/fold decision bypasses the entire main engine
- Uses `preflopHandStrength()` from range system (upgraded) with position+stack-aware threshold
- No ICM (out of scope) but correct push/fold math for chip-EV

### All styles at <=15BB
- Stack-depth module triggers push/fold consideration for ALL styles, but only `shortstack` fully bypasses the engine. Other styles get strength adjustments that make them more likely to shove/fold but still go through the normal pipeline.

## 6. Decision Pipeline (Revised `agents.ts`)

After refactoring, `agents.ts` becomes a thin orchestrator:

```
BuiltinBotAgent.requestAction(req):
  1. Safety check — no hole cards → fold/check
  2. Style pre-overrides — bully(stack ratio), tilter(tilt level), shortstack(push/fold bypass)
  3. Opponent exploit — opponentModel.computeExploit(currentOpponentPlayerId, cfg)
  4. Balanced strategy early exit — if style=gto → balancedStrategy.choose(...)
  5. Strength calculation:
     - Preflop: preflopRanges.preflopHandStrength(cards, position, style)
     - Postflop: equity.postflopStrengthMC(cards, board, opponents)
  6. Board texture — boardTexture.analyze(board)  [postflop only]
  7. Stack depth adjustment — stackDepth.adjust(hand, strength, stackBB, category)
  8. Existing adjustments — crowd penalty, position factor, pattern detection, human pressure
  9. Action selection — betSizing.chooseAction(..., legalConstraints)
```

**Total budget: <200ms.** Breakdown target:
- MC equity (step 5): <150ms
- All other steps combined: <50ms (pure arithmetic/lookups)

## 7. Testing Strategy

### Characterization tests FIRST (Codex #4 fix)

Before any extraction, write characterization tests that capture current behavior:
- Snapshot tests: given specific (cards, board, style, opponent stats) → record exact action output
- Statistical tests: over 1000 hands, each style's aggression/looseness/fold rates fall within expected bands
- These tests become the regression gate for Phase 1 extraction

### Per-module unit tests

| Module | Test focus |
|--------|-----------|
| `preflop-ranges` | Range boundaries per position, style offsets produce correct widening/tightening, 3bet ranges subset of RFI |
| `board-texture` | Known boards produce expected classifications (K72r=dry, JTs9hh=wet, 882r=paired-dry) |
| `opponent-model` | cbet/WTSD counters increment correctly per edge case definitions (4.2), per-street AF, exploit outputs |
| `bet-sizing` | Geometric formula, texture adjustments, SPR shove, **legal move clamping** (minRaise, raise cap) |
| `balanced-strategy` | MDF calculation, value/bluff range splits, frequency normalization, SPR simplification |
| `stack-depth` | Speculative hands gain value deep, lose value shallow |
| `equity` | MC convergence at different iteration counts, **latency < 150ms assertion** |

### Test import compatibility (Codex #10 fix)

Phase 1: `agents.ts` re-exports all strategy helpers from `strategy/` modules:
```typescript
// agents.ts — compatibility re-exports
export { STYLE_CONFIG, type StyleParams } from './strategy/style-config'
export { postflopStrengthMC } from './strategy/equity'
// etc.
```

Phase 4: Migrate test imports to `strategy/` paths, remove re-exports.

## 8. Migration Strategy (Revised per Codex #4)

1. **Phase 1: Characterization tests** — Write snapshot + statistical tests capturing current behavior for all 11 styles. These are the regression gate.
2. **Phase 2: Extract (behavior-preserving)** — Move code into `strategy/` modules. `agents.ts` re-exports for compatibility. Fix cbet/WTSD counters. Add PBP `playerId` + `showdown_result`. ALL characterization tests must pass.
3. **Phase 3: New modules** — Add board texture, positional ranges, stack depth, geometric sizing one module at a time. Each module has its own tests. Characterization test bands may widen but style differentiation must hold.
4. **Phase 4: Balanced strategy rewrite** — Replace `chooseGtoAction` with new engine. Validate with dedicated tests. Migrate test imports.
5. **Phase 5: Integration tuning** — Wire everything through revised pipeline. Run full test suite. Tune thresholds via bot-vs-bot simulation.

## 9. Performance Gates (Codex #3 fix)

| Component | Budget | Measurement |
|-----------|--------|-------------|
| MC equity (postflop) | <150ms | `equity.test.ts` latency assertion |
| Preflop range lookup | <1ms | Pure lookup, no assertion needed |
| Board texture | <0.1ms | Pure computation |
| Opponent model query | <1ms | Map lookup + arithmetic |
| Bet sizing | <1ms | Arithmetic + clamping |
| Balanced strategy | <5ms | Frequency computation + roll |
| **Total decision** | **<200ms** | `bot-perf.test.ts` end-to-end assertion |

If MC equity exceeds budget: reduce iterations to `max(600, round(1500 / opponents))`.
If total exceeds budget: profile and optimize the bottleneck before adding more modules.

## 10. Out of Scope

- CFR solver / Nash equilibrium computation
- ICM for tournaments
- External solver data import (ranges are hardcoded)
- Real-time Bayesian range narrowing
- New bot styles (11 existing styles retained and enhanced)

## 11. Codex Review Resolution Log

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Seat-keyed model smears stats across players | Changed to `playerId` key (Section 4.3) |
| 2 | cbet definition wrong + WTSD needs PBP change | Fixed cbet definition + added `showdown_result` PBP message (Sections 4.1, 4.2) |
| 3 | No runtime budget | Added 200ms hard budget + per-component gates (Section 9) |
| 4 | Migration plan fake | Added characterization tests as Phase 1, separated extract from upgrade (Section 8) |
| 5 | Third equity implementation | Consolidated: `equity.ts` is single source, `hand-eval.ts` delegates (Section 4.9) |
| 6 | Sizing ignores state machine constraints | Added `clampToLegal()` with minRaise/raiseCap/all-in rules (Section 4.6) |
| 7 | Style personalities flattened | Preserved bespoke overrides as pipeline step 2 with per-style documentation (Section 5) |
| 8 | "GTO" and "NL50" are marketing | Renamed to `balanced-strategy.ts`, removed solver claims (Sections 2, 4.8) |
| 9 | Opponent model edge cases undefined | Defined cbet/WTSD for limp/donk/3bet/all-in/fold-before-flop cases (Section 4.2) |
| 10 | Test import breakage | Re-export compatibility in Phase 2, migrate in Phase 4 (Section 7) |
