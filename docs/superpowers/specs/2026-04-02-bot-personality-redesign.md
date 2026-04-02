# Bot Personality Redesign: Playbook + Sizing + Unconditional Bluff

**Date:** 2026-04-02
**Status:** Draft
**Scope:** A+B — 下注尺度个性化 + 无条件 bluff/签名招数

## Problem

所有 bot 的"个性"本质上是同一个 GTO 求解器的松紧度滑块。具体表现：

1. **求解器路径下 bet size 分布相同** — `style-deviations.ts` 的 4 个标量只调整 bet 频率，不调整尺度偏好。maniac 和 nit 选择 bet_33 vs bet_100 的比例完全一致。
2. **所有 bluff 被手牌强度门槛锁死** — 启发式路径 `strength > bluffFloor`，求解器路径 `strength < 0.45` 才算 bluff 候选。没有纯位置/频率驱动的无条件 bluff。
3. **没有签名招数** — 无 limp-reraise、overbet、random shove 等标志性 play pattern。
4. **`adaptive` 和 `gto` 在求解器层完全相同**（仅 exploitWeight 不同）。

**目标:** 让玩家"一看就知道是谁打的"。每个 bot 有 2-3 个独特的行为模式，不仅频率不同，而且打法结构不同。

## Architecture

### Decision Flow (改造后)

```
requestAction()
  ├─ [1] Playbook.match(style, context)     ← 新增：签名招数优先匹配
  │     命中 → 直接返回，跳过后续路径
  ├─ [2] UnconditionalBluff.check(style, context) ← 新增：位置/牌面驱动 bluff
  │     命中 → 直接返回
  ├─ [3] Solver path (DCFR/Blueprint)
  │     └─ applyPostflopStyleDeviation()    ← 现有
  │     └─ applyStyleSizing()               ← 新增：尺度偏好加权
  ├─ [4] GTO balanced (诸葛亮 only)         ← 现有，不动
  ├─ [5] Preflop CFR/heuristic              ← 现有，不动
  └─ [6] Postflop heuristic (chooseBuiltinAction)
        └─ chooseBetSize() 使用 SizingProfile ← 改造
```

**优先级:** Playbook > Unconditional Bluff > Solver > Heuristic

Playbook 和 Unconditional Bluff 的触发频率经过设计，确保大部分手牌仍走求解器/启发式路径（Playbook 触发率 5-20%，Bluff 引擎 0-25%），签名招数是点缀而非主体。

### State Tracking

在 `BuiltinBotAgent` 中新增两个实例字段：

```typescript
// 本手牌是否处于 bluff line 中（用于多街连续施压判断）
private currentBluffLine: boolean = false;

// 本手牌中"我"之前在各街的动作记录（用于 priorActions 匹配）
private myActionsThisHand: Array<{ street: Street; action: string }> = [];
```

在 `onNewHand()` 中重置这两个字段。在 `requestAction()` 返回前记录动作到 `myActionsThisHand`。

---

## Module 1: Playbook System

**New file:** `src/server/poker/strategy/playbook.ts`

### Data Model

```typescript
type Street = 'preflop' | 'flop' | 'turn' | 'river';
type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

interface PlayPattern {
  name: string;                           // human-readable identifier
  trigger: PatternTrigger;
  action: PatternAction;
  frequency: number;                      // 0..1, roll dice to activate
  strengthGate?: [number, number] | null; // optional [min, max], null = unconditional
}

interface PatternTrigger {
  streets?: Street[];
  positions?: Position[];
  facingAction?: 'none' | 'bet' | 'raise' | 'limp';
  minPotBB?: number;
  maxOpponents?: number;
  minOpponents?: number;
  stackDepthBB?: [number, number];         // [min, max]
  boardWetness?: [number, number];         // [min, max] from BoardTexture
  priorMyActions?: Array<{ street: Street; action: string }>;
  // 特殊条件
  chipAdvantageRatio?: number;             // stack / avg_opponent_stack > this
  lastHandLostToSeat?: boolean;            // tilter: 上手输给当前对手
}

interface PatternAction {
  type: 'raise' | 'allin' | 'check' | 'call' | 'fold';
  sizing?: SizingSpec;
}

type SizingSpec =
  | { mode: 'pot_fraction'; fraction: number }
  | { mode: 'bb_multiple'; multiple: number }
  | { mode: 'allin' }
  | { mode: 'minraise' }
  | { mode: 'prev_bet_multiple'; multiple: number };  // e.g. 3.5x the raise
```

