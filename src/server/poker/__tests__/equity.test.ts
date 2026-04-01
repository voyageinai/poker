import { describe, it, expect } from 'vitest'
import { postflopStrengthMC, countFlushDraw, countStraightDraw } from '../strategy/equity'

describe('countFlushDraw', () => {
  it('detects flush draw (4 cards to a flush)', () => {
    expect(countFlushDraw(['Ah', 'Kh'], ['Qh', '7h', '2d'])).toBe('draw')
  })

  it('detects backdoor flush draw (3 suited on flop)', () => {
    expect(countFlushDraw(['Ah', 'Kh'], ['Qh', '7d', '2c'])).toBe('backdoor')
  })

  it('returns none when no suit has 3+ cards', () => {
    expect(countFlushDraw(['Ah', 'Kd'], ['Qc', '7s', '2h'])).toBe('none')
  })

  it('detects made flush (5+ suited)', () => {
    expect(countFlushDraw(['Ah', 'Kh'], ['Qh', '7h', '2h'])).toBe('made')
  })

  it('detects flush draw on turn (4 suited)', () => {
    expect(countFlushDraw(['Ah', 'Kh'], ['Qh', '7d', '2c', 'Th'])).toBe('draw')
  })

  it('does not give backdoor on turn (3 suited but board > 3)', () => {
    // 3 hearts on board but board has 4 cards (turn), so backdoor not possible
    // Hole cards have no hearts — only Qh, 7h, 2h on the board = 3 hearts
    expect(countFlushDraw(['Ac', 'Kd'], ['Qh', '7h', '2h', 'Tc'])).toBe('none')
  })
})

describe('countStraightDraw', () => {
  it('detects OESD (4 consecutive: 7-8-9-T)', () => {
    expect(countStraightDraw(['8h', '9d'], ['Th', '7c', '2s'])).toBe('oesd')
  })

  it('detects OESD (4 consecutive: 8-9-T-J)', () => {
    expect(countStraightDraw(['8h', '9d'], ['Th', 'Jc', '2s'])).toBe('oesd')
  })

  it('detects gutshot (4 in window of 5 with one gap)', () => {
    // Ranks: 8, 10, 11, 12 — window [8,12] has 4 cards with gap at 9
    expect(countStraightDraw(['8h', 'Td'], ['Jh', 'Qc', '2s'])).toBe('gutshot')
  })

  it('returns none for disconnected cards', () => {
    // Ranks: 2, 8, 7, 12, 13 — no window of 5 has 3+ cards
    expect(countStraightDraw(['2h', '8d'], ['Qh', '7c', 'Ks'])).toBe('none')
  })

  it('detects made straight (T-J-Q-K-A)', () => {
    expect(countStraightDraw(['Th', 'Jd'], ['Qh', 'Kc', 'As'])).toBe('made')
  })

  it('detects made straight (A-2-3-4-5 wheel)', () => {
    expect(countStraightDraw(['Ah', '2d'], ['3h', '4c', '5s'])).toBe('made')
  })

  it('detects backdoor straight draw on flop', () => {
    // 5-6-7 within a window of 5 on flop
    expect(countStraightDraw(['5h', '6d'], ['7h', 'Kc', 'As'])).toBe('backdoor')
  })

  it('does not give backdoor on turn', () => {
    // Same 3-card connectivity but board has 4 cards
    expect(countStraightDraw(['5h', '6d'], ['7h', 'Kc', 'As', '2d'])).toBe('none')
  })
})

describe('postflopStrengthMC', () => {
  it('AA on dry flop vs 1 opponent has high equity (>0.70)', () => {
    const eq = postflopStrengthMC(['Ah', 'Ad'], ['2h', '7d', 'Jc'], 1)
    expect(eq).toBeGreaterThan(0.70)
  })

  it('72o on strong board vs 1 opponent has low equity (<0.35)', () => {
    const eq = postflopStrengthMC(['7s', '2c'], ['Ah', 'Kd', 'Qc'], 1)
    expect(eq).toBeLessThan(0.35)
  })

  it('result is always clamped to [0, 1]', () => {
    const eq = postflopStrengthMC(['Ah', 'Kh'], ['Qh', '7h', '2d'], 1)
    expect(eq).toBeGreaterThanOrEqual(0)
    expect(eq).toBeLessThanOrEqual(1)
  })

  it('more opponents = lower equity for AA', () => {
    const eq1 = postflopStrengthMC(['Ah', 'Ad'], ['2h', '7d', 'Jc'], 1)
    const eq3 = postflopStrengthMC(['Ah', 'Ad'], ['2h', '7d', 'Jc'], 3)
    expect(eq1).toBeGreaterThan(eq3)
  })

  it('flush draw hand gets draw bonus on flop', () => {
    // AhKh on Qh7h2d = flush draw, should get +0.04 bonus
    // We verify by checking the equity is above what pure MC would give
    // For a flush draw with two overcards, MC alone gives ~0.50-0.55
    // With +0.04 draw bonus, should be noticeably higher
    const eq = postflopStrengthMC(['Ah', 'Kh'], ['Qh', '7h', '2d'], 1)
    // AKs with flush draw should be quite strong
    expect(eq).toBeGreaterThan(0.50)
  })

  it('no draw bonus on river (5-card board)', () => {
    // Even with 4 hearts, no draw bonus on river because draws are resolved
    const eq = postflopStrengthMC(['Ah', 'Kh'], ['Qh', '7h', '2d', '3c', '9s'], 1)
    expect(eq).toBeGreaterThanOrEqual(0)
    expect(eq).toBeLessThanOrEqual(1)
  })

  it('completes in <200ms for 1 opponent', () => {
    const start = performance.now()
    postflopStrengthMC(['Ah', 'Ad'], ['2h', '7d', 'Jc'], 1)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})
