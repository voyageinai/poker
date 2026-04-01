import type { BoardTexture } from './board-texture'
import { geometricBetFraction, shouldShove } from './bet-sizing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BalancedActionRequest {
  street: 'preflop' | 'flop' | 'turn' | 'river'
  board: string[]
  pot: number
  currentBet: number
  toCall: number
  minRaise: number
  stack: number
  initialStack?: number
}

export interface ActionFrequencies {
  raise: number  // 0~1
  call: number   // 0~1
  fold: number   // 0~1
}

export interface BalancedDecision {
  action: 'fold' | 'check' | 'call' | 'raise' | 'allin'
  amount: number
  frequencies: ActionFrequencies
  strength: number
  reasoning: string
}

// ---------------------------------------------------------------------------
// Core GTO-informed calculations
// ---------------------------------------------------------------------------

/**
 * Minimum Defence Frequency.
 * MDF = 1 - betSize / (pot + betSize)
 * The minimum frequency a player must defend to prevent opponent from
 * profiting with any two cards.
 */
export function computeMDF(betSize: number, pot: number): number {
  if (betSize <= 0) return 1.0
  return 1 - betSize / (pot + betSize)
}

/**
 * Value cutoff — hands above this threshold bet for value.
 * valueCutoff = 1 - betSize / (pot + 2 * betSize)
 */
export function computeValueCutoff(betSize: number, pot: number): number {
  if (betSize <= 0) return 0.7
  return 1 - betSize / (pot + 2 * betSize)
}

/**
 * Bluff ratio — for every value bet, this fraction of the betting range
 * should be bluffs to make the opponent indifferent.
 * bluffRatio = betSize / (pot + betSize)
 */
export function computeBluffRatio(betSize: number, pot: number): number {
  if (betSize <= 0) return 0.33
  return betSize / (pot + betSize)
}

// ---------------------------------------------------------------------------
// Main decision function
// ---------------------------------------------------------------------------