### Per-Style Playbooks

```typescript
const PLAYBOOKS: Record<SystemBotStyle, PlayPattern[]> = { ... }
```

#### maniac (张飞)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | random_shove | postflop, no bet facing, ≤2 opponents | allin | 8% | none |
| 2 | overbet_bluff | turn/river, facing check, BTN/CO | raise 1.5x pot | 15% | none |
| 3 | 3bet_light | preflop, facing 1 raise, any position | raise 3.5x open | 20% | none |
| 4 | donk_bomb | flop, out of position, facing no bet | raise 1.0x pot | 12% | none |

Maniac 的签名：**完全不看牌**。8% 的时候翻后直接全下，15% 的时候 overbet bluff。玩家会学到"张飞可能什么都没有就全下"。

#### trapper (王熙凤)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | limp_reraise | preflop, I limped, now facing raise | raise 4x the raise | 40% | [0.60, 1.0] |
| 2 | delayed_cbet | flop I checked, turn facing check | raise 0.75x pot | 35% | [0.50, 1.0] |
| 3 | min_raise_trap | postflop, facing bet, strong hand | minraise | 50% | [0.80, 1.0] |
| 4 | check_call_check_raise | flop check-called, turn facing bet | raise 2.5x bet | 30% | [0.70, 1.0] |

Trapper 的签名：**示弱引诱**。经常 limp 好牌再 reraise，minraise 坚果牌诱导对手加注。

#### bully (鲁智深)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | overbet_pressure | postflop, chip advantage >1.5x, no bet | raise 1.2x pot | 20% | none |
| 2 | steal_reraise | preflop, BTN/CO, facing 1 raise, chip adv | raise 3.5x open | 25% | none |
| 3 | river_bully | river, chip advantage >2x, facing check | raise 1.5x pot | 18% | none |

Bully 的签名：**用筹码施压**。只在筹码优势时激活，对短码玩家特别凶。

#### nit (司马懿)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | snap_fold | postflop, facing bet > 0.8x pot | fold | +15% extra | [0, 0.55] |
| 2 | micro_cbet | flop, was preflop raiser, no bet | raise 0.25x pot | 60% | [0.35, 1.0] |

Nit 的签名：**极度保守**。面对大注几乎必弃，持续下注永远用最小尺度。

#### station (猪八戒)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | hero_call | river, facing bet | call | 30% | none (unconditional) |
| 2 | call_down | turn/river, facing raise | call | 20% | none |

Station 的签名：**不可能被 bluff 走**。30% 的时候河牌无条件跟注，让对手的 bluff 永远不安全。

#### tilter (林冲)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | revenge_raise | postflop, tilt>0.3, recent loss to same opponent | raise 1.0x pot | 25% | none |
| 2 | tilt_shove | any street, tilt>0.7 | allin | 10% | none |

Tilter 的签名：**情绪化报复**。输给谁就盯着谁打，重度 tilt 时直接全下。

#### lag (孙悟空)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | float_then_stab | flop I called, turn facing check | raise 0.67x pot | 25% | none |
| 2 | squeeze | preflop, facing raise + ≥1 caller | raise 4x open | 30% | [0.30, 1.0] |
| 3 | probe_bet | turn/river, facing check, IP | raise 0.50x pot | 20% | none |

LAG 的签名：**位置利用**。Float flop → stab turn 是经典 LAG 招数。

#### shortstack (燕青)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | stop_and_go | preflop called, flop any, ≤12BB | allin | 20% | [0.25, 1.0] |
| 2 | resteal_shove | preflop, BTN/CO/SB, facing 1 raise, ≤15BB | allin | 25% | [0.35, 1.0] |

Shortstack 的签名：**Push/fold 变体**。Stop-and-go 是短码经典——翻前跟注翻牌直接全下。

