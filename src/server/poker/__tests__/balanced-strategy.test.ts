import { describe, it, expect } from 'vitest'
import {
  computeMDF,
  computeValueCutoff,
  computeBluffRatio,
  chooseBalancedAction,
} from '../strategy/balanced-strategy'
import type { BoardTexture } from '../strategy/board-texture'
import type { BalancedActionRequest } from '../strategy/balanced-strategy'

function makeReq(overrides: Partial<BalancedActionRequest> = {}): BalancedActionRequest {
  return {
    street: 'flop',
    board: ['Ah', '7d', '2c'],
    pot: 100,
    currentBet: 0,
    toCall: 0,
    minRaise: 20,
    stack: 1000,
    ...overrides,
  }
}

const dryTexture: BoardTexture = {
  wetness: 0.15,
  pairedness: 'none',
  flushDraw: 'none',
  straightDraw: 'none',
  highCard: 14,
  connectivity: 0.1,
}

const wetTexture: BoardTexture = {
  wetness: 0.65,
  pairedness: 'none',
  flushDraw: 'possible',
  straightDraw: 'open',
  highCard: 12,
  connectivity: 0.7,
}

describe('computeMDF', () => {
  it('pot-sized bet → MDF = 0.50', () => {
    expect(computeMDF(100, 100)).toBeCloseTo(0.5, 2)
  })

  it('half-pot bet → MDF ≈ 0.667', () => {
    expect(computeMDF(50, 100)).toBeCloseTo(0.667, 2)
  })

  it('2x pot bet → MDF ≈ 0.333', () => {
    expect(computeMDF(200, 100)).toBeCloseTo(0.333, 2)
  })

  it('zero bet → MDF = 1.0', () => {
    expect(computeMDF(0, 100)).toBe(1.0)
  })
})

describe('computeValueCutoff', () => {
  it('pot-sized bet → valueCutoff ≈ 0.667', () => {
    expect(computeValueCutoff(100, 100)).toBeCloseTo(0.667, 2)
  })

  it('half-pot bet → valueCutoff = 0.75', () => {
    expect(computeValueCutoff(50, 100)).toBeCloseTo(0.75, 2)
  })

  it('zero bet → default 0.7', () => {
    expect(computeValueCutoff(0, 100)).toBe(0.7)
  })
})

describe('computeBluffRatio', () => {
  it('pot-sized bet → bluffRatio = 0.50', () => {
    expect(computeBluffRatio(100, 100)).toBeCloseTo(0.5, 2)
  })

  it('half-pot bet → bluffRatio ≈ 0.333', () => {
    expect(computeBluffRatio(50, 100)).toBeCloseTo(0.333, 2)
  })

  it('zero bet → default 0.33', () => {
    expect(computeBluffRatio(0, 100)).toBeCloseTo(0.33, 2)
  })
})