export function chooseBalancedAction(
  strength: number,
  req: BalancedActionRequest,
  texture: BoardTexture | null,
  playerCount: number,
): BalancedDecision {
  const { street, pot, toCall, stack } = req
  // Raise cap sentinel: MAX_SAFE_INTEGER signals "no more raises allowed"
  const raiseCapped = req.minRaise > stack * 2
  const minRaise = raiseCapped ? stack : req.minRaise

  // Step 1: Compute SPR
  const spr = stack / Math.max(pot, 1)

  // Step 2: SPR-based simplification — binary decision at low SPR
  if (spr < 2) {
    return lowSPRDecision(strength, req)
  }

  // Step 3: Compute pot odds
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0

  // Step 4: Determine bet size for our range (geometric)
  const streetsLeft = street === 'flop' ? 3 : street === 'turn' ? 2 : 1
  let betFraction = geometricBetFraction(pot, stack, streetsLeft)

  // Texture adjustments
  if (texture) {
    if (texture.wetness < 0.25) betFraction *= 0.60
    if (texture.wetness > 0.55) betFraction *= 1.30
    if (texture.flushDraw === 'monotone') betFraction *= 1.40
    if (texture.pairedness !== 'none') betFraction *= 0.75
  }

  // Step 5: Compute frequencies
  let frequencies: ActionFrequencies

  if (raiseCapped) {
    // Raise cap reached — redistribute raise freq into call/check
    frequencies = toCall > 0
      ? { fold: Math.max(0, 1 - strength), call: Math.min(1, strength), raise: 0 }
      : { fold: 0, call: 1, raise: 0 }
  } else if (toCall === 0) {
    frequencies = computeNoFacingBetFrequencies(strength, pot, betFraction)
  } else {
    frequencies = computeFacingBetFrequencies(strength, pot, toCall)
  }

  // Step 6: Roll for action
  const roll = Math.random()
  let action: BalancedDecision['action']
  let amount: number
  let reasoning: string

  if (roll < frequencies.raise) {
    // Raise path
    let raiseAmount = Math.round(pot * betFraction)
    raiseAmount = Math.max(minRaise, Math.min(stack, raiseAmount))

    // Step 7: Don't leave crumbs
    if (raiseAmount > stack * 0.9) {
      action = 'allin'
      amount = stack
      reasoning = strength >= 0.7 ? 'value shove, no crumbs' : 'bluff shove, committed'
    } else {
      action = 'raise'
      amount = raiseAmount
      reasoning = strength >= 0.7 ? 'value bet top range' : 'bluff bottom range'
    }
  } else if (roll < frequencies.raise + frequencies.call) {
    if (toCall === 0) {
      action = 'check'
      amount = 0
      reasoning = 'check in position'
    } else {
      amount = Math.min(toCall, stack)
      action = 'call'
      reasoning = 'MDF defend'
    }
  } else {
    // Fold path — but can't fold for free
    if (toCall === 0) {
      action = 'check'
      amount = 0
      reasoning = 'check back weak hand'
    } else {
      action = 'fold'
      amount = 0
      reasoning = 'below defence threshold'
    }
  }

  return {
    action,
    amount,
    frequencies,
    strength,
    reasoning,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lowSPRDecision(strength: number, req: BalancedActionRequest): BalancedDecision {
  const { pot, toCall, stack } = req
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0

  if (strength > 0.40) {
    return {
      action: 'allin',
      amount: stack,
      frequencies: { raise: 1, call: 0, fold: 0 },
      strength,
      reasoning: 'low SPR shove',
    }
  }

  if (toCall > 0 && strength > Math.max(0.35, potOdds)) {
    const amount = Math.min(toCall, stack)
    return {
      action: 'call',
      amount,
      frequencies: { raise: 0, call: 1, fold: 0 },
      strength,
      reasoning: 'low SPR call — pot committed',
    }
  }

  // Fold or check
  if (toCall > 0) {
    return {
      action: 'fold',
      amount: 0,
      frequencies: { raise: 0, call: 0, fold: 1 },
      strength,
      reasoning: 'low SPR fold — too weak',
    }
  }

  return {
    action: 'check',
    amount: 0,
    frequencies: { raise: 0, call: 1, fold: 0 },
    strength,
    reasoning: 'low SPR check',
  }
}

function computeNoFacingBetFrequencies(
  strength: number,
  pot: number,
  betFraction: number,
): ActionFrequencies {
  const betSize = pot * betFraction
  const valueCutoff = computeValueCutoff(betSize, pot)
  const bluffRatio = computeBluffRatio(betSize, pot)
  const bluffFloor = bluffRatio * (1 - valueCutoff)

  if (strength >= valueCutoff) {
    // Value range: bet most of the time
    return { raise: 0.85, call: 0.15, fold: 0 }
  } else if (strength < bluffFloor) {
    // Bluff range: bet at reduced bluff frequency
    const raiseFreq = bluffRatio * 0.8
    return { raise: raiseFreq, call: 1 - raiseFreq, fold: 0 }
  } else {
    // Check range: these middling hands check
    return { raise: 0, call: 1.0, fold: 0 }
  }
}

function computeFacingBetFrequencies(
  strength: number,
  pot: number,
  toCall: number,
): ActionFrequencies {
  const mdf = computeMDF(toCall, pot)
  const strengthBasedContinue = strength * 1.2

  let continueFreq = Math.max(mdf, Math.min(1, strengthBasedContinue))

  let raiseFreq: number
  if (strength > 0.80) {
    raiseFreq = 0.35 * continueFreq
  } else if (strength < 0.15 && continueFreq > 0.3) {
    raiseFreq = 0.10
  } else {
    raiseFreq = 0
  }

  let callFreq = continueFreq - raiseFreq
  let foldFreq = 1 - continueFreq

  // Clamp to valid range
  if (foldFreq < 0) foldFreq = 0
  if (callFreq < 0) callFreq = 0

  // Normalize in case of floating point drift
  const total = raiseFreq + callFreq + foldFreq
  if (total > 0 && Math.abs(total - 1) > 0.001) {
    raiseFreq /= total
    callFreq /= total
    foldFreq /= total
  }

  return { raise: raiseFreq, call: callFreq, fold: foldFreq }
}
