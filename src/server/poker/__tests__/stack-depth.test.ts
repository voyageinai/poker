import { describe, it, expect } from 'vitest'
import { classifyHand, adjustForStackDepth, shouldPushFold } from '../strategy/stack-depth'

describe('classifyHand', () => {
  it('classifies pocket aces as premium', () => {
    expect(classifyHand(['Ah', 'As'])).toBe('premium')
  })

  it('classifies pocket kings as premium', () => {
    expect(classifyHand(['Kd', 'Kh'])).toBe('premium')
  })

  it('classifies AKo as premium', () => {
    expect(classifyHand(['Ah', 'Kd'])).toBe('premium')
  })

  it('classifies AKs as premium', () => {
    expect(classifyHand(['Ah', 'Ks'])).toBe('premium')
  })

  it('classifies QJo as broadway', () => {
    expect(classifyHand(['Qh', 'Jd'])).toBe('broadway')
  })

  it('classifies TT as broadway', () => {
    expect(classifyHand(['Th', 'Td'])).toBe('broadway')
  })

  it('classifies 55 as small-pair', () => {
    expect(classifyHand(['5h', '5d'])).toBe('small-pair')
  })

  it('classifies 99 as small-pair', () => {
    expect(classifyHand(['9h', '9d'])).toBe('small-pair')
  })

  it('classifies 6h7h as suited-connector', () => {
    expect(classifyHand(['6h', '7h'])).toBe('suited-connector')
  })

  it('classifies 9dTd as suited-connector', () => {
    expect(classifyHand(['9d', 'Td'])).toBe('suited-connector')
  })

  it('classifies 5h7h as suited-gapper', () => {
    expect(classifyHand(['5h', '7h'])).toBe('suited-gapper')
  })

  it('classifies 8cTc as suited-gapper', () => {
    expect(classifyHand(['8c', 'Tc'])).toBe('suited-gapper')
  })

  it('classifies 9h3d as offsuit', () => {
    expect(classifyHand(['9h', '3d'])).toBe('offsuit')
  })

  it('classifies 7h2d as offsuit', () => {
    expect(classifyHand(['7h', '2d'])).toBe('offsuit')
  })
})

describe('adjustForStackDepth — deep stack favors speculative', () => {
  it('small pair gains value at 150BB', () => {
    const raw = 0.5
    const adjusted = adjustForStackDepth(['5h', '5d'], raw, 150)
    expect(adjusted).toBeGreaterThan(raw)
  })

  it('suited connector gains value at 150BB', () => {
    const raw = 0.5
    const adjusted = adjustForStackDepth(['6h', '7h'], raw, 150)
    expect(adjusted).toBeGreaterThan(raw)
  })

  it('broadway loses value at 150BB', () => {
    const raw = 0.5
    const adjusted = adjustForStackDepth(['Ah', 'Td'], raw, 150)
    expect(adjusted).toBeLessThan(raw)
  })
})

describe('adjustForStackDepth — shallow stack favors raw equity', () => {
  it('small pair loses value at 10BB', () => {
    const raw = 0.5
    const adjusted = adjustForStackDepth(['5h', '5d'], raw, 10)
    expect(adjusted).toBeLessThan(raw)
  })

  it('suited connector loses value at 10BB', () => {
    const raw = 0.5
    const adjusted = adjustForStackDepth(['6h', '7h'], raw, 10)
    expect(adjusted).toBeLessThan(raw)
  })

  it('broadway gains value at 10BB', () => {
    const raw = 0.5
    const adjusted = adjustForStackDepth(['Ah', 'Td'], raw, 10)
    expect(adjusted).toBeGreaterThan(raw)
  })
})

describe('adjustForStackDepth — standard depth no change', () => {
  it('any hand at 50BB returns raw strength', () => {
    const raw = 0.65
    expect(adjustForStackDepth(['5h', '5d'], raw, 50)).toBe(raw)
    expect(adjustForStackDepth(['6h', '7h'], raw, 50)).toBe(raw)
    expect(adjustForStackDepth(['Ah', 'Td'], raw, 50)).toBe(raw)
    expect(adjustForStackDepth(['Ah', 'As'], raw, 50)).toBe(raw)
    expect(adjustForStackDepth(['9h', '3d'], raw, 50)).toBe(raw)
  })
})

describe('adjustForStackDepth — premium never changes', () => {
  it('AA at 10BB returns raw strength', () => {
    const raw = 0.85
    expect(adjustForStackDepth(['Ah', 'As'], raw, 10)).toBe(raw)
  })

  it('AA at 150BB returns raw strength', () => {
    const raw = 0.85
    expect(adjustForStackDepth(['Ah', 'As'], raw, 150)).toBe(raw)
  })
})

describe('adjustForStackDepth — clamped to 0~1', () => {
  it('does not exceed 1.0', () => {
    // broadway at 10BB gets +0.03
    const result = adjustForStackDepth(['Qh', 'Jd'], 0.99, 10)
    expect(result).toBeLessThanOrEqual(1.0)
  })

  it('does not go below 0.0', () => {
    // suited connector at 10BB gets -0.06
    const result = adjustForStackDepth(['6h', '7h'], 0.02, 10)
    expect(result).toBeGreaterThanOrEqual(0.0)
  })
})

describe('shouldPushFold', () => {
  it('returns true at 10BB', () => {
    expect(shouldPushFold(10)).toBe(true)
  })

  it('returns true at 14BB', () => {
    expect(shouldPushFold(14)).toBe(true)
  })

  it('returns false at 15BB', () => {
    expect(shouldPushFold(15)).toBe(false)
  })

  it('returns false at 50BB', () => {
    expect(shouldPushFold(50)).toBe(false)
  })
})
