# Mobile Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the mobile poker table to use a hero-bottom-fixed layout with upper-arc opponents, compress the action bar, and polish other pages for mobile.

**Architecture:** Hero seat is extracted from the elliptical layout and rendered as a fixed bar at the bottom of the felt area. Opponents distribute on the upper arc only via a new `getMobileSeatPosition()` function. All changes are gated behind the existing `compact` / `isMobile` props — desktop layout is untouched.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, Framer Motion, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-01-mobile-optimization-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/components/table/TableFelt.tsx` | Modify — new `getMobileSeatPosition()`, skip hero in compact loop, render hero bet above hero bar |
| `src/components/table/SeatView.tsx` | Modify — redesign compact layout: name+stack row, bigger fonts, width from `totalSeats` |
| `src/components/table/HeroSeat.tsx` | Create — dedicated hero bar component for mobile bottom position |
| `src/app/table/[id]/page.tsx` | Modify — restructure mobile layout: felt → hero seat → action bar |
| `src/components/ActionControls.tsx` | Modify — inline slider+amount, smaller quick-bet pills |
| `src/components/table/ActionBar.tsx` | Modify — reduce expanded height 176→136px |
| `src/components/table/BoardCards.tsx` | Modify — `sm` size when compact |
| `src/components/table/EmptySeat.tsx` | Modify — larger touch target on mobile |
| `src/app/records/page.tsx` | Modify — two-line mobile hand list rows, larger pagination |
| `src/app/tournaments/page.tsx` | Modify — styled select, inputMode, padding |
| `src/app/page.tsx` | Modify — standardize padding |
| `src/server/poker/__tests__/mobile-seat-position.test.ts` | Create — unit tests for `getMobileSeatPosition()` |

---

### Task 1: Add `getMobileSeatPosition()` with tests

**Files:**
- Modify: `src/components/table/TableFelt.tsx` (add exported function)
- Create: `src/server/poker/__tests__/mobile-seat-position.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// src/server/poker/__tests__/mobile-seat-position.test.ts
import { describe, it, expect } from 'vitest';
import { getMobileSeatPosition } from '@/components/table/TableFelt';

