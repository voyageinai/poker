# Bot Intelligence Upgrade Design

## Summary

Upgrade all 11 built-in system bots from simplistic rule-based decision making to a smarter engine with real equity calculation, position awareness, bet sizing reads, multi-street memory, universal opponent modeling, and a dynamic human pressure module. Each bot retains its distinct personality (nit, tag, lag, etc.) while the decision floor is raised across the board.

## Problem Statement

Current bot weaknesses:
- **Postflop strength is coarse lookup**: `postflopStrength()` maps hand type names to fixed scores (Pair=0.48, Two Pair=0.65), ignoring within-category variance (top pair vs bottom pair)
- **Monte Carlo equity exists but is unused**: `monteCarloEquity()` in hand-eval.ts is never called by bot decision logic
- **No position awareness**: bots don't distinguish BTN from UTG
- **No bet sizing reads**: bots only see `toCall` absolute value, not whether it's 1/3 pot or 2x pot
- **No multi-street memory**: each street is decided independently with no history within a hand
- **Opponent modeling is adaptive-only**: 10 of 11 bots ignore opponent behavior entirely
- **GTO bot is pseudo-GTO**: fixed frequency distribution without range/position/history consideration

## Design Decisions

- **Approach A (selected)**: Engine-layer upgrade within existing `BuiltinBotAgent`, not a full architectural rewrite
- **Personality preserved**: `StyleParams` + `STYLE_CONFIG` system retained and extended
- **Performance budget**: 100-300ms per decision acceptable, unlocking real Monte Carlo equity
- **Human pressure**: dynamic and adaptive based on opponent skill level, not fixed global parameter
- **Transparency**: human pressure is not disclosed to players

## Module 1: Real Postflop Equity

### Current
`postflopStrength()` calls `evaluateHand()` and maps the hand name to a fixed score via `madeHandStrength()`, then adds small bonuses for draws.

### Change
Replace the lookup-based scoring with actual Monte Carlo equity:

```typescript
function postflopStrength(holeCards: [Card, Card], board: Card[]): number {
  // Run Monte Carlo against 1 random opponent
  const { equities } = monteCarloEquity([holeCards], board, [], 1500);
  let equity = equities[0];

  // Draw bonuses still apply as smoothing (MC with 1500 iterations has noise on draws)
  equity += flushDrawBonus(holeCards, board) * 0.5;  // reduced weight since MC partially captures draws
  equity += straightDrawBonus(holeCards, board) * 0.5;
  return clamp01(equity);
}
```

**Multi-opponent adjustment**: When facing N opponents, run MC with N random hands instead of 1. The `monteCarloEquity` function already supports this.

```typescript
// In requestAction, before calling chooseBuiltinAction:
const opponents = Math.max(1, this.players.filter(p => p.seat !== this.mySeat).length);
const strength = req.street === 'preflop'
  ? preflopStrength(this.holeCards)
  : postflopStrengthMC(this.holeCards, req.board, opponents);
```

**Performance**: 1500 iterations x pokersolver evaluation ~ 80-200ms. Acceptable per requirements.

**preflopStrength unchanged**: No community cards to simulate against; the existing formula is adequate for preflop.

## Module 2: Position Awareness

### Data Source
`new_hand` PBP message already includes `buttonSeat` and `players[]`. Combined with `mySeat` and player count, relative position can be derived.

### Position Calculation

```typescript
type Position = 'EP' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

function calcPosition(mySeat: number, buttonSeat: number, seatList: number[]): Position {
  // Sort active seats, find distance from button
  // 1 after button = SB, 2 after = BB, last before button = CO, button = BTN
  // Remaining split into EP (first third) and MP (rest)
}
```

### Position Factor

| Position | Factor | Rationale |
|----------|--------|-----------|
| BTN | +0.08 | Best position, act last postflop |
| CO | +0.06 | Second best |
| MP | 0.00 | Baseline |
| EP | -0.06 | First to act, positional disadvantage |
| SB | -0.06 | Out of position postflop, worst seat |
| BB | -0.02 | Already invested, defend slightly wider |

### Application

