# Bot Performance Overhaul Plan — v3.1 (Final)

> v3：整合 500 手数据 + 交叉验证 3 个 FAIL 修正 + 6 个 WARN 处理。
> v2：整合 200 手数据 + 代码审核 5 个阻塞项。Nit 降级观察。
> v1：初版方案。

## Background

Profiler 实测 100/200/500 手 + CFR 表分析 + 两轮代码审核。核心矛盾：**bot 角色设定与实际行为脱节，GTO 是跟注站，Tilter 永久失控，部分桌面过于被动**。

## 500 手稳态数据（最终参考基准）

### Table-A (nit, tag, lag, station, maniac, trapper)
| Bot | VPIP | PFR | PFR/VPIP | AF | WTSD | FoldAll | 目标 VPIP | 状态 |
|-----|------|-----|----------|-----|------|---------|-----------|------|
| 司马懿 nit | 15.8% | 6.2% | 39% | 1.96 | 96% | 71% | 14-18% | ✅ VPIP ok, PFR 偏低 |
| 赵云 tag | 40.2% | 20.8% | 52% | 2.69 | 96% | 44% | 22-28% | ⚠️ 偏松 |
| 孙悟空 lag | 72.4% | 48.6% | 67% | 2.70 | 94% | 22% | 35-50% | ✅ |
| 猪八戒 station | 87.4% | 7.2% | 8% | 0.35 | 97% | 17% | 55-75% | ✅ 教科书级 |
| 张飞 maniac | 83.4% | 59.4% | 71% | 3.60 | 97% | 15% | 60-85% | ✅ |
| 王熙凤 trapper | 44.8% | 6.2% | 14% | 1.11 | 95% | 43% | 22-32% | ⚠️ AF 未达标 |

### Table-B (bully, tilter, shortstack, adaptive, gto, tag)
| Bot | VPIP | PFR | PFR/VPIP | AF | WTSD | FoldAll | 目标 VPIP | 状态 |
|-----|------|-----|----------|-----|------|---------|-----------|------|
| 鲁智深 bully | 64.2% | 40.0% | 62% | 2.90 | 86% | 26% | 35-55% | ✅ |
| 林冲 tilter | 75.6% | 50.4% | 67% | 6.41 | 88% | 20% | calm 22-30% | ❌ 死亡螺旋 |
| 燕青 shortstack | 31.0% | 24.2% | 78% | 4.16 | 93% | 58% | 25-35% | ⚠️ |
| 曹操 adaptive | 51.6% | 18.6% | 36% | 2.07 | 90% | 35% | 28-42% | ⚠️ PFR 偏低 |
| 诸葛亮 gto | 34.0% | 10.8% | 32% | 1.54 | 94% | 53% | 22-28% | ❌ 跟注站 |
| 赵云 tag | 36.6% | 20.4% | 56% | 2.41 | 88% | 49% | 22-28% | ⚠️ 偏松 |

---

## P0: 诸葛亮 GTO — 从跟注站鱼变成均衡大师

### 问题
500 手稳态：VPIP 34% / PFR 10.8% / PFR÷VPIP = 32%。VPIP 随手数增加反而升高（limp 越积越多）。

### 根因
CFR 表 limp 偏差 + GTO style deviation 为零 + 3-bet 频率接近零。

### 修复方案

**Step 1 — 修改 GTO STYLE_DEVIATIONS**

文件: `src/server/poker/strategy/preflop-cfr.ts` 第 70 行
```typescript
// 旧
gto: { rangeScale: 1.0, foldShift: 0, raiseShift: 0, callShift: 0 },
// 新
gto: { rangeScale: 1.0, foldShift: 0, raiseShift: +0.12, callShift: -0.12 },
```

**Step 2 — 白名单 limp→raise 转换（限定 scope）**

文件: `src/server/poker/strategy/preflop-cfr.ts`，在第 352 行 `applyDefenseBias()` 之后、第 354 行 `selectAction()` 之前插入：