#### adaptive (曹操)

| # | Name | Trigger | Action | Freq | Strength Gate |
|---|------|---------|--------|------|---------------|
| 1 | mirror_style | any, opponent model available | 模仿对手倾向 | 15% | none |

Adaptive 的签名：**变色龙**。检测到对手是 nit 就 bluff 更多，检测到是 maniac 就 trap 更多。实现方式：读取 `OpponentProfile`，根据对手 VPIP/AF 动态选择一个临时 playbook pattern（从其他风格借用）。

#### tag (赵云), gto (诸葛亮)

TAG 和 GTO 没有签名招数——这本身就是他们的特点：稳健、均衡、不给马脚。

### Matching Engine

```typescript
function matchPlaybook(
  style: SystemBotStyle,
  context: PlaybookContext,  // street, position, board, pot, stack, opponents, priorActions, etc.
): { pattern: PlayPattern; action: PatternAction } | null
```

逻辑：
1. 遍历 `PLAYBOOKS[style]`，按数组顺序（优先级）
2. 检查所有 trigger 条件
3. 检查 `strengthGate`（如果有的话）
4. 掷骰子 `Math.random() < frequency`
5. 第一个匹配的 pattern 胜出，返回动作
6. 全部不匹配 → 返回 null，继续走后续路径

### Debug Output

命中 playbook 时，debug.reasoning 中标注签名招数名：
```
张飞: [random_shove] 签名招式! 翻牌直接全下.
王熙凤: [limp_reraise] 先 limp 再 4x reraise. 请君入瓮.
```

这让玩家在 BotDebugPanel 中能看到 bot 在执行什么招数。

---

## Module 2: Personalized Bet Sizing

**Modified file:** `src/server/poker/strategy/bet-sizing.ts`

### SizingProfile

替换现有的标量 `styleModifiers`:

```typescript
interface SizingProfile {
  cbet:         { preferred: number; variance: number };
  valueBet:     { preferred: number; variance: number };
  bluff:        { preferred: number; variance: number };
  raiseVsBet:   { multiplier: number; variance: number };  // x倍对手下注
  riverBet:     { preferred: number; variance: number };
}
```

`preferred` 是 pot fraction (e.g. 0.33 = 1/3 pot), `variance` 是随机抖动范围 (e.g. 0.10 = ±10%)。

### Per-Style Profiles