```
// Preflop: position widens/tightens opening range
adjustedStrength += positionFactor * (1 - cfg.crowdSensitivity * 0.3)

// Postflop: position affects bluff frequency
effectiveBluffRate = cfg.bluffRate + (isLatePosition ? 0.03 : -0.02)
```

### Per-Style Sensitivity

New `StyleParams` field: `positionSensitivity: number` (0-1)

| Style | positionSensitivity | Rationale |
|-------|-------------------|-----------|
| nit | 0.5 | Moderate — tighter in EP, but doesn't loosen much in LP |
| tag | 0.9 | High — textbook position play |
| lag | 0.7 | Significant but still plays wide everywhere |
| station | 0.1 | Barely notices |
| maniac | 0.1 | Doesn't care about position |
| trapper | 0.6 | Uses position for trap setups |
| bully | 0.5 | Position matters for bullying effectively |
| tilter | 0.7 | When calm, respects position; tilted = ignores |
| shortstack | 0.4 | Push/fold depends more on stack than position |
| adaptive | 0.8 | Uses position as part of exploit strategy |
| gto | 0.9 | Position is fundamental to GTO play |

Position factor is multiplied by `positionSensitivity` before application.

## Module 3: Bet Sizing Reads

### Bet Size Ratio

```typescript
const betSizeRatio = req.toCall / Math.max(req.pot, 1);
```

### Size Categories and Adjustments

| Category | Ratio | callThreshold multiplier | Meaning |
|----------|-------|------------------------|---------|
| small | < 0.4 | 0.85 | Probe/thin value, wide range |
| medium | 0.4-0.8 | 1.00 | Standard, no adjustment |
| large | 0.8-1.3 | 1.10 | Polarized range, medium hands devalued |
| overbet | > 1.3 | 1.20 | Nuts or bluff, medium hands severely devalued |

### Application

```typescript
const sizingMultiplier = getSizingMultiplier(betSizeRatio);
const adjustedCallThreshold = callThreshold * lerp(1.0, sizingMultiplier, cfg.sizingSensitivity);
```

### Per-Style Sensitivity

New `StyleParams` field: `sizingSensitivity: number` (0-1)

| Style | sizingSensitivity | Rationale |
|-------|------------------|-----------|
| nit | 0.8 | Respects big bets |
| tag | 0.7 | Reads sizing well |
| station | 0.1 | Ignores sizing (calls anyway) |
| maniac | 0.2 | Reverse — sees big bets as challenge |
| gto | 0.9 | Sizing-aware defense frequencies |
| adaptive | 0.8 | Uses sizing as exploit signal |
| Others | 0.5 | Moderate |

## Module 4: Multi-Street Memory

### Data Structure

```typescript
interface HandMemory {
  streetActions: Map<string, Array<{ seat: number; action: ActionType; amount: number }>>;
}
```

Populated from `notify(player_action)` and `notify(street)`. Cleared on `notify(new_hand)`.

### Pattern Detection

For a given opponent seat, extract behavioral patterns:

```typescript
interface OpponentHandPattern {
  checkThenBet: boolean;    // checked previous street, betting this street
  betBetBet: boolean;       // bet/raised on all previous streets
  checkCheckBet: boolean;   // checked 2+ streets then bet
  timesRaised: number;      // how many times they raised this hand
}
```

### Adjustments

| Pattern | Adjustment | Rationale |
|---------|-----------|-----------|
| checkThenBet | callThreshold +0.05 | Possible delayed value/trap |
| betBetBet | medium hands devalued (callThreshold +0.06) | Consistent aggression = strong or committed bluff |
| checkCheckBet | callThreshold +0.08 | Classic slowplay pattern |
| timesRaised >= 2 | callThreshold +0.10 | Multiple raises = very strong range |

### Per-Style Utilization

New `StyleParams` field: `patternSensitivity: number` (0-1)

| Style | patternSensitivity | Rationale |
|-------|-------------------|-----------|
| adaptive | 1.0 | Maximum pattern reading |
| gto | 0.7 | Balances patterns with theory |
| trapper | 0.8 | Recognizes traps (takes one to know one) |
| tag/nit | 0.6 | Uses patterns defensively |
| lag/bully | 0.4 | Acknowledges but doesn't overfold |
| station/maniac | 0.1 | Basically ignores |
| tilter | 0.5 (decays with tilt) | Loses pattern awareness when tilted |