describe('getMobileSeatPosition', () => {
  it('distributes 5 opponents across upper arc for 6-max', () => {
    const positions = Array.from({ length: 5 }, (_, i) => getMobileSeatPosition(i, 5));
    // All should be in upper half (y < 50)
    for (const pos of positions) {
      expect(pos.y).toBeLessThan(50);
    }
    // First opponent should be on the left (x < 50)
    expect(positions[0].x).toBeLessThan(50);
    // Last opponent should be on the right (x > 50)
    expect(positions[4].x).toBeGreaterThan(50);
    // Middle opponent should be near center-x and near top
    expect(positions[2].x).toBeCloseTo(50, 0);
    expect(positions[2].y).toBeLessThan(20);
  });

  it('distributes 8 opponents across upper arc for 9-max', () => {
    const positions = Array.from({ length: 8 }, (_, i) => getMobileSeatPosition(i, 8));
    for (const pos of positions) {
      expect(pos.y).toBeLessThan(50);
    }
    expect(positions[0].x).toBeLessThan(50);
    expect(positions[7].x).toBeGreaterThan(50);
  });

  it('handles single opponent', () => {
    const pos = getMobileSeatPosition(0, 1);
    // Should be at the top center
    expect(pos.x).toBeCloseTo(50, 0);
    expect(pos.y).toBeLessThan(20);
  });

  it('no positions overlap for 9-max', () => {
    const positions = Array.from({ length: 8 }, (_, i) => getMobileSeatPosition(i, 8));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThan(5); // at least 5% apart
      }
    }
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx vitest run src/server/poker/__tests__/mobile-seat-position.test.ts`
Expected: FAIL — `getMobileSeatPosition` is not exported from TableFelt.

- [ ] **Step 3: Implement `getMobileSeatPosition` in TableFelt.tsx**

Add this function right below the existing `getSeatPosition()`:

```ts
/**
 * Mobile layout: distribute opponents across the upper arc only.
 * opponentIndex: 0-based index among non-hero players (left-to-right).
 * totalOpponents: number of opponents (totalSeats - 1).
 * Returns { x, y } as percentages of the container.
 */
export function getMobileSeatPosition(
  opponentIndex: number,
  totalOpponents: number,
): { x: number; y: number } {
  // Distribute evenly from π (left) through 3π/2 (top) to 2π (right)
  // Use (i+1)/(N+1) to add padding at both ends
  const angle = Math.PI + ((opponentIndex + 1) / (totalOpponents + 1)) * Math.PI;
  const rx = 42; // horizontal radius — wider than desktop compact (36)
  const ry = 40; // vertical radius — taller to push seats up
  return {
    x: 50 + rx * Math.cos(angle),
    y: 50 + ry * Math.sin(angle),
  };
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/server/poker/__tests__/mobile-seat-position.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/table/TableFelt.tsx src/server/poker/__tests__/mobile-seat-position.test.ts
git commit -m "feat(mobile): add getMobileSeatPosition() for upper-arc layout"
```

---

### Task 2: Redesign SeatView compact layout

**Files:**
- Modify: `src/components/table/SeatView.tsx`

The mobile SeatView is now always an opponent (hero is extracted to its own component). Redesign compact mode with larger fonts and name+stack on one row.

- [ ] **Step 1: Update SeatView compact rendering**

Replace the entire `SeatView` component. Key changes to compact mode only (desktop unchanged):
- Add `totalSeats?: number` prop
- When `compact`:
  - `seatWidth` = `totalSeats && totalSeats > 6 ? 68 : 80` (up from 72)
  - Name font: `totalSeats && totalSeats > 6 ? 'text-[0.55rem]' : 'text-[0.6rem]'` (up from 0.5rem)
  - Stack font: `'text-[0.6rem]'` (up from 0.5rem)
  - Name max-width: `totalSeats && totalSeats > 6 ? 'max-w-[36px]' : 'max-w-[48px]'` (up from 32px)
  - Cards size: `totalSeats && totalSeats > 6 ? 'xs' : 'sm'` (up from sm/xs)
  - Remove `isMe` branch from compact seatWidth (hero is now separate)
  - Keep the action label, position badges, and all-in effects

In `src/components/table/SeatView.tsx`, make these changes:

1. Add `totalSeats` to props interface:
```ts
interface SeatViewProps {
  player: ClientPlayerState;
  holeCards: [Card, Card] | null;
  isActive: boolean;
  isMe: boolean;
  isWinner?: boolean;
  initialStack?: number;
  compact?: boolean;
  totalSeats?: number;  // ← add this
}
```

2. Update the destructuring to include `totalSeats`:
```ts
export default function SeatView({
  player,
  holeCards,
  isActive,
  isMe,
  isWinner,
  initialStack = 1000,
  compact,
  totalSeats,
}: SeatViewProps) {
```

3. Replace the `seatWidth` calculation:
```ts
  const is9Max = totalSeats !== undefined && totalSeats > 6;
  const seatWidth = compact
    ? (is9Max ? 68 : 80)
    : isMe ? 220 : 140;
```

4. Update the compact font/sizing classes. Replace the Name row section:
```tsx
      {/* Name row */}
      <div className="flex justify-between items-center">
        <span
          className={cn(
            'font-semibold overflow-hidden text-ellipsis whitespace-nowrap leading-tight',
            compact ? (is9Max ? 'text-[0.55rem]' : 'text-[0.6rem]') : 'text-xs',
            isMe ? 'text-amber' : 'text-text-primary',
            compact
              ? (is9Max ? 'max-w-[36px]' : 'max-w-[48px]')
              : (isMe ? 'max-w-[120px]' : 'max-w-[70px]'),
          )}
        >
          {player.displayName}
        </span>
        <div className="flex gap-px items-center">
          {player.isButton && (
            <span className={cn(compact ? 'text-[0.4rem]' : 'text-[0.6rem]', 'bg-[rgba(245,158,11,0.25)] text-amber px-0.5 rounded-[2px] font-bold leading-tight')}>
              D
            </span>
          )}
          {player.isSB && !compact && (
            <span className="text-[0.6rem] bg-[rgba(0,180,216,0.2)] text-teal px-0.5 rounded-[2px] font-bold leading-tight">
              S
            </span>
          )}
          {player.isBB && !compact && (
            <span className="text-[0.6rem] bg-[rgba(100,116,139,0.25)] text-text-secondary px-0.5 rounded-[2px] font-bold leading-tight">
              B
            </span>
          )}
        </div>
      </div>
```

5. Update the hole cards section — use appropriate size for compact:
```tsx
      {/* Hole cards */}
      <div className={cn('flex justify-center', compact ? 'gap-px' : 'gap-[3px] my-[0.15rem]')}>
        {holeCards ? (
          <>
            <PlayingCard card={holeCards[0]} size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
            <PlayingCard card={holeCards[1]} size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
          </>
        ) : player.status !== 'folded' && player.status !== 'sitting_out' ? (
          <>
            <PlayingCard faceDown size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
            <PlayingCard faceDown size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
          </>
        ) : null}
      </div>
```

6. Update the stack+action row font size:
```tsx
      {/* Stack + action */}
      <div className="flex justify-between items-center">
        <span className={cn('chip-count mono', compact ? 'text-[0.6rem]' : 'text-[0.85rem]')}>
          {player.stack}
        </span>
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds (no type errors — `totalSeats` is optional, existing callers unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/components/table/SeatView.tsx
git commit -m "feat(mobile): redesign SeatView compact with larger fonts and totalSeats sizing"
```

---

### Task 3: Create HeroSeat component

**Files:**
- Create: `src/components/table/HeroSeat.tsx`

A dedicated mobile hero bar — full-width horizontal layout with name+stack left, hole cards right.

- [ ] **Step 1: Create HeroSeat.tsx**

```tsx
// src/components/table/HeroSeat.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import PlayingCard from '@/components/PlayingCard';
import type { ClientPlayerState, Card } from '@/lib/types';
import { ACTION_LABELS } from '@/components/table/constants';
import { cn } from '@/lib/utils';

interface HeroSeatProps {
  player: ClientPlayerState;
  holeCards: [Card, Card] | null;
  isActive: boolean;
  isWinner?: boolean;
  initialStack?: number;
}

export default function HeroSeat({
  player,
  holeCards,
  isActive,
  isWinner,
  initialStack = 1000,
}: HeroSeatProps) {
  const actionColors: Record<string, string> = {
    fold: 'var(--fold)',
    check: '#10b981',
    call: 'var(--teal)',
    raise: 'var(--amber)',
    allin: '#f87171',
  };

  const isAllIn = player.lastAction === 'allin';
  const isFolded = player.status === 'folded' || player.status === 'sitting_out';

  const prevAllInRef = useRef(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (isAllIn && !prevAllInRef.current) {
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 400);
      prevAllInRef.current = true;
      return () => clearTimeout(t);
    }
    if (!isAllIn) {
      prevAllInRef.current = false;
    }
  }, [isAllIn]);

  const stackRatio = Math.min(1, Math.max(0, player.stack / initialStack));
  const healthColor =
    stackRatio > 0.5
      ? 'var(--teal)'
      : stackRatio > 0.25
      ? 'var(--amber)'
      : 'var(--loss)';

  return (
    <motion.div
      animate={{
        ...(isAllIn
          ? {
              boxShadow: [
                '0 0 6px rgba(245,158,11,0.3)',
                '0 0 14px rgba(245,158,11,0.5)',
                '0 0 6px rgba(245,158,11,0.3)',
              ],
            }
          : isWinner
          ? { boxShadow: '0 0 12px rgba(34,197,94,0.4)' }
          : {}),
      }}
      transition={
        isAllIn
          ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.3 }
      }
      className={cn(
        'flex items-center gap-3 rounded-lg bg-bg-surface px-3 shrink-0',
        shaking && 'shake',
        'shadow-[0_0_0_1px_var(--amber-dim)] edge-light-amber',
        isFolded && 'opacity-30',
      )}
      style={{
        filter: isFolded ? 'grayscale(0.5)' : undefined,
        height: 72,
        border: `2px solid ${isWinner ? 'var(--win)' : isAllIn ? 'var(--amber)' : isActive ? 'var(--teal)' : 'var(--amber-dim)'}`,
        animation: isActive && !isAllIn ? 'pulse-border 1.5s ease-in-out infinite' : undefined,
      }}
    >
      {/* Left: name + stack + health bar */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.75rem] font-semibold text-amber truncate max-w-[100px]">
            {player.displayName}
          </span>
          {player.isButton && (
            <span className="text-[0.5rem] bg-[rgba(245,158,11,0.25)] text-amber px-0.5 rounded-[2px] font-bold leading-tight">
              D
            </span>
          )}
          {player.isSB && (
            <span className="text-[0.5rem] bg-[rgba(0,180,216,0.2)] text-teal px-0.5 rounded-[2px] font-bold leading-tight">
              S
            </span>
          )}
          {player.isBB && (
            <span className="text-[0.5rem] bg-[rgba(100,116,139,0.25)] text-text-secondary px-0.5 rounded-[2px] font-bold leading-tight">
              B
            </span>
          )}
          {player.lastAction && (
            <span
              className="text-[0.6rem] px-1 py-0 rounded-[3px] font-bold"
              style={{
                color: actionColors[player.lastAction] ?? 'var(--text-muted)',
                background: `${actionColors[player.lastAction] ?? 'var(--text-muted)'}22`,
              }}
            >
              {ACTION_LABELS[player.lastAction] ?? player.lastAction}
            </span>
          )}
        </div>

        {/* Health bar */}
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: 3, background: 'rgba(255,255,255,0.08)' }}
        >
          <div
            style={{
              height: '100%',
              width: `${stackRatio * 100}%`,
              background: healthColor,
              transition: 'width 0.4s ease, background 0.4s ease',
              borderRadius: 9999,
            }}
          />
        </div>

        {/* Stack */}
        <span className="chip-count mono text-[0.85rem] font-bold">
          {player.stack}
        </span>
      </div>

      {/* Right: hole cards */}
      <div className="flex gap-1 shrink-0">
        {holeCards ? (
          <>
            <PlayingCard card={holeCards[0]} size="sm" />
            <PlayingCard card={holeCards[1]} size="sm" />
          </>
        ) : player.status !== 'folded' && player.status !== 'sitting_out' ? (
          <>
            <PlayingCard faceDown size="sm" />
            <PlayingCard faceDown size="sm" />
          </>
        ) : null}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/table/HeroSeat.tsx
git commit -m "feat(mobile): create HeroSeat component for bottom-fixed layout"
```

---

### Task 4: Update TableFelt to use upper-arc layout in compact mode

**Files:**
- Modify: `src/components/table/TableFelt.tsx`

When `compact`, skip rendering the hero seat in the ellipse loop. Use `getMobileSeatPosition()` for opponents. Pass `totalSeats` to SeatView.

- [ ] **Step 1: Update TableFelt props to accept `heroSeat` for filtering**

The `heroSeat` prop already exists on `TableFelt`. When `compact`, use it to:
1. Skip rendering the hero's seat in the loop (hero is rendered separately by the page)
2. Map remaining seats to opponent indices for `getMobileSeatPosition()`

Replace the seats rendering section (the `{tableState.players.map((p, seatIdx) => {` block for occupied seats AND empty seats) in `TableFelt`:

```tsx
      {/* Seats */}
      {tableState.players.map((p, seatIdx) => {
        // In compact (mobile) mode, hero is rendered separately — skip
        if (compact && heroSeat !== null && seatIdx === heroSeat) return null;

        const pos = compact && heroSeat !== null
          ? (() => {
              // Build opponent index: seats ordered by table position, hero excluded
              const opponentSeats = tableState.players
                .map((_, i) => i)
                .filter(i => i !== heroSeat);
              const opponentIndex = opponentSeats.indexOf(seatIdx);
              return getMobileSeatPosition(opponentIndex, opponentSeats.length);
            })()
          : getSeatPosition(seatIdx, totalSeats, heroSeat, compact);

        if (p) {
          const showdownData = showdown?.find(r => r.seat === p.seatIndex);
          return (
            <div
              key={seatIdx}
              style={{
                position: 'absolute',
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 3,
              }}
            >
              <SeatView
                player={p}
                holeCards={p.userId === currentUserId ? myHoleCards : (showdownData?.holeCards ?? p.holeCards ?? null)}
                isActive={tableState.activeSeat === p.seatIndex}
                isMe={p.userId === currentUserId}
                isWinner={winnerSeats.has(p.seatIndex)}
                compact={compact}
                totalSeats={totalSeats}
              />
            </div>
          );
        }
        return (
          <div
            key={seatIdx}
            style={{
              position: 'absolute',
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 3,
            }}
          >
            <EmptySeat
              seatIndex={seatIdx}
              tableId={tableId}
              isSeated={isSeated}
              onSitDown={(idx) => onSitDown(idx)}
              compact={compact}
            />
          </div>
        );
      })}
```

Also update the street bets rendering to skip hero bet (it will be rendered by the page):

```tsx
      {/* Street bets */}
      {tableState.players.map((p, seatIdx) => {
        if (!p || p.streetBet <= 0) return null;
        // In compact mode, hero bet is rendered by the page above the hero bar
        if (compact && heroSeat !== null && seatIdx === heroSeat) return null;

        const seatPos = compact && heroSeat !== null
          ? (() => {
              const opponentSeats = tableState.players
                .map((_, i) => i)
                .filter(i => i !== heroSeat);
              const opponentIndex = opponentSeats.indexOf(seatIdx);
              return getMobileSeatPosition(opponentIndex, opponentSeats.length);
            })()
          : getSeatPosition(seatIdx, totalSeats, heroSeat, compact);
        const betPos = getBetPosition(seatPos);
        return (
          <div
            key={`bet-${seatIdx}`}
            style={{
              position: 'absolute',
              left: `${betPos.x}%`,
              top: `${betPos.y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 4,
            }}
          >
            <span
              className={`mono text-amber font-bold bg-black/50 rounded-[0.25rem] inline-flex items-center gap-[0.2rem] ${
                compact
                  ? 'text-[0.7rem] px-[0.3rem] py-[0.1rem]'
                  : 'text-[0.75rem] px-[0.4rem] py-[0.15rem]'
              }`}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: compact ? 8 : 10,
                  height: compact ? 8 : 10,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #f5d080, #b8860b)',
                  flexShrink: 0,
                }}
              />
              {p.streetBet}
            </span>
          </div>
        );
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run src/server/poker/__tests__/mobile-seat-position.test.ts`
Expected: PASS (pure function unchanged).

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/table/TableFelt.tsx
git commit -m "feat(mobile): use upper-arc positioning for opponents, skip hero in compact"
```

---

### Task 5: Restructure mobile table page layout

**Files:**
- Modify: `src/app/table/[id]/page.tsx`

Restructure the mobile layout to: header → felt (opponents only) → hero bet → hero seat → showdown → action bar.

- [ ] **Step 1: Add import and restructure the mobile layout**

Add import at the top:
```ts
import HeroSeat from '@/components/table/HeroSeat';
```

Replace the entire mobile layout block (`if (isMobile) { return ( ... ) }`) with:

```tsx
  if (isMobile) {
    return (
      <div className="flex flex-col mx-[-0.5rem] overflow-x-hidden" style={{ height: 'calc(100dvh - 2.75rem)' }}>
        {/* Compact mobile header */}
        <TableHeader
          tableId={tableId}
          tableState={tableState}
          connected={connected}
          isSeated={isSeated}
          authLoading={authLoading}
          currentUserId={currentUserId}
          sitDownError={sitDownError}
          onSitDown={() => handleSitDown()}
          onLeave={handleLeave}
          compact
        />

        {/* Table area — opponents only in the ellipse */}
        <div className="flex-1 min-h-0 relative overflow-visible">
          <TableFelt
            tableId={tableId}
            tableState={tableState}
            myHoleCards={myHoleCards}
            showdown={showdown}
            lastWinners={lastWinners}
            currentUserId={currentUserId}
            isSeated={isSeated}
            heroSeat={heroSeat}
            winnerSeats={winnerSeats}
            onSitDown={handleSitDown}
            compact
          />
        </div>

        {/* Hero street bet — displayed above hero bar */}
        {myPlayer && myPlayer.streetBet > 0 && (
          <div className="flex justify-center -mt-1 mb-1">
            <span className="mono text-amber font-bold bg-black/50 rounded-[0.25rem] inline-flex items-center gap-[0.2rem] text-[0.75rem] px-[0.4rem] py-[0.15rem]">
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #f5d080, #b8860b)',
                  flexShrink: 0,
                }}
              />
              {myPlayer.streetBet}
            </span>
          </div>
        )}

        {/* Hero seat — fixed above action bar */}
        {myPlayer && (
          <div className="shrink-0 px-2">
            <HeroSeat
              player={myPlayer}
              holeCards={myHoleCards}
              isActive={tableState.activeSeat === myPlayer.seatIndex}
              isWinner={winnerSeats.has(myPlayer.seatIndex)}
            />
          </div>
        )}

        {/* Showdown overlay on mobile */}
        {showdown && (
          <div className="shrink-0 px-2 py-1">
            <ShowdownPanel
              showdown={showdown}
              winnerSeats={winnerSeats}
              compact
            />
          </div>
        )}

        {/* Fixed bottom action bar */}
        <ActionBar
          isMyTurn={isMyTurn}
          isSeated={isSeated}
          isReady={isReady}
          myPlayer={myPlayer}
          tableState={tableState}
          actionRequest={actionRequest}
          busted={busted}
          sendAction={sendAction}
          sendMsg={sendMsg}
          setIsReady={setIsReady}
          compact
        />

        {/* Action log toggle button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed right-3 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-bg-surface text-text-muted shadow-lg active:bg-bg-hover"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 52px)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
        >
          <MessageSquare className="h-4 w-4" />
          {actionLog.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-teal text-[0.5rem] font-bold text-white">
              {Math.min(actionLog.length, 99)}
            </span>
          )}
        </button>

        {/* Mobile sidebar panel */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mobile-panel-backdrop"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="mobile-panel safe-bottom"
              >
                <div className="mobile-panel-handle" />
                <div className="flex items-center justify-between px-4 pb-2">
                  <span className="text-sm font-semibold text-text-primary">牌局详情</span>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded border-none bg-transparent text-text-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                  <div className="mb-2">
                    <ActionLog entries={actionLog} players={tableState.players} />
                  </div>
                  <HandHistorySidebar tableId={tableId} />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Visual verification**

Run: `npm run dev`
Open the table page on a mobile viewport (393×852) in Chrome DevTools. Verify:
- Hero seat appears at the bottom as a horizontal bar
- Opponents are distributed in the upper arc
- No elements overlap
- Desktop layout is unchanged

- [ ] **Step 4: Commit**

```bash
git add src/app/table/[id]/page.tsx
git commit -m "feat(mobile): restructure table page with hero-bottom layout"
```

---

### Task 6: Compress ActionControls mobile layout

**Files:**
- Modify: `src/components/ActionControls.tsx`

Merge slider + amount into one row. Smaller quick-bet pills.

- [ ] **Step 1: Replace the compact layout section in ActionControls**

Replace the `if (compact) { return (...) }` block:

```tsx
  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        {/* Timer bar */}
        <TimerBar pct={pct} urgent={urgent} remaining={remaining} />

        {/* Raise slider + amount — single row */}
        {canShowSlider && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={minRaiseTotal}
              max={maxRaiseTotal > minRaiseTotal ? maxRaiseTotal : minRaiseTotal}
              value={raiseAmount}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="mobile-slider flex-1 appearance-none accent-amber cursor-pointer h-8"
              style={{ touchAction: 'none' }}
            />
            <span className="mono text-sm font-bold text-amber min-w-[48px] text-right">{raiseAmount}</span>
          </div>
        )}

        {/* Quick-bet presets — smaller pills */}
        {canShowSlider && (
          <div className="flex gap-1">
            {QUICK_BETS.map(({ label, mult }) => (
              <Button
                key={label}
                variant="ghost"
                size="xs"
                className="flex-1 text-[0.65rem] h-7 active:translate-y-px active:brightness-90"
                onClick={() => {
                  const raiseSize = Math.round(pot * mult);
                  const raiseTo = currentBet + raiseSize;
                  setRaiseAmount(Math.min(Math.max(raiseTo, minRaiseTotal), maxRaiseTotal));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        {/* Action buttons — full width row */}
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
            onClick={() => onAction({ action: 'fold' })}
          >
            弃牌
          </Button>

          {canCheck ? (
            <Button
              variant="ghost"
              className="flex-1 h-11 text-sm font-bold border border-[var(--border)] active:translate-y-px active:brightness-90"
              onClick={() => onAction({ action: 'check' })}
            >
              过牌
            </Button>
          ) : (
            <Button
              variant="teal"
              className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
              disabled={!canCall}
              onClick={() => onAction({ action: 'call' })}
            >
              跟注 {callAmount}
            </Button>
          )}

          {isAllIn ? (
            <Button
              variant="amber"
              className="flex-1 h-11 text-sm font-extrabold uppercase tracking-wide glow-text-amber active:translate-y-px active:brightness-90"
              style={{ boxShadow: 'var(--glow-amber)' }}
              onClick={() => onAction({ action: 'allin' })}
            >
              ALL-IN {stack}
            </Button>
          ) : (
            <Button
              variant="amber"
              className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
              disabled={!canRaise}
              onClick={() => onAction({ action: 'raise', amount: raiseAmount })}
            >
              加注 {raiseAmount}
            </Button>
          )}
        </div>
      </div>
    );
  }
```

Key changes from current:
- Gap reduced from `gap-2` to `gap-1.5`
- Quick-bet pills: `h-9` → `h-7`, font `text-xs` → `text-[0.65rem]`
- Gap between pills: `gap-1.5` → `gap-1`

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ActionControls.tsx
git commit -m "feat(mobile): compress ActionControls with smaller pills and tighter gaps"
```

---

### Task 7: Reduce ActionBar expanded height

**Files:**
- Modify: `src/components/table/ActionBar.tsx`

- [ ] **Step 1: Change the compact expanded height**

In `ActionBar.tsx`, find the `animate` prop on the `motion.div`:

```tsx
      animate={{ height: compact ? (expanded ? 176 : 44) : (expanded ? 120 : 48) }}
```

Replace with:

```tsx
      animate={{ height: compact ? (expanded ? 136 : 44) : (expanded ? 120 : 48) }}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/table/ActionBar.tsx
git commit -m "feat(mobile): reduce ActionBar expanded height to 136px"
```

---

### Task 8: Use smaller board cards on mobile

**Files:**
- Modify: `src/components/table/BoardCards.tsx`

- [ ] **Step 1: Change compact card size from `md` to `sm`**

In `BoardCards.tsx`, find:

```ts
  const cardSize = compact ? 'md' as const : 'lg' as const;
```

Replace with:

```ts
  const cardSize = compact ? 'sm' as const : 'lg' as const;
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/table/BoardCards.tsx
git commit -m "feat(mobile): use smaller board cards (sm) in compact mode"
```

---

### Task 9: Enlarge EmptySeat touch target on mobile

**Files:**
- Modify: `src/components/table/EmptySeat.tsx`

- [ ] **Step 1: Increase compact EmptySeat size**

In `EmptySeat.tsx`, find the `PopoverTrigger` style:

```tsx
        style={{ width: compact ? 30 : 52, height: compact ? 30 : 52 }}
```

Replace with:

```tsx
        style={{ width: compact ? 40 : 52, height: compact ? 40 : 52 }}
```

Also increase the icon size for compact — find:

```tsx
        <Plus className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
```

Replace with:

```tsx
        <Plus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/table/EmptySeat.tsx
git commit -m "feat(mobile): enlarge EmptySeat touch target from 30px to 40px"
```

---

### Task 10: Records page — two-line mobile hand list

**Files:**
- Modify: `src/app/records/page.tsx`

- [ ] **Step 1: Add `useIsMobile` import and update HandsTab**

Add import at top of file:
```ts
import { useIsMobile } from '@/hooks/useMediaQuery';
```

In the `HandsTab` function, add at the top:
```ts
  const isMobile = useIsMobile();
```

Replace the `<Link>` block inside `rows.map(r => { ... })` with:

```tsx
              <Link
                key={r.id}
                href={`/hand/${r.id}`}
                className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-bg-surface px-4 py-3 no-underline transition-colors hover:bg-bg-hover"
              >
                {/* Hole cards */}
                <div className="flex shrink-0">
                  {holeCards ? (
                    <>
                      <PlayingCard card={holeCards[0]} size="xs" />
                      <div style={{ marginLeft: '-4px' }}>
                        <PlayingCard card={holeCards[1]} size="xs" />
                      </div>
                    </>
                  ) : (
                    <>
                      <PlayingCard faceDown size="xs" />
                      <div style={{ marginLeft: '-4px' }}>
                        <PlayingCard faceDown size="xs" />
                      </div>
                    </>
                  )}
                </div>

                {isMobile ? (
                  /* Mobile: two-line layout */
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">第 {r.hand_number} 局</span>
                      <span className="text-xs text-text-muted truncate flex-1">{r.table_name}</span>
                      {profit !== null && (
                        <span className={cn(
                          'mono text-sm font-bold whitespace-nowrap shrink-0',
                          profit > 0 ? 'text-win' : profit < 0 ? 'text-loss' : 'text-text-muted',
                        )}>
                          {profit > 0 ? '+' : ''}{profit.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-text-muted">
                        底池 <span className="mono text-amber">{r.pot}</span>
                      </span>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {r.ended_at ? fmtTime(r.ended_at) : ''}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Desktop: single-line layout */
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">第 {r.hand_number} 局</span>
                        <span className="text-xs text-text-muted truncate">{r.table_name}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-text-muted">
                        底池 <span className="mono text-amber">{r.pot}</span>
                      </div>
                    </div>
                    {profit !== null && (
                      <span className={cn(
                        'mono text-sm font-bold whitespace-nowrap',
                        profit > 0 ? 'text-win' : profit < 0 ? 'text-loss' : 'text-text-muted',
                      )}>
                        {profit > 0 ? '+' : ''}{profit.toLocaleString()}
                      </span>
                    )}
                    <span className="text-xs text-text-muted whitespace-nowrap">
                      {r.ended_at ? fmtTime(r.ended_at) : ''}
                    </span>
                  </>
                )}
              </Link>
```

- [ ] **Step 2: Update Pagination touch targets**

In the `Pagination` component at the bottom of the file, replace the buttons:

```tsx
function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <Button variant="ghost" size="xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="h-11 px-4 md:h-auto md:px-2">
        上一页
      </Button>
      <span className="text-xs text-text-muted">{page} / {totalPages}</span>
      <Button variant="ghost" size="xs" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="h-11 px-4 md:h-auto md:px-2">
        下一页
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Standardize top padding**

Change the page wrapper from `py-6` to `py-4 md:py-6`:

```tsx
    <div className="py-4 md:py-6">
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/records/page.tsx
git commit -m "feat(mobile): two-line hand list, larger pagination, consistent padding"
```

---

### Task 11: Tournaments + Lobby global polish

**Files:**
- Modify: `src/app/tournaments/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Fix tournaments create form**

In `src/app/tournaments/page.tsx`, find the `<select>` element and add styling:

```tsx
                <select
                  value={form.maxPlayers}
                  onChange={e => setForm({ ...form, maxPlayers: Number(e.target.value) })}
                  className="w-full rounded-md border border-input bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:ring-1 focus:ring-teal/50"
                >
```

Add `inputMode="numeric"` to the number inputs. Find both `<Input type="number"` and add the prop:

```tsx
              <div>
                <label className="block mb-1 text-xs text-text-muted">买入</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.buyin}
                  onChange={e => setForm({ ...form, buyin: Number(e.target.value) })}
                  min={0}
                />
              </div>
              <div>
                <label className="block mb-1 text-xs text-text-muted">初始筹码</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.startingChips}
                  onChange={e => setForm({ ...form, startingChips: Number(e.target.value) })}
                  min={100}
                />
              </div>
```

Standardize top padding — find `<div className="py-5 md:py-8">` and replace with:

```tsx
    <div className="py-4 md:py-8">
```

- [ ] **Step 2: Fix lobby page padding**

In `src/app/page.tsx`, find:

```tsx
    <div className="py-5 md:py-8">
```

Replace with:

```tsx
    <div className="py-4 md:py-8">
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/tournaments/page.tsx src/app/page.tsx
git commit -m "feat(mobile): polish tournaments form and standardize page padding"
```

---

### Task 12: Final integration test

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Visual integration test**

Run: `npm run dev`
Test in Chrome DevTools at 393×852 (iPhone 15):

1. **Lobby**: Cards display properly, padding consistent
2. **Table (6-max)**: Hero at bottom, 5 opponents in upper arc, no overlaps
3. **Table (9-max)**: 8 opponents in upper arc, smaller seats, no overlaps
4. **Action controls**: Slider + amount inline, smaller pills, buttons h-11
5. **Showdown**: Panel appears between hero and action bar
6. **Records**: Two-line hand list, larger pagination buttons
7. **Tournaments**: Styled select, numeric keyboard on number inputs
8. **Desktop**: Open at 1440px — verify ALL layouts are unchanged

- [ ] **Step 4: Commit any fixes found during integration**

```bash
git add -A
git commit -m "fix(mobile): integration adjustments from visual testing"
```