```typescript
// ── Limp→raise correction for raise-first-in styles ──
// CFR tables include limps in the GTO equilibrium. For styles that should
// play raise-or-fold preflop, convert limp frequency to raise/fold.
// White-list ensures station/maniac/trapper limp behavior is preserved.
const LIMP_CORRECTION_STYLES: Set<SystemBotStyle> = new Set(['gto', 'tag', 'nit', 'shortstack']);
if (actionSeq === 'unopened' && position !== 'BB' && LIMP_CORRECTION_STYLES.has(style)) {
  const limpToRaise = position === 'SB' ? 0.40 : 0.70;
  const callFreq = styled.call;
  if (callFreq > 0.01) {  // guard against floating point dust
    styled.raise += callFreq * limpToRaise;
    styled.fold += callFreq * (1 - limpToRaise);
    styled.call = 0;
    const total = styled.fold + styled.call + styled.raise;
    if (total > 0) { styled.fold /= total; styled.call /= total; styled.raise /= total; }
  }
}
```

注意：`styled` 是 `let`（第 351 行），可直接修改字段。插入点在 `applyDefenseBias` 之后确保 defense 调整不被覆盖。白名单排除 station/maniac/trapper/bully/tilter/adaptive/lag。

### 预期效果
- VPIP: 34% → 22-26%（limp 消除后 VPIP 降低）
- PFR: 10.8% → 18-22%
- PFR/VPIP: 32% → 78-85%
- 级联效应：nit PFR 从 6.2% 上升（limp 白名单包含 nit）

### 修改文件
- `src/server/poker/strategy/preflop-cfr.ts`

---

## P1-A: 林冲 Tilter — 修复死亡螺旋

### 问题
500 手稳态：VPIP 75.6% / PFR 50.4% / AF 6.41。三次采样完全一致，确认永久 tilt。

### 修复方案

> v3 修正：(1) 伪代码顺序：先混合→衰减→大胜重置（v2 已修正）。
> (2) `myWin.amount` 是底池总量含自己投入，阈值从 5BB 提高到 15BB（v3 新增修正）。

文件: `src/server/poker/agents.ts`

#### 改动 1：hand_over tilt 计算（第 774-784 行区域）

替换当前的 tilt 计算块：

```typescript
case 'hand_over': {
  this.holeCards = null;
  const myWin = msg.winners.find((w: { seat: number }) => w.seat === this.mySeat);
  if (myWin) {
    this.recentResults.push(myWin.amount);
  } else {
    this.recentResults.push(-1);
  }
  // 统一窗口为 15（旧代码存 8 用 5，不一致 bug）
  if (this.recentResults.length > 15) this.recentResults.shift();

  // Step 1: rawTilt 基于最近 12 手
  const window = this.recentResults.slice(-12);
  const recentLosses = window.filter(r => r < 0).length;
  const rawTilt = clamp01(recentLosses / 12);

  // Step 2: 混合新旧值（EMA 式平滑）
  let newTilt = this.tiltLevel * 0.7 + rawTilt * 0.3;

  // Step 3: 自然冷却（每手 -0.03）
  newTilt = Math.max(0, newTilt - 0.03);

  // Step 4: 大胜重置（净赢 > 10BB 时降温。amount = newStack - oldStack，是净赢金额）
  if (myWin && myWin.amount > this.bigBlind * 10) {
    newTilt = Math.max(0, newTilt - 0.25);
  }

  // Step 5: 上限 0.75
  this.tiltLevel = clamp01(Math.min(newTilt, 0.75));
  break;
}
```

#### 改动 2：tilt boost 系数（第 840-843 行）

```typescript
// 旧: t * 0.40 / t * 0.30 / t * 0.15 / t * 0.25
// 新: 降低系数让 tilted 林冲 ≠ 张飞
cfg.aggression = clamp01(cfg.aggression + t * 0.28);
cfg.looseness  = clamp01(cfg.looseness  + t * 0.22);
cfg.bluffRate  = clamp01(cfg.bluffRate  + t * 0.10);
cfg.raiseBias  = clamp01(cfg.raiseBias  + t * 0.18);
```

#### 改动 3：tilt→style 切换阈值（第 1007-1008 行）

```typescript
// 旧: > 0.3 → lag, > 0.7 → maniac
// 新: 提高阈值，拉长 calm 区间
if (style === 'tilter' && this.tiltLevel > 0.4) {
  effectiveStyle = this.tiltLevel > 0.65 ? 'maniac' : 'lag';
```