## Module 5: Universal Opponent Modeling

### Promotion to Base Class

Move existing `opponentStats` tracking from adaptive-specific to `BuiltinBotAgent` base behavior. The tracking code in `notify()` already lives there; the change is making all styles *use* the data.

### Extended Statistics

Add to existing `OpponentStats`:

```typescript
interface OpponentStats {
  hands: number;
  vpip: number;
  pfr: number;
  aggActions: number;
  passActions: number;
  // New:
  cbetOpportunities: number;  // times they were preflop raiser and saw a flop
  cbets: number;              // times they c-bet
  foldToCbetCount: number;    // times they folded to a c-bet
  foldToCbetOpportunities: number;
  wtsdCount: number;          // went to showdown
  wtsdOpportunities: number;  // saw flop (could have gone to SD)
}
```

### Exploit Weight

New `StyleParams` field: `exploitWeight: number` (0-1)

Controls how much opponent stats influence decisions:

| Style | exploitWeight | Usage Pattern |
|-------|-------------|---------------|
| nit (司马懿) | 0.3 | Defensive only — avoids traps |
| tag (赵云) | 0.7 | Balanced exploit — tighter vs loose, steals vs tight |
| lag (孙悟空) | 0.7 | Attack exploits — c-bets vs high fold-to-cbet |
| station (猪八戒) | 0.1 | Nearly ignores (still calls) |
| maniac (张飞) | 0.3 | Reverse exploit — targets tight/passive players |
| trapper (王熙凤) | 0.6 | Sets targeted traps vs aggressive opponents |
| bully (鲁智深) | 0.5 | Identifies weak players to pressure |
| tilter (林冲) | 0.5 | Decays toward 0 as tilt increases |
| shortstack (燕青) | 0.4 | Adjusts push/fold range vs opponent tendencies |
| adaptive (曹操) | 1.0 | Maximum exploitation (existing behavior, expanded) |
| gto (诸葛亮) | 0.2 | Micro-adjustments only — stays near equilibrium |

### Application

```typescript
// Generic exploit adjustment example
const oppProfile = getOpponentProfile(targetSeat);
if (oppProfile.hands >= 8) {
  const exploit = computeExploit(oppProfile, cfg); // returns adjustments
  cfg.aggression += exploit.aggressionDelta * cfg.exploitWeight;
  cfg.bluffRate += exploit.bluffDelta * cfg.exploitWeight;
  cfg.callThreshold += exploit.callDelta * cfg.exploitWeight;
}
```

The `computeExploit` function encodes standard poker exploits:
- vs high VPIP + low AF (calling station): reduce bluffs, increase value bet frequency
- vs low VPIP (nit): increase steal frequency, reduce value range
- vs high fold-to-cbet: always c-bet
- vs low fold-to-cbet: only c-bet with value
- vs high AF (aggro): trap more, check-raise more
- vs high WTSD: value bet thinner, don't bluff

## Module 6: Human Pressure

### Identifying Humans

Extend `new_hand` PBP message with player metadata:

```typescript
// In PBP new_hand message, players array gains:
players: Array<{
  seat: number;
  displayName: string;
  stack: number;
  isBot: boolean;   // NEW
  elo?: number;     // NEW — only for human players
}>
```

**TableManager** populates these fields when constructing the `new_hand` message. It already knows agent types per seat. Elo comes from the `users` table (already queried at seat time).

**state-machine.ts is NOT modified** — it doesn't generate PBP messages, TableManager does.

### Skill Level Assessment