```typescript
const SIZING_PROFILES: Record<SystemBotStyle, SizingProfile> = {
  nit:        { cbet: {preferred:0.33, variance:0.05}, valueBet: {preferred:0.50, variance:0.08}, bluff: {preferred:0.33, variance:0.05}, raiseVsBet: {multiplier:2.5, variance:0.2}, riverBet: {preferred:0.40, variance:0.08} },
  tag:        { cbet: {preferred:0.55, variance:0.08}, valueBet: {preferred:0.67, variance:0.10}, bluff: {preferred:0.55, variance:0.08}, raiseVsBet: {multiplier:2.8, variance:0.3}, riverBet: {preferred:0.67, variance:0.10} },
  lag:        { cbet: {preferred:0.67, variance:0.10}, valueBet: {preferred:0.80, variance:0.12}, bluff: {preferred:1.00, variance:0.15}, raiseVsBet: {multiplier:3.0, variance:0.3}, riverBet: {preferred:0.80, variance:0.12} },
  station:    { cbet: {preferred:0.50, variance:0.05}, valueBet: {preferred:0.50, variance:0.05}, bluff: {preferred:0.50, variance:0.05}, raiseVsBet: {multiplier:2.5, variance:0.2}, riverBet: {preferred:0.50, variance:0.05} },
  maniac:     { cbet: {preferred:0.80, variance:0.15}, valueBet: {preferred:1.20, variance:0.20}, bluff: {preferred:1.50, variance:0.25}, raiseVsBet: {multiplier:3.5, variance:0.5}, riverBet: {preferred:1.50, variance:0.20} },
  trapper:    { cbet: {preferred:0.25, variance:0.05}, valueBet: {preferred:0.33, variance:0.08}, bluff: {preferred:0.50, variance:0.10}, raiseVsBet: {multiplier:2.2, variance:0.2}, riverBet: {preferred:0.33, variance:0.08} },
  bully:      { cbet: {preferred:0.75, variance:0.12}, valueBet: {preferred:1.00, variance:0.15}, bluff: {preferred:1.20, variance:0.18}, raiseVsBet: {multiplier:3.0, variance:0.4}, riverBet: {preferred:1.00, variance:0.15} },
  tilter:     { cbet: {preferred:0.55, variance:0.10}, valueBet: {preferred:0.67, variance:0.12}, bluff: {preferred:0.67, variance:0.15}, raiseVsBet: {multiplier:2.8, variance:0.4}, riverBet: {preferred:0.67, variance:0.12} },
  shortstack: { cbet: {preferred:0.50, variance:0.08}, valueBet: {preferred:0.60, variance:0.10}, bluff: {preferred:0.50, variance:0.10}, raiseVsBet: {multiplier:2.5, variance:0.3}, riverBet: {preferred:0.60, variance:0.10} },
  adaptive:   { cbet: {preferred:0.55, variance:0.10}, valueBet: {preferred:0.67, variance:0.10}, bluff: {preferred:0.67, variance:0.10}, raiseVsBet: {multiplier:2.8, variance:0.3}, riverBet: {preferred:0.67, variance:0.10} },
  gto:        { cbet: {preferred:0.00, variance:0.00}, valueBet: {preferred:0.00, variance:0.00}, bluff: {preferred:0.00, variance:0.00}, raiseVsBet: {multiplier:0.0, variance:0.0}, riverBet: {preferred:0.00, variance:0.00} },
  // gto: preferred=0 signals "use geometric bet fraction" (current behavior)
};
```

### chooseBetSize() Changes

```typescript
function chooseBetSize(pot, stack, streetsRemaining, texture, strength, style, isBluff, legal): { amount, action } {
  const profile = SIZING_PROFILES[style];

  // GTO: keep current geometric behavior
  if (profile.cbet.preferred === 0) {
    return currentGeometricLogic(...);
  }

  // Select scenario
  const scenario = isBluff ? profile.bluff
    : (streetsRemaining >= 3 && isCbetSpot) ? profile.cbet
    : (street === 'river') ? profile.riverBet
    : profile.valueBet;

  // Apply variance
  const jitter = (Math.random() * 2 - 1) * scenario.variance;
  const fraction = Math.max(0.20, scenario.preferred + jitter);

  // Texture still adjusts (monotone board → bigger, paired → smaller)
  const textureAdj = computeTextureAdjustment(texture);
  const finalFraction = fraction * textureAdj;

  const rawAmount = Math.round(pot * finalFraction);
  // ... legal clamping (unchanged) ...
}
```

### Solver Path Sizing (style-deviations.ts)

新增 `applyStyleSizing()` 函数，在 `applyPostflopStyleDeviation()` 之后调用：

```typescript
// Solver bet-size preference weights per style
const SIZE_PREFERENCE: Record<SystemBotStyle, Record<string, number>> = {
  nit:    { bet_33: 2.0, bet_67: 1.0, bet_100: 0.3, bet_150: 0.1, allin: 0.1 },
  maniac: { bet_33: 0.3, bet_67: 0.8, bet_100: 1.5, bet_150: 2.5, allin: 1.5 },
  bully:  { bet_33: 0.5, bet_67: 1.0, bet_100: 1.5, bet_150: 2.0, allin: 1.0 },
  trapper:{ bet_33: 2.5, bet_67: 1.0, bet_100: 0.3, bet_150: 0.1, allin: 0.1 },
  lag:    { bet_33: 0.6, bet_67: 1.2, bet_100: 1.5, bet_150: 1.2, allin: 0.8 },
  // ... etc
};

function applyStyleSizing(strategy: ActionProbabilities, style: SystemBotStyle): ActionProbabilities {
  const prefs = SIZE_PREFERENCE[style];
  if (!prefs) return strategy;

  const result = { ...strategy };
  for (const [action, prob] of Object.entries(result)) {
    if (prefs[action] !== undefined) {
      result[action] = prob * prefs[action];
    }
  }
  // Re-normalize
  normalize(result);
  return result;
}
```

