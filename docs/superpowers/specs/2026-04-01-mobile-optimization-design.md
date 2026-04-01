# Mobile Optimization Design Spec

## Overview

Optimize the poker app's mobile experience on iPhone 15 (393×852pt), targeting two areas: (A) poker table interaction — seats too small, controls awkward, elements overlapping; (B) general UI polish across other pages.

**Primary device:** iPhone 15 (393×852pt)
**Table sizes:** 6-max (primary), 9-max (secondary)

## Part 1: Mobile Table Layout Rewrite

### Current Problems

1. **Overlapping/distortion** — 6-9 seats positioned on a full ellipse via `getSeatPosition()` with ±36% x / ±32% y bounds. On a 393px screen, adjacent 72px seats overlap, especially at the top/bottom of the ellipse where angles converge.
2. **Unreadable info** — Non-hero seats: 72px wide, name text 0.5rem (8px), max name width 32px, stack text 0.5rem. All too small to read.
3. **Oversized ActionBar** — Expanded height 176px (21% of 852pt viewport). Combined with nav (44px) and header, the felt area gets severely compressed.
4. **Board cards too wide** — 5× `md` (56px) cards ≈ 296px = 75% of screen width, crowding center area.

### Solution: Hero Bottom Fixed + Upper Arc Opponents

Inspired by standard poker app layouts (PokerStars, GGPoker). Hero seat exits the ellipse and gets a fixed, larger position at the bottom. Opponents arrange in the upper arc only.

#### 1.1 Hero Seat — Fixed at Bottom

- **Position:** Fixed at the bottom of the felt area, directly above ActionBar. Not part of the ellipse layout.
- **Layout:** Full-width horizontal bar (`px-3`). Left side: name + stack + health bar. Right side: hole cards at `sm` size (44×60px).
- **Height:** ~72px (accommodates `sm` cards with padding).
- **Styling:** Keep existing amber border, edge-light treatment, and `isMe` visual cues.

#### 1.2 Opponents — Upper Arc Only

- **Position:** Use only the upper half of the ellipse. In the current code, `angle = π/2 - (adjusted / totalSeats) × 2π`. The new mobile function distributes opponents evenly across the upper arc (y < 50%), skipping the hero's seat index. The `totalSeats` from `tableState.players.length` determines 6-max vs 9-max sizing automatically.
- **6-max (5 opponents):** Evenly distributed on upper arc. Seat width ~80px. Cards at `sm` size (44×60px).
- **9-max (8 opponents):** Same arc, seat width ~68px, cards at `xs` size (28×40px). Tighter but no overlap since they're spread across the full 180° arc.
- **Seat layout:** Compact format — single row for name + stack, cards below. Name and stack on the same line reduces vertical footprint and prevents overlap.
- **Font sizes:** Name 0.6rem (10px) for 6-max, 0.55rem for 9-max. Stack 0.6rem monospace. Min name width 40px (up from 32px).

#### 1.3 Board Cards + Pot — Center

- **Board card size:** Downgrade from `md` to `sm` (44px wide). 5 cards + gaps ≈ 228px = 58% of 393px. Comfortable fit.
- **Pot display:** Above board cards, same styling.
- **Winner overlay:** Below board cards, compact.

#### 1.4 ActionBar — Compressed

- **Expanded height:** 176px → ~136px.
- **Layout changes:**
  - Timer bar stays at top.
  - Raise slider and amount display merge into a single row (slider takes flex-1, amount label on the right).
  - Quick-bet presets: smaller pill buttons, `h-7` instead of `h-9`.
  - Three action buttons remain `h-11` (44px) for adequate touch targets.
- **Collapsed height:** 44px (unchanged).

#### 1.5 Bet Chips

- Opponents: Bet labels positioned between seat and center (existing `getBetPosition()` logic, adjusted for new arc positions).
- Hero: Bet label displayed above the hero seat bar.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/table/TableFelt.tsx` | New `getSeatPositionMobile()` for upper-arc-only layout. Render hero seat as a separate fixed element outside the ellipse. |
| `src/components/table/SeatView.tsx` | New compact inline layout variant for mobile opponents (name+stack row + cards). Increase font sizes. Adjust widths for 6-max vs 9-max. |
| `src/app/table/[id]/page.tsx` | Restructure mobile layout: felt area → hero seat → action bar. Pass `totalSeats` to TableFelt for 6-max vs 9-max sizing. |
| `src/components/table/ActionBar.tsx` | Reduce expanded height. Restructure compact layout. |
| `src/components/ActionControls.tsx` | Merge slider + amount into single row. Smaller quick-bet pills. |
| `src/components/table/BoardCards.tsx` | Use `sm` size instead of `md` when `compact` is true. |
| `src/components/PlayingCard.tsx` | No changes needed — existing sizes are sufficient. |
| `src/components/table/EmptySeat.tsx` | Match new compact sizing for empty seats. |
| `src/components/table/PotDisplay.tsx` | No changes expected — current compact styling should work with new layout. Verify after integration. |
| `src/components/table/ShowdownPanel.tsx` | Ensure it fits within the new layout constraints. |

### Key Constraints

- **Desktop layout unchanged.** All changes are gated behind the `compact` prop / `isMobile` check.
- **No new dependencies.** Pure CSS/Tailwind + existing component props.
- **Touch targets ≥ 44px** for all interactive elements (action buttons, sit-down buttons).
- **Safe area insets** preserved for notched phones.
- **WebSocket privacy rules unchanged** — no hole card leakage in new layout.

## Part 2: General UI Polish

### 2.1 Records Page — Hand List Row

**Current:** Single row with hole cards + round info + profit + time. Cramped on narrow screens.

**Change:** Two-line layout on mobile:
- Line 1: hole cards + "第 N 局" + table name (truncated) + profit (right-aligned)
- Line 2: "底池 XXX" + time (right-aligned), smaller text

**File:** `src/app/records/page.tsx` — `HandsTab` component.

### 2.2 Tournaments — Create Form

- Replace raw `<select>` with consistent styled select (or at minimum add proper `bg-bg-base` + rounded border styling matching Input).
- Add `inputMode="numeric"` to number inputs for better mobile keyboard.

**File:** `src/app/tournaments/page.tsx`.

### 2.3 Global Consistency

- Standardize mobile page top padding to `py-4` (currently mixed `py-5` / `py-6`).
- Pagination buttons: increase touch target from current size to `h-11` on mobile.

**Files:** `src/app/records/page.tsx`, `src/app/tournaments/page.tsx`, `src/app/page.tsx` (minor padding adjustments).

## Out of Scope

- PWA / service worker / offline support
- Landscape orientation handling
- Tablet-specific layouts (768-1024px)
- Gesture/swipe interactions
- Haptic feedback
- Performance optimization