```typescript
type HumanSkillLevel = 'low' | 'mid' | 'high';

function assessHumanSkill(elo: number | undefined, stats: OpponentStats | undefined): HumanSkillLevel {
  const eloScore = elo ?? 1200;
  if (stats && stats.hands >= 20) {
    const vpipRate = stats.vpip / stats.hands;
    const af = stats.passActions > 0 ? stats.aggActions / stats.passActions : 1;
    if (eloScore < 1100 || vpipRate > 0.55 || af < 0.5) return 'low';
    if (eloScore > 1400 && vpipRate >= 0.22 && vpipRate <= 0.38 && af > 1.5) return 'high';
  } else {
    if (eloScore < 1100) return 'low';
    if (eloScore > 1400) return 'high';
  }
  return 'mid';
}
```

### Pressure Calculation

```typescript
function calcHumanPressure(skill: HumanSkillLevel, style: SystemBotStyle): number {
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

  const pressure = base[skill] + 0.03; // +0.03 base for facing any human
  const maxPressure = cap[style] ?? 0.10;
  return Math.min(pressure, maxPressure);
}
```

### Application

Human pressure is applied as the **final adjustment layer**, after all other modules:

```typescript
// In requestAction, after all other adjustments:
const humanSeats = this.players.filter(p => !p.isBot && p.seat !== this.mySeat);
if (humanSeats.length > 0) {
  // Use the weakest human at the table for pressure calculation
  const weakest = humanSeats.reduce((a, b) =>
    assessHumanSkill(a.elo, this.opponentStats.get(a.seat)) <= assessHumanSkill(b.elo, this.opponentStats.get(b.seat)) ? a : b
  );
  const pressure = calcHumanPressure(
    assessHumanSkill(weakest.elo, this.opponentStats.get(weakest.seat)),
    this.definition.style
  );
  cfg.aggression = clamp01(cfg.aggression + pressure);
  cfg.bluffRate = clamp01(cfg.bluffRate + pressure * 0.5);
  // Slightly lower call threshold vs humans (harder to bluff us out)
  callThresholdAdjustment -= pressure * 0.3;
}
```

### Key Constraint

Human pressure is capped at 0.15 max to avoid detectable behavioral anomalies. The adjustments are subtle enough that statistical analysis would require thousands of hands to distinguish from normal variance.

## Extended StyleParams

Final `StyleParams` interface after all modules:

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
  // New:
  positionSensitivity: number;   // Module 2
  sizingSensitivity: number;     // Module 3
  patternSensitivity: number;    // Module 4
  exploitWeight: number;         // Module 5
}
```

Human pressure caps are derived from style, not stored as a param (Module 6).

## Files Modified

| File | Change |
|------|--------|
| `src/server/poker/agents.ts` | Main: all 6 modules, extended StyleParams, STYLE_CONFIG values |
| `src/server/poker/hand-eval.ts` | No change (monteCarloEquity already exists) |
| `src/server/table-manager.ts` | Populate `isBot` and `elo` in new_hand PBP message |
| `src/lib/types.ts` | Extend PBP `new_hand` player type with `isBot` and `elo` fields |

## Files NOT Modified

| File | Reason |
|------|--------|
| `src/server/poker/state-machine.ts` | Pure state machine — no I/O, no bot logic |
| `src/server/poker/pot.ts` | Financial logic unchanged |
| `src/server/ws.ts` | WebSocket privacy model unchanged |
| `src/lib/system-bots.ts` | Bot definitions unchanged |

## Testing Strategy

1. **Unit tests for each module**: position calculation, bet sizing classification, pattern detection, exploit computation, human pressure calculation
2. **Integration test**: full hand simulation with upgraded bots, verify chip conservation still holds
3. **Regression**: run existing pot.ts tests (15+ cases) — must all pass
4. **Behavioral smoke test**: verify each bot style still exhibits its characteristic behavior (nit folds most, maniac raises most, etc.)
5. **Performance test**: measure decision latency with MC equity — must stay under 300ms

## Risk Mitigation

- **MC performance**: If pokersolver proves too slow at 1500 iterations, reduce to 800 or implement card-rank caching
- **agents.ts size**: File will grow significantly. If it exceeds ~800 lines, extract modules into `src/server/poker/bot-brain/` (natural evolution toward Approach B)
- **Human pressure detection**: Cap at 0.15 and apply gradually. Monitor through debug panel — the `reasoning` field in BotDebugInfo already shows decision factors
