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

// ─── Sizing Profiles: per-style, per-scenario bet sizing ───────────────────
// preferred = pot fraction, variance = random jitter range (±)
// GTO uses preferred=0 as sentinel → falls back to geometric bet fraction

interface SizingEntry { preferred: number; variance: number }

interface SizingProfile {
  cbet: SizingEntry;
  valueBet: SizingEntry;
  bluff: SizingEntry;
  raiseVsBet: { multiplier: number; variance: number };
  riverBet: SizingEntry;
}

const SIZING_PROFILES: Record<SystemBotStyle, SizingProfile> = {
  nit:        { cbet: { preferred: 0.33, variance: 0.05 }, valueBet: { preferred: 0.50, variance: 0.08 }, bluff: { preferred: 0.33, variance: 0.05 }, raiseVsBet: { multiplier: 2.5, variance: 0.2 }, riverBet: { preferred: 0.40, variance: 0.08 } },
  tag:        { cbet: { preferred: 0.55, variance: 0.08 }, valueBet: { preferred: 0.67, variance: 0.10 }, bluff: { preferred: 0.55, variance: 0.08 }, raiseVsBet: { multiplier: 2.8, variance: 0.3 }, riverBet: { preferred: 0.67, variance: 0.10 } },
  lag:        { cbet: { preferred: 0.67, variance: 0.10 }, valueBet: { preferred: 0.80, variance: 0.12 }, bluff: { preferred: 1.00, variance: 0.15 }, raiseVsBet: { multiplier: 3.0, variance: 0.3 }, riverBet: { preferred: 0.80, variance: 0.12 } },
  station:    { cbet: { preferred: 0.50, variance: 0.05 }, valueBet: { preferred: 0.50, variance: 0.05 }, bluff: { preferred: 0.50, variance: 0.05 }, raiseVsBet: { multiplier: 2.5, variance: 0.2 }, riverBet: { preferred: 0.50, variance: 0.05 } },
  maniac:     { cbet: { preferred: 0.80, variance: 0.15 }, valueBet: { preferred: 1.20, variance: 0.20 }, bluff: { preferred: 1.50, variance: 0.25 }, raiseVsBet: { multiplier: 3.5, variance: 0.5 }, riverBet: { preferred: 1.50, variance: 0.20 } },
  trapper:    { cbet: { preferred: 0.25, variance: 0.05 }, valueBet: { preferred: 0.33, variance: 0.08 }, bluff: { preferred: 0.50, variance: 0.10 }, raiseVsBet: { multiplier: 2.2, variance: 0.2 }, riverBet: { preferred: 0.33, variance: 0.08 } },
  bully:      { cbet: { preferred: 0.75, variance: 0.12 }, valueBet: { preferred: 1.00, variance: 0.15 }, bluff: { preferred: 1.20, variance: 0.18 }, raiseVsBet: { multiplier: 3.0, variance: 0.4 }, riverBet: { preferred: 1.00, variance: 0.15 } },
  tilter:     { cbet: { preferred: 0.55, variance: 0.10 }, valueBet: { preferred: 0.67, variance: 0.12 }, bluff: { preferred: 0.67, variance: 0.15 }, raiseVsBet: { multiplier: 2.8, variance: 0.4 }, riverBet: { preferred: 0.67, variance: 0.12 } },
  shortstack: { cbet: { preferred: 0.50, variance: 0.08 }, valueBet: { preferred: 0.60, variance: 0.10 }, bluff: { preferred: 0.50, variance: 0.10 }, raiseVsBet: { multiplier: 2.5, variance: 0.3 }, riverBet: { preferred: 0.60, variance: 0.10 } },
  adaptive:   { cbet: { preferred: 0.55, variance: 0.10 }, valueBet: { preferred: 0.67, variance: 0.10 }, bluff: { preferred: 0.67, variance: 0.10 }, raiseVsBet: { multiplier: 2.8, variance: 0.3 }, riverBet: { preferred: 0.67, variance: 0.10 } },
  gto:        { cbet: { preferred: 0, variance: 0 }, valueBet: { preferred: 0, variance: 0 }, bluff: { preferred: 0, variance: 0 }, raiseVsBet: { multiplier: 0, variance: 0 }, riverBet: { preferred: 0, variance: 0 } },
}

function computeTextureAdj(texture: BoardTexture | null): number {
  if (!texture) return 1.0
  let adj = 1.0
  if (texture.flushDraw === 'monotone') adj *= 1.35
  else if (texture.wetness < 0.25) adj *= 0.55
  else if (texture.wetness > 0.55) adj *= 1.25
  if (texture.pairedness === 'paired' || texture.pairedness === 'trips') adj *= 0.75
  return adj
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

  const profile = SIZING_PROFILES[style]

  // GTO / geometric fallback (preferred=0 sentinel)
  if (profile.cbet.preferred === 0) {
    let fraction = geometricBetFraction(pot, stack, streetsRemaining)
    fraction *= computeTextureAdj(texture)
    if (isBluff) fraction *= 1.15
    else if (strength > 0.80) fraction *= 1.10
    const rawAmount = Math.round(pot * fraction)
    if (rawAmount < minRaise) return { action: 'raise', amount: minRaise }
    if (rawAmount > stack) return { action: 'raise', amount: stack }
    return { action: 'raise', amount: rawAmount }
  }

  // Select scenario-appropriate sizing
  const isCbetSpot = streetsRemaining >= 3  // flop with streets ahead
  const isRiver = streetsRemaining === 1
  const scenario = isBluff ? profile.bluff
    : isCbetSpot ? profile.cbet
    : isRiver ? profile.riverBet
    : profile.valueBet

  // Apply random variance for natural sizing variation
  const jitter = (Math.random() * 2 - 1) * scenario.variance
  let fraction = Math.max(0.20, scenario.preferred + jitter)

  // Texture still modulates
  fraction *= computeTextureAdj(texture)

  const rawAmount = Math.round(pot * fraction)

  // Legal clamping
  if (rawAmount < minRaise) return { action: 'raise', amount: minRaise }
  if (rawAmount > stack) return { action: 'raise', amount: stack }
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
