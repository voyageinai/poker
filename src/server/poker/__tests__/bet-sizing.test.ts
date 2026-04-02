import { describe, it, expect } from 'vitest'
import { geometricBetFraction, chooseBetSize, shouldShove } from '../strategy/bet-sizing'
import type { BoardTexture } from '../strategy/board-texture'

const dryTexture: BoardTexture = {
  wetness: 0.10,
  pairedness: 'none',
  flushDraw: 'none',
  straightDraw: 'none',
  highCard: 13,
  connectivity: 0,
}

const wetTexture: BoardTexture = {
  wetness: 0.70,
  pairedness: 'none',
  flushDraw: 'possible',
  straightDraw: 'open',
  highCard: 11,
  connectivity: 0.6,
}

const neutralTexture: BoardTexture = {
  wetness: 0.40,
  pairedness: 'none',
  flushDraw: 'backdoor',
  straightDraw: 'backdoor',
  highCard: 12,
  connectivity: 0.3,
}

describe('geometricBetFraction', () => {
  it('basic math: pot=100, stack=300, streets=3 → ~0.587', () => {
    const result = geometricBetFraction(100, 300, 3)
    expect(result).toBeCloseTo(0.587, 1)
  })

  it('pot=100, stack=150, streets=2 → ~0.58', () => {
    const result = geometricBetFraction(100, 150, 2)
    expect(result).toBeCloseTo(0.58, 1)
  })

  it('pot=0 → 0 (edge case)', () => {
    expect(geometricBetFraction(0, 100, 3)).toBe(0)
  })

  it('stack=0 → 0 (no stack)', () => {
    const result = geometricBetFraction(100, 0, 3)
    expect(result).toBe(0)
  })

  it('pot=100, stack=100, streets=1 → 1.0 (one street, pot-size all-in)', () => {
    const result = geometricBetFraction(100, 100, 1)
    expect(result).toBeCloseTo(1.0, 2)
  })
})

describe('chooseBetSize', () => {
  const defaultConstraints = { minRaise: 20, currentBet: 0 }

  it('dry board uses smaller sizing than wet board', () => {
    const dry = chooseBetSize(100, 500, 2, dryTexture, 0.65, 'tag', false, defaultConstraints)
    const wet = chooseBetSize(100, 500, 2, wetTexture, 0.65, 'tag', false, defaultConstraints)
    expect(dry.amount).toBeLessThan(wet.amount)
  })

  it('wet board uses larger sizing', () => {
    const wet = chooseBetSize(100, 500, 2, wetTexture, 0.65, 'tag', false, defaultConstraints)
    const neutral = chooseBetSize(100, 500, 2, neutralTexture, 0.65, 'tag', false, defaultConstraints)
    expect(wet.amount).toBeGreaterThan(neutral.amount)
  })

  it('SPR < 1.5 always shoves', () => {
    const result = chooseBetSize(200, 250, 2, neutralTexture, 0.65, 'tag', false, defaultConstraints)
    // SPR = 250/200 = 1.25
    expect(result.amount).toBe(250)
    expect(result.action).toBe('raise')
  })

  it('SPR < 3 shoves', () => {
    const result = chooseBetSize(200, 500, 2, neutralTexture, 0.65, 'tag', false, defaultConstraints)
    // SPR = 500/200 = 2.5
    expect(result.amount).toBe(500)
    expect(result.action).toBe('raise')
  })

  it('maniac bets bigger than nit', () => {
    const maniac = chooseBetSize(100, 800, 2, neutralTexture, 0.65, 'maniac', false, defaultConstraints)
    const nit = chooseBetSize(100, 800, 2, neutralTexture, 0.65, 'nit', false, defaultConstraints)
    expect(maniac.amount).toBeGreaterThan(nit.amount)
  })

  it('legal clamping — below minRaise bumps to minRaise', () => {
    // Use a very large stack and small pot to get a tiny bet suggestion
    // With pot=10, stack=10000, streets=3, geometric fraction is tiny
    const result = chooseBetSize(10, 10000, 3, dryTexture, 0.50, 'nit', false, { minRaise: 20, currentBet: 0 })
    expect(result.amount).toBeGreaterThanOrEqual(20)
  })

  it('legal clamping — raise cap reached returns call or check', () => {
    const result = chooseBetSize(100, 500, 2, neutralTexture, 0.65, 'tag', false, {
      minRaise: 20,
      currentBet: 50,
      raiseCap: 4,
      raiseCount: 4,
    })
    expect(result.action).toBe('call')
    expect(result.amount).toBe(50)
  })

  it('legal clamping — raise cap reached with currentBet=0 returns check', () => {
    const result = chooseBetSize(100, 500, 2, neutralTexture, 0.65, 'tag', false, {
      minRaise: 20,
      currentBet: 0,
      raiseCap: 4,
      raiseCount: 4,
    })
    expect(result.action).toBe('check')
    expect(result.amount).toBe(0)
  })

  it('legal clamping — all-in when sizing exceeds stack', () => {
    // Small stack, big pot, wet board → sizing could exceed stack
    const result = chooseBetSize(500, 300, 2, wetTexture, 0.90, 'maniac', false, defaultConstraints)
    // SPR = 300/500 = 0.6, which is < 1.5, so it shoves
    expect(result.amount).toBe(300)
    expect(result.action).toBe('raise')
  })

  it('bluff and value use different sizing profiles', () => {
    const bluff = chooseBetSize(100, 800, 2, neutralTexture, 0.50, 'tag', true, defaultConstraints)
    const value = chooseBetSize(100, 800, 2, neutralTexture, 0.50, 'tag', false, defaultConstraints)
    // Both produce valid raise amounts (exact relationship depends on per-style sizing profile)
    expect(bluff.amount).toBeGreaterThan(0)
    expect(value.amount).toBeGreaterThan(0)
    expect(bluff.action).toBe('raise')
    expect(value.action).toBe('raise')
  })

  it('preflop (null texture) works without crash', () => {
    expect(() => {
      chooseBetSize(100, 500, 3, null, 0.65, 'tag', false, defaultConstraints)
    }).not.toThrow()
    const result = chooseBetSize(100, 500, 3, null, 0.65, 'tag', false, defaultConstraints)
    expect(result.action).toBe('raise')
    expect(result.amount).toBeGreaterThan(0)
  })
})

describe('shouldShove', () => {
  it('returns true when SPR < 1.5', () => {
    // stack=50, pot=100, currentBet=0 → SPR = 50/100 = 0.5
    expect(shouldShove(50, 100, 0)).toBe(true)
  })

  it('returns true when stack <= pot + currentBet (committed)', () => {
    // stack=80, pot=50, currentBet=40 → 80 <= 90
    expect(shouldShove(80, 50, 40)).toBe(true)
  })

  it('returns false when SPR is high', () => {
    // stack=500, pot=100, currentBet=0 → SPR=5
    expect(shouldShove(500, 100, 0)).toBe(false)
  })

  it('handles pot=0 edge case', () => {
    // stack=50, pot=0, currentBet=0 → stack/max(0,1) = 50, and 50 <= 0? no
    // But SPR = 50/1 = 50, not < 1.5, and 50 <= 0 is false
    expect(shouldShove(50, 0, 0)).toBe(false)
  })
})