注意：boost 触发阈值 `> 0.2`（第 838 行）保持不变。0.2-0.4 区间有 boost 但不切换 style，这是有意设计——轻微情绪波动体现为参数微调而非风格突变。

### 预期效果
- 300 手中 ≥40% 在 calm（tiltLevel < 0.2）
- 用户能看到完整弧线：沉稳 → 渐失冷静 → 怒火 → 大胜回血 → 恢复

### 修改文件
- `src/server/poker/agents.ts`

---

## P2-A: 王熙凤 Trapper — 让埋伏真正致命

### 问题
500 手稳态：AF 1.11，目标 1.5-3.0。改善中但未达标。

### 根因（审核确认）
真正阻塞点在 `agents.ts` 第 1538 行 `valueBetFloor` 公式和第 1589 行 `strength >= Math.max(valueBetFloor, sizedCallThreshold)` 判断。

> v3 修正：valueBetFloor 实际约 0.41（非 v1 估算的 0.55-0.60）。

### 修复方案

#### 层面 1：Playbook strengthGate（`playbook.ts`）

```
min_raise_trap:          [0.62, 1.0] → [0.48, 1.0]
check_call_then_raise:   [0.50, 1.0] → [0.38, 1.0]  ← v2 写成空操作，v3 修正
```

#### 层面 2：Heuristic check-raise floor（`agents.ts` 第 1585-1589 行）

```typescript
// 现有代码
if (strength >= Math.max(valueBetFloor, sizedCallThreshold) && roll(valueCheckRaiseFreq)) {

// 修改为
const crFloor = style === 'trapper'
  ? Math.max(0.32, Math.min(valueBetFloor, sizedCallThreshold + 0.05))  // 下限 0.32 防弱牌 CR
  : Math.max(valueBetFloor, sizedCallThreshold);

// 同步调整 freq 基准（v3 新增，解决审核 WARN）
const crStrengthRef = style === 'trapper' ? crFloor : valueBetFloor;
const valueCheckRaiseFreq = clamp01(
  cfg.checkRaiseRate * (0.25 + Math.max(0, strength - crStrengthRef + 0.10) * 1.20),
);
if (strength >= crFloor && roll(valueCheckRaiseFreq)) {
```

#### 层面 3：STYLE_CONFIG 微调

```typescript
// trapper
aggression: 0.38 → 0.42    // 降低 valueBetFloor
raiseBias:  0.12 → 0.18    // 提高 raise 倾向
```

#### 层面 4："Spring the trap"（`agents.ts` 第 1217 行后，pattern penalty 块结束处）

```typescript
if (style === 'trapper' && this.myActionsThisHand.some(
  a => a.street !== req.street && a.action === 'check'
)) {
  cfg.raiseBias = clamp01(cfg.raiseBias + 0.15);
  cfg.checkRaiseRate = clamp01(cfg.checkRaiseRate + 0.10);
}
```

### 预期效果
- AF: 1.11 → 1.8-2.5
- WTSD: 95% → 78-88%

### 修改文件
- `src/server/poker/strategy/playbook.ts` — strengthGate
- `src/server/poker/agents.ts` — crFloor + freq 基准 + STYLE_CONFIG + spring-the-trap

---

## P1-B: Table-B 折叠工厂

### 分析
P0 修好 GTO 后，GTO 的 FoldAll 53% 会下降。先修 P0 再观察。

### 保底方案
如果 Phase 1 后 Table-B avg FoldAll 仍 > 45%：

文件: `src/lib/stake-levels.ts`
```typescript
high:  增加 'house-bully'
elite: 增加 'house-bully'
```

---

## P3-A: 燕青 Shortstack — 提高 push/fold 阈值

### 问题
500 手 VPIP 31%/PFR 24.2%/FoldAll 58%。push/fold 特色不鲜明。

> v3 修正 #1：agents.ts 无 `bbCount <= 18` 外层 gate，实际只有 `shouldPushFold()` 一处控制。
> v3 修正 #2：`preferredBuyinBB` 在所有级别都被 clamp 到 minBuyin（50BB），改了也无效。

