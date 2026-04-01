import type { BoardTexture } from './board-texture'

export type SystemBotStyle =
  | 'nit' | 'tag' | 'lag' | 'station' | 'maniac'
  | 'trapper' | 'bully' | 'tilter' | 'shortstack' | 'adaptive' | 'gto'

export interface LegalConstraints {
  minRaise: number
  currentBet: number
  raiseCap?: number        // max raises per street (default 4)
  raiseCount?: number      // raises already made this street
}

/**
 * Compute the geometric bet fraction that naturally commits all chips by the river.
 * fraction = (stack/pot + 1)^(1/streetsLeft) - 1
 */
export function geometricBetFraction(pot: number, stack: number, streetsLeft: number): number {
  if (pot <= 0 || streetsLeft <= 0 || stack <= 0) return 0
  return Math.pow(stack / pot + 1, 1 / streetsLeft) - 1
}

const styleModifiers: Record<SystemBotStyle, number> = {
  maniac: 1.20,
  lag: 1.10,
  nit: 0.80,
  gto: 1.00,
  adaptive: 1.00,
  tag: 1.00,
  station: 0.90,
  trapper: 0.85,
  bully: 1.15,
  tilter: 1.10,
  shortstack: 1.00,
}

export function chooseBetSize(
  pot: number,
  stack: number,
  streetsRemaining: number,
  texture: BoardTexture | null,
  strength: number,
  style: SystemBotStyle,
  isBluff: boolean,
  legalConstraints: LegalConstraints,
): { amount: number; action: 'raise' | 'call' | 'check' } {
  const { minRaise, currentBet, raiseCap, raiseCount } = legalConstraints

  // Legal clamping: raise cap reached
  if (raiseCap !== undefined && raiseCount !== undefined && raiseCount >= raiseCap) {
    if (currentBet === 0) return { action: 'check', amount: 0 }
    return { action: 'call', amount: currentBet }
  }

  const effectivePot = Math.max(pot, 1)
  const spr = stack / effectivePot

  // SPR check: shove when committed
  if (spr < 3) {
    return { action: 'raise', amount: stack }
  }

  // Compute geometric base
  let fraction = geometricBetFraction(pot, stack, streetsRemaining)

  // Texture adjustments (multiply fraction)
  if (texture !== null) {
    // Flush draw monotone overrides wet multiplier
    if (texture.flushDraw === 'monotone') {
      fraction *= 1.35
    } else if (texture.wetness < 0.25) {
      fraction *= 0.55
    } else if (texture.wetness > 0.55) {
      fraction *= 1.25
    }
    // else wetness 0.25~0.55: no adjustment (x1.0)

    // Paired board adjustment (stacks with above)
    if (texture.pairedness === 'paired' || texture.pairedness === 'trips') {
      fraction *= 0.75
    }
  }

  // Strength/bluff adjustment
  if (isBluff) {
    fraction *= 1.15
  } else if (strength > 0.80) {
    fraction *= 1.10
  }

  // Style modifier
  fraction *= styleModifiers[style]

  // Compute raw amount
  const rawAmount = Math.round(pot * fraction)

  // Legal clamping
  if (rawAmount < minRaise) {
    return { action: 'raise', amount: minRaise }
  }
  if (rawAmount > stack) {
    return { action: 'raise', amount: stack }
  }
  return { action: 'raise', amount: rawAmount }
}

/**
 * Returns true if the player is effectively committed and should shove.
 */
export function shouldShove(stack: number, pot: number, currentBet: number): boolean {
  if (stack <= pot + currentBet) return true
  if (stack / Math.max(pot, 1) < 1.5) return true
  return false
}
