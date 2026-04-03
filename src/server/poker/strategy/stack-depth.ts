export type HandCategory = 'premium' | 'broadway' | 'suited-connector' | 'small-pair' | 'suited-gapper' | 'offsuit'

const RANK_MAP: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}

function parseCard(card: string): { rank: number; suit: string } {
  return { rank: RANK_MAP[card[0]], suit: card[1] }
}

export function classifyHand(cards: [string, string]): HandCategory {
  const a = parseCard(cards[0])
  const b = parseCard(cards[1])

  const high = Math.max(a.rank, b.rank)
  const low = Math.min(a.rank, b.rank)
  const isPair = a.rank === b.rank
  const isSuited = a.suit === b.suit
  const gap = high - low

  // Premium: AA, KK, QQ, JJ, AKs, AKo
  if (isPair && high >= 11) return 'premium' // JJ, QQ, KK, AA
  if (high === 14 && low === 13) return 'premium' // AK suited or offsuit

  // Broadway: any two cards T+ (that aren't premium)
  // Also TT is broadway-tier
  if (isPair && high === 10) return 'broadway' // TT
  if (high >= 10 && low >= 10) return 'broadway' // two broadway cards

  // Small pair: 22-99
  if (isPair) return 'small-pair'

  // Suited connector: same suit, gap of 1
  if (isSuited && gap === 1) return 'suited-connector'

  // Suited gapper: same suit, gap of 2
  if (isSuited && gap === 2) return 'suited-gapper'

  // Everything else
  return 'offsuit'
}

// Adjustment table indexed by HandCategory
// Rows: <=15BB, 16-25BB, 26-60BB, 61-100BB, 100BB+
type StackTier = 0 | 1 | 2 | 3 | 4

const ADJUSTMENTS: Record<HandCategory, [number, number, number, number, number]> = {
  'premium':          [+0.00, +0.00, +0.00, +0.00, +0.00],
  'broadway':         [+0.03, +0.02, +0.00, -0.01, -0.03],
  'suited-connector': [-0.06, -0.03, +0.00, +0.03, +0.06],
  'small-pair':       [-0.04, -0.02, +0.00, +0.03, +0.06],
  'suited-gapper':    [-0.05, -0.03, +0.00, +0.02, +0.04],
  'offsuit':          [+0.02, +0.01, +0.00, -0.01, -0.03],
}

function getStackTier(stackBB: number): StackTier {
  if (stackBB <= 15) return 0
  if (stackBB <= 25) return 1
  if (stackBB <= 60) return 2
  if (stackBB <= 100) return 3
  return 4
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function adjustForStackDepth(
  cards: [string, string],
  strengthRaw: number,
  stackBB: number,
): number {
  const category = classifyHand(cards)
  const tier = getStackTier(stackBB)
  const adjustment = ADJUSTMENTS[category][tier]
  return clamp(strengthRaw + adjustment, 0, 1)
}

export function shouldPushFold(stackBB: number): boolean {
  return stackBB <= 14
}