**关键发现**：所有级别的 `minBuyin / bigBlind = 50`，`resolveSystemBotBuyin()` 会 `Math.max(minBuyin, ...)` 把任何低于 50BB 的目标 clamp 到 50BB。改 preferredBuyinBB 毫无作用。

### 修复方案（修订后，仅两处改动）

**改动 1**：`src/server/poker/strategy/stack-depth.ts` 第 80 行

```typescript
// 旧
export function shouldPushFold(stackBB: number): boolean {
  return stackBB <= 14;
}
// 新
export function shouldPushFold(stackBB: number): boolean {
  return stackBB <= 25;
}
```

**改动 2**：`src/server/poker/__tests__/stack-depth.test.ts` 第 144/148 行

同步更新测试断言，将边界值从 14/15 改为 25/26。

**不改** `preferredBuyinBB`（改了无效），**不改** agents.ts（无外层 gate）。

### 预期效果
- 买入 50BB → 输到 25BB 后立即进入 push/fold 模式（当前要输到 14BB）
- 更早体现"以小博大"特色
- PFR/VPIP 在 push/fold 区间接近 90%+

### 修改文件
- `src/server/poker/strategy/stack-depth.ts`
- `src/server/poker/__tests__/stack-depth.test.ts`

---

## 实施顺序

```
Phase 1 — P0 + P1-A:
  src/server/poker/strategy/preflop-cfr.ts
    - GTO STYLE_DEVIATIONS: raiseShift +0.12, callShift -0.12
    - 白名单 limp→raise（gto/tag/nit/shortstack，在 applyDefenseBias 之后插入）
  src/server/poker/agents.ts
    - tilter tilt: 15手存储/12手窗口/先混合→衰减→大胜重置(15BB)/cap 0.75
    - tilter boost: 系数调低
    - tilter style切换: 0.3→0.4, 0.7→0.65
  验证:
    PROFILE_HANDS=500 PROFILE_MODE=persistent
    ✓ GTO PFR ≥ 18%, PFR/VPIP ≥ 75%
    ✓ Tilter 500 手中 ≥40% calm (tiltLevel < 0.2)
    ✓ Station VPIP 仍 > 80%（limp 修正未影响）
    ✓ Nit PFR 上升但 VPIP 仍 < 20%

Phase 2 — P2-A:
  src/server/poker/strategy/playbook.ts
    - min_raise_trap: [0.62,1.0]→[0.48,1.0]
    - check_call_then_raise: [0.50,1.0]→[0.38,1.0]
  src/server/poker/agents.ts
    - chooseBuiltinAction: trapper crFloor + freq 基准同步调整
    - STYLE_CONFIG trapper: aggression 0.38→0.42, raiseBias 0.12→0.18
    - spring-the-trap 逻辑
  验证:
    ✓ Trapper AF > 1.5
    ✓ Trapper WTSD < 90%

Phase 3 — P3-A + P1-B:
  src/server/poker/strategy/stack-depth.ts — shouldPushFold 14→25
  src/server/poker/__tests__/stack-depth.test.ts — 同步更新测试
  src/lib/stake-levels.ts — bot pool（视 Phase 1 结果）
  验证:
    全量 PROFILE_HANDS=500 回归
    ✓ Shortstack PFR/VPIP > 85%（push/fold 区间）
    ✓ 无桌子 avg FoldAll > 45%
```

## 风险提示

1. **白名单 nit/shortstack PFR 上升**：limp 修正后 nit PFR 会从 6.2% 上升，需确认不超过 15%。Phase 1 profiler 验证覆盖。
2. **tiltLevel 无单测**：建议 Phase 1 后补 tilter 弧线测试（calm→tilt→recovery 至少 3 个断言）。
3. **applyDefenseBias 交互**：GTO defense profile 的 `foldToCall: 0.11` 会和 `callShift: -0.12` 对冲，facing_raise 场景的 PFR 提升可能小于 unopened 场景。profiler 会捕获。
4. **trapper crFloor 和 freq 脱节**（v3 已修正）：freq 计算中的基准值已同步调整为 `crStrengthRef`。