---

## Module 3: Unconditional Bluff Engine

**New file:** `src/server/poker/strategy/unconditional-bluff.ts`

### Config

```typescript
interface UnconditionalBluffConfig {
  // Position-based bluff rates (pot fraction of hands where we bluff regardless of cards)
  positionRate: Record<Position, number>;
  // Board texture modifier
  dryBoardBonus: number;        // added to rate on dry boards (wetness < 0.25)
  wetBoardPenalty: number;       // subtracted on wet boards (wetness > 0.55)
  // Multi-barrel continuation rates
  secondBarrelRate: number;      // P(continue bluffing on turn | bluffed flop)
  thirdBarrelRate: number;       // P(continue on river | bluffed turn)
  // Sizing for unconditional bluffs
  sizing: SizingSpec;
}

const UNCONDITIONAL_BLUFF: Record<SystemBotStyle, UnconditionalBluffConfig | null> = {
  maniac: {
    positionRate: { UTG: 0.12, MP: 0.15, CO: 0.20, BTN: 0.25, SB: 0.18, BB: 0.10 },
    dryBoardBonus: 0.10,
    wetBoardPenalty: 0.08,
    secondBarrelRate: 0.65,
    thirdBarrelRate: 0.40,
    sizing: { mode: 'pot_fraction', fraction: 0.80 },
  },
  lag: {
    positionRate: { UTG: 0.05, MP: 0.08, CO: 0.12, BTN: 0.18, SB: 0.10, BB: 0.05 },
    dryBoardBonus: 0.08,
    wetBoardPenalty: 0.06,
    secondBarrelRate: 0.45,
    thirdBarrelRate: 0.20,
    sizing: { mode: 'pot_fraction', fraction: 0.67 },
  },
  bully: {
    positionRate: { UTG: 0.08, MP: 0.10, CO: 0.15, BTN: 0.20, SB: 0.12, BB: 0.06 },
    dryBoardBonus: 0.05,
    wetBoardPenalty: 0.05,
    secondBarrelRate: 0.50,
    thirdBarrelRate: 0.25,
    sizing: { mode: 'pot_fraction', fraction: 1.00 },
  },
  tag: {
    positionRate: { UTG: 0, MP: 0.02, CO: 0.05, BTN: 0.08, SB: 0.03, BB: 0 },
    dryBoardBonus: 0.03,
    wetBoardPenalty: 0.04,
    secondBarrelRate: 0.25,
    thirdBarrelRate: 0.10,
    sizing: { mode: 'pot_fraction', fraction: 0.55 },
  },
  nit: {
    positionRate: { UTG: 0, MP: 0, CO: 0, BTN: 0.02, SB: 0, BB: 0 },
    dryBoardBonus: 0,
    wetBoardPenalty: 0,
    secondBarrelRate: 0.05,
    thirdBarrelRate: 0,
    sizing: { mode: 'pot_fraction', fraction: 0.33 },
  },
  trapper: {
    positionRate: { UTG: 0, MP: 0.02, CO: 0.03, BTN: 0.05, SB: 0.02, BB: 0 },
    dryBoardBonus: 0.05,
    wetBoardPenalty: 0.03,
    secondBarrelRate: 0.15,
    thirdBarrelRate: 0.08,
    sizing: { mode: 'pot_fraction', fraction: 0.50 },
  },
  station:    null,  // station never bluffs
  tilter:     null,  // tilter bluffs via playbook (revenge_raise), not position-based
  shortstack: null,  // shortstack uses push/fold, not positional bluff
  adaptive:   null,  // adaptive mirrors opponent, not positional
  gto:        null,  // gto uses balanced bluff ratios from solver
};
```

### Check Function

```typescript
function checkUnconditionalBluff(
  style: SystemBotStyle,
  position: Position,
  street: Street,
  board: string[],
  texture: BoardTexture | null,
  facingBet: boolean,
  currentBluffLine: boolean,  // are we continuing a bluff from prior street?
  pot: number,
  stack: number,
  minRaise: number,
  currentBet: number,
): { action: PokerAction; isBluffLine: boolean } | null
```