describe('chooseBalancedAction', () => {
  describe('low SPR', () => {
    it('shoves strong hands when SPR < 2', () => {
      const req = makeReq({ pot: 700, stack: 1000, toCall: 0, minRaise: 40 })
      // SPR = 1000/700 ≈ 1.43
      const decision = chooseBalancedAction(0.60, req, dryTexture, 3)
      expect(decision.action).toBe('allin')
      expect(decision.amount).toBe(1000)
    })

    it('folds weak hands when SPR < 2 and facing a bet', () => {
      const req = makeReq({ pot: 700, stack: 1000, toCall: 200, minRaise: 400 })
      const decision = chooseBalancedAction(0.20, req, dryTexture, 3)
      expect(decision.action).toBe('fold')
      expect(decision.amount).toBe(0)
    })
  })

  describe('no bet facing (toCall = 0)', () => {
    it('strong hand bets for value most of the time', () => {
      const req = makeReq({ toCall: 0, pot: 100, stack: 1000, minRaise: 20 })
      let raises = 0
      const trials = 50
      for (let i = 0; i < trials; i++) {
        const d = chooseBalancedAction(0.85, req, dryTexture, 3)
        if (d.action === 'raise' || d.action === 'allin') raises++
      }
      expect(raises).toBeGreaterThan(trials * 0.6)
    })

    it('medium hand checks most of the time', () => {
      const req = makeReq({ toCall: 0, pot: 100, stack: 1000, minRaise: 20 })
      let checks = 0
      const trials = 50
      for (let i = 0; i < trials; i++) {
        const d = chooseBalancedAction(0.50, req, dryTexture, 3)
        if (d.action === 'check') checks++
      }
      expect(checks).toBeGreaterThan(trials * 0.7)
    })

    it('weak hand sometimes bluffs but mostly checks', () => {
      const req = makeReq({ toCall: 0, pot: 100, stack: 1000, minRaise: 20 })
      let bluffs = 0
      const trials = 100
      for (let i = 0; i < trials; i++) {
        const d = chooseBalancedAction(0.05, req, dryTexture, 3)
        if (d.action === 'raise' || d.action === 'allin') bluffs++
      }
      // bluff rate should be >5% and <50% (randomized, allow variance)
      expect(bluffs).toBeGreaterThan(trials * 0.05)
      expect(bluffs).toBeLessThan(trials * 0.50)
    })
  })

  describe('facing a bet', () => {
    it('defends at approximately MDF', () => {
      const toCall = 50
      const pot = 100
      const mdf = computeMDF(toCall, pot) // ~0.667
      const req = makeReq({ toCall, pot, currentBet: 50, stack: 1000, minRaise: 100 })
      let folds = 0
      const trials = 200
      for (let i = 0; i < trials; i++) {
        const d = chooseBalancedAction(0.55, req, dryTexture, 3)
        if (d.action === 'fold') folds++
      }
      const foldRate = folds / trials
      // Fold rate should be <= (1 - MDF) + tolerance
      expect(foldRate).toBeLessThanOrEqual(1 - mdf + 0.15)
    })

    it('strong hand raises sometimes when facing a bet', () => {
      const req = makeReq({ toCall: 50, pot: 100, currentBet: 50, stack: 1000, minRaise: 100 })
      let raises = 0
      const trials = 50
      for (let i = 0; i < trials; i++) {
        const d = chooseBalancedAction(0.90, req, dryTexture, 3)
        if (d.action === 'raise' || d.action === 'allin') raises++
      }
      expect(raises).toBeGreaterThan(0)
    })
  })

  describe('texture handling', () => {
    it('dry board with texture does not crash', () => {
      const req = makeReq({ toCall: 0, pot: 100, stack: 1000, minRaise: 20 })
      expect(() => chooseBalancedAction(0.50, req, dryTexture, 3)).not.toThrow()
    })

    it('null texture (preflop) works', () => {
      const req = makeReq({ street: 'preflop', board: [], toCall: 20, pot: 30, stack: 1000, minRaise: 40 })
      expect(() => chooseBalancedAction(0.50, req, null, 6)).not.toThrow()
    })
  })

  describe('invariants', () => {
    it('frequencies sum to ~1.0', () => {
      const scenarios = [
        { strength: 0.90, toCall: 0 },
        { strength: 0.50, toCall: 0 },
        { strength: 0.05, toCall: 0 },
        { strength: 0.70, toCall: 50 },
        { strength: 0.30, toCall: 80 },
      ]
      for (const s of scenarios) {
        const req = makeReq({ toCall: s.toCall, pot: 100, currentBet: s.toCall, stack: 1000, minRaise: 20 })
        const d = chooseBalancedAction(s.strength, req, dryTexture, 3)
        const sum = d.frequencies.raise + d.frequencies.call + d.frequencies.fold
        expect(sum).toBeCloseTo(1.0, 2)
      }
    })

    it('does not leave crumbs — goes all-in instead', () => {
      // stack = 110, pot = 100, bet fraction will want ~75 chips
      // 75/110 = 68%, but if raise > 90% of stack, go allin
      // We need a scenario where calculated raise is > 0.9 * stack
      const req = makeReq({ toCall: 0, pot: 200, stack: 110, minRaise: 20 })
      // With pot=200 and stack=110, geometric bet will be large relative to stack
      let allins = 0
      const trials = 50
      for (let i = 0; i < trials; i++) {
        const d = chooseBalancedAction(0.90, req, null, 3)
        if (d.action === 'allin') allins++
      }
      // Most value bets should be all-in here since the raise amount would exceed 90% of stack
      expect(allins).toBeGreaterThan(0)
    })
  })
})
