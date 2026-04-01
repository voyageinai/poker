/**
 * Consolidated equity calculation for bot decision-making.
 *
 * Single source of truth for Monte Carlo equity with draw bonus smoothing.
 * Replaces the inline postflopStrengthMC in agents.ts.
 */
import { monteCarloEquity } from '@/server/poker/hand-eval'
import type { Card } from '@/lib/types'

// ─── Draw detection ────────────────────────────────────────────────────────────

/**
 * Detect flush draw status from hole cards + board.
 */
export function countFlushDraw(
  holeCards: [string, string],
  board: string[],
): 'none' | 'backdoor' | 'draw' | 'made' {
  const all = [...holeCards, ...board]
  const suitCounts: Record<string, number> = {}
  for (const card of all) {
    const suit = card[card.length - 1]
    suitCounts[suit] = (suitCounts[suit] ?? 0) + 1
  }

  const maxSuit = Math.max(...Object.values(suitCounts))

  if (maxSuit >= 5) return 'made'
  if (maxSuit === 4) return 'draw'
  if (maxSuit === 3 && board.length <= 3) return 'backdoor'
  return 'none'
}

const RANK_MAP: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}

/**
 * Detect straight draw status from hole cards + board.
 */
export function countStraightDraw(
  holeCards: [string, string],
  board: string[],
): 'none' | 'backdoor' | 'gutshot' | 'oesd' | 'made' {
  const all = [...holeCards, ...board]

  // Extract unique ranks as numbers (A counts as both 14 and 1)
  const rankSet = new Set<number>()
  for (const card of all) {
    const rank = RANK_MAP[card[0]]
    if (rank !== undefined) {
      rankSet.add(rank)
      if (rank === 14) rankSet.add(1) // Ace low
    }
  }

  const ranks = [...rankSet].sort((a, b) => a - b)

  // Slide a window of size 5 across the rank range [1..14]
  // and find the maximum number of our ranks that fall in any window
  let bestConsecutive = 0
  let bestInWindow = 0

  for (let low = 1; low <= 10; low++) {
    const high = low + 4 // window covers [low, high]
    let count = 0
    for (const r of ranks) {
      if (r >= low && r <= high) count++
    }
    if (count > bestInWindow) bestInWindow = count

    // Check consecutive: count the longest run of consecutive ranks in this window
    let consecutive = 0
    let maxConsec = 0
    for (let r = low; r <= high; r++) {
      if (rankSet.has(r)) {
        consecutive++
        if (consecutive > maxConsec) maxConsec = consecutive
      } else {
        consecutive = 0
      }
    }
    if (maxConsec > bestConsecutive) bestConsecutive = maxConsec
  }

  if (bestInWindow >= 5) return 'made'
  if (bestConsecutive >= 4) return 'oesd'
  if (bestInWindow >= 4) return 'gutshot'
  if (bestInWindow >= 3 && board.length <= 3) return 'backdoor'
  return 'none'
}

// ─── Draw bonus constants ──────────────────────────────────────────────────────

const FLUSH_DRAW_BONUS = 0.04
const BACKDOOR_FLUSH_BONUS = 0.015
const OESD_BONUS = 0.035
const GUTSHOT_BONUS = 0.02
const BACKDOOR_STRAIGHT_BONUS = 0.01

// ─── Main equity function ──────────────────────────────────────────────────────

/**
 * Monte Carlo equity with draw bonus smoothing for bot decision-making.
 *
 * Simulates against `opponents` random hands, completing the board randomly.
 * Includes draw bonus smoothing for flush/straight draws.
 *
 * @param holeCards - player's two hole cards
 * @param board - community cards (3-5)
 * @param opponents - number of opponents (1+)
 * @returns equity 0~1 with draw bonus applied
 */
export function postflopStrengthMC(
  holeCards: [string, string],
  board: string[],
  opponents: number,
): number {
  // 1. Determine iteration count
  const iterations = Math.max(800, Math.round(2000 / opponents))

  // 2. Core MC equity — deal random opponent hands per iteration
  //    We build opponent hand arrays for monteCarloEquity. Each batch uses
  //    freshly dealt random opponent hands from the remaining deck.
  const hands: Array<[string, string]> = [holeCards]
  // Generate placeholder opponent hands — monteCarloEquity needs them upfront.
  // We use a multi-batch approach: run several batches with different random
  // opponent hands to get accurate multi-opponent equity.
  const batchSize = Math.ceil(iterations / 4)
  const batches = 4
  let totalEquity = 0

  for (let b = 0; b < batches; b++) {
    // Build a remaining deck excluding our hole cards and board
    const usedSet = new Set([...holeCards, ...board])
    const remaining: string[] = []
    const suits = ['h', 'd', 'c', 's']
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
    for (const r of ranks) {
      for (const s of suits) {
        const c = `${r}${s}`
        if (!usedSet.has(c)) remaining.push(c)
      }
    }

    // Shuffle to pick random opponent hands
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]]
    }

    // Deal opponent hole cards
    const batchHands: Array<[string, string]> = [holeCards]
    for (let o = 0; o < opponents; o++) {
      batchHands.push([remaining[o * 2], remaining[o * 2 + 1]])
    }

    // Exclude dealt opponent cards from the dead pile so monteCarloEquity
    // doesn't deal them again as board cards
    const dead = batchHands.slice(1).flat()

    const { equities } = monteCarloEquity(batchHands as Array<[Card, Card]>, board as Card[], dead as Card[], batchSize)
    totalEquity += equities[0]
  }

  let equity = totalEquity / batches

  // 3. Draw bonus (only on flop/turn, not river)
  let drawBonus = 0
  if (board.length >= 3 && board.length <= 4) {
    const flush = countFlushDraw(holeCards, board)
    if (flush === 'draw') drawBonus += FLUSH_DRAW_BONUS
    else if (flush === 'backdoor') drawBonus += BACKDOOR_FLUSH_BONUS

    const straight = countStraightDraw(holeCards, board)
    if (straight === 'oesd') drawBonus += OESD_BONUS
    else if (straight === 'gutshot') drawBonus += GUTSHOT_BONUS
    else if (straight === 'backdoor') drawBonus += BACKDOOR_STRAIGHT_BONUS
  }

  // 4. Clamp and return
  equity = equity + drawBonus
  return Math.max(0, Math.min(1, equity))
}