逻辑：
1. 查找 `UNCONDITIONAL_BLUFF[style]`，null → 返回 null
2. 如果面对下注(`facingBet = true`)且不在 bluff line 中 → 返回 null（不无条件跟注）
3. 如果在 bluff line 中（前街已经 bluff 了）：
   - 翻牌→转牌：掷骰 `secondBarrelRate`
   - 转牌→河牌：掷骰 `thirdBarrelRate`
   - 命中 → 继续 bluff，返回 `{ action: raise(sizing), isBluffLine: true }`
4. 新 bluff 起点（不在 bluff line 中，不面对下注）：
   - 计算 `rate = positionRate[position] + dryBoardBonus/wetBoardPenalty`
   - 掷骰 `Math.random() < rate`
   - 命中 → 返回 `{ action: raise(sizing), isBluffLine: true }`
5. 全不命中 → 返回 null

### Integration Point

在 `agents.ts` `requestAction()` 中，Playbook 检查之后、Solver 之前：

```typescript
// [2] Unconditional bluff engine
if (req.street !== 'preflop') {
  const bluffResult = checkUnconditionalBluff(
    effectiveStyle, this.myPosition, req.street, req.board, texture,
    req.toCall > 0, this.currentBluffLine,
    req.pot, req.stack, req.minRaise, req.currentBet,
  );
  if (bluffResult) {
    this.currentBluffLine = bluffResult.isBluffLine;
    return Promise.resolve({
      ...bluffResult.action,
      debug: {
        equity: strength,
        reasoning: `${this.definition.name}: [unconditional_bluff] ${this.currentBluffLine ? '连续施压' : '位置 bluff'} @ ${this.myPosition}.`,
      },
    });
  }
}
```

---

## File Change Summary

| Operation | File | Description |
|-----------|------|-------------|
| **New** | `src/server/poker/strategy/playbook.ts` | PlayPattern 类型定义 + 11 风格签名招数数据 + `matchPlaybook()` 匹配引擎 |
| **New** | `src/server/poker/strategy/unconditional-bluff.ts` | 无条件 bluff 配置 + `checkUnconditionalBluff()` 引擎 |
| **Modify** | `src/server/poker/strategy/bet-sizing.ts` | `styleModifiers` 标量 → `SIZING_PROFILES` 表 + `chooseBetSize()` 改用场景化尺度 |
| **Modify** | `src/server/poker/solver/style-deviations.ts` | 新增 `SIZE_PREFERENCE` 表 + `applyStyleSizing()` 函数 |
| **Modify** | `src/server/poker/agents.ts` | `requestAction()` 入口集成 playbook + bluff 引擎；新增 `currentBluffLine` / `myActionsThisHand` 状态 |

## Not In Scope

- **state-machine.ts** — 纯净状态机不变
- **pot.ts** — 底池计算不变
- **PBP protocol** — 外部 bot 协议不变
- **多街完整规划系统** — 用 `priorActions` 条件匹配代替，够用且简单
- **行动时间差异** — 留给下一期
- **UI changes** — BotDebugPanel 已支持 reasoning 字段，无需改动

## Testing Strategy

1. **Unit tests for playbook matching** — 每个风格的每个 pattern 验证 trigger 条件正确触发/不触发
2. **Unit tests for sizing profiles** — 验证各风格尺度在预期范围内
3. **Unit tests for unconditional bluff** — 验证 bluff line 状态正确传递，multi-barrel 衰减
4. **Integration smoke test** — 运行 100 手模拟，统计各风格的 action 分布，确认差异化可见
5. **Regression** — 现有 pot.ts 测试全部通过（不动 pot 逻辑）

## Rollout

1. 先实现 Module 2 (bet sizing) — 最小侵入，单文件改造
2. 再实现 Module 1 (playbook) — 新增文件 + agents.ts 入口
3. 最后实现 Module 3 (unconditional bluff) — 新增文件 + agents.ts 入口 + 状态跟踪
4. 每个模块独立可测试、独立可回滚
