import { describe, it, expect } from 'vitest';
import { STYLE_CONFIG_FOR_TEST, calcPosition, getPositionFactor, getBetSizingMultiplier, detectPatterns, computeExploit, type HandActionRecord } from '../agents';

describe('STYLE_CONFIG intelligence fields', () => {
  const styles = Object.keys(STYLE_CONFIG_FOR_TEST) as Array<keyof typeof STYLE_CONFIG_FOR_TEST>;

  it('should have all 11 bot styles', () => {
    expect(styles).toHaveLength(11);
  });

  for (const field of ['positionSensitivity', 'sizingSensitivity', 'patternSensitivity', 'exploitWeight'] as const) {
    it(`every style has ${field} between 0 and 1`, () => {
      for (const style of styles) {
        const value = (STYLE_CONFIG_FOR_TEST[style] as Record<string, unknown>)[field];
        expect(value, `${style}.${field}`).toBeTypeOf('number');
        expect(value as number, `${style}.${field} >= 0`).toBeGreaterThanOrEqual(0);
        expect(value as number, `${style}.${field} <= 1`).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('Position awareness', () => {
  // 6-player table, seats [0,1,2,3,4,5], button=3
  // Order after button: 4=SB, 5=BB, 0=EP, 1=MP, 2=CO, 3=BTN
  it('calculates BTN position correctly', () => {
    expect(calcPosition(3, 3, [0, 1, 2, 3, 4, 5])).toBe('BTN');
  });

  it('calculates SB position correctly', () => {
    expect(calcPosition(4, 3, [0, 1, 2, 3, 4, 5])).toBe('SB');
  });

  it('calculates BB position correctly', () => {
    expect(calcPosition(5, 3, [0, 1, 2, 3, 4, 5])).toBe('BB');
  });

  it('calculates EP position correctly', () => {
    expect(calcPosition(0, 3, [0, 1, 2, 3, 4, 5])).toBe('EP');
  });

  it('calculates CO position correctly', () => {
    expect(calcPosition(2, 3, [0, 1, 2, 3, 4, 5])).toBe('CO');
  });

  it('handles 3-player table (BTN/SB/BB only)', () => {
    expect(calcPosition(3, 3, [1, 3, 5])).toBe('BTN');
    expect(calcPosition(5, 3, [1, 3, 5])).toBe('SB');
    expect(calcPosition(1, 3, [1, 3, 5])).toBe('BB');
  });

  it('handles 2-player table (heads-up: BTN=SB)', () => {
    expect(calcPosition(0, 0, [0, 3])).toBe('SB');
    expect(calcPosition(3, 0, [0, 3])).toBe('BB');
  });

  it('getPositionFactor returns correct values', () => {
    expect(getPositionFactor('BTN')).toBe(0.08);
    expect(getPositionFactor('CO')).toBe(0.06);
    expect(getPositionFactor('MP')).toBe(0);
    expect(getPositionFactor('EP')).toBe(-0.06);
    expect(getPositionFactor('SB')).toBe(-0.06);
    expect(getPositionFactor('BB')).toBe(-0.02);
  });
});

describe('Bet sizing reads', () => {
  it('small bet (< 0.4 pot) returns < 1.0 multiplier', () => {
    expect(getBetSizingMultiplier(0.2)).toBeCloseTo(0.85, 2);
    expect(getBetSizingMultiplier(0.39)).toBeCloseTo(0.85, 2);
  });

  it('medium bet (0.4-0.8 pot) returns 1.0 multiplier', () => {
    expect(getBetSizingMultiplier(0.5)).toBeCloseTo(1.0, 2);
    expect(getBetSizingMultiplier(0.8)).toBeCloseTo(1.0, 2);
  });

  it('large bet (0.8-1.3 pot) returns > 1.0 multiplier', () => {
    expect(getBetSizingMultiplier(1.0)).toBeCloseTo(1.10, 2);
    expect(getBetSizingMultiplier(1.3)).toBeCloseTo(1.10, 2);
  });

  it('overbet (> 1.3 pot) returns 1.2 multiplier', () => {
    expect(getBetSizingMultiplier(1.5)).toBeCloseTo(1.20, 2);
    expect(getBetSizingMultiplier(3.0)).toBeCloseTo(1.20, 2);
  });

  it('zero bet returns 1.0 (no adjustment)', () => {
    expect(getBetSizingMultiplier(0)).toBeCloseTo(1.0, 2);
  });
});

describe('Multi-street memory', () => {
  it('detects checkThenBet pattern', () => {
    const actions: HandActionRecord = {
      preflop: [],
      flop: [{ seat: 2, action: 'check', amount: 0 }],
      turn: [{ seat: 2, action: 'raise', amount: 100 }],
      river: [],
    };
    const patterns = detectPatterns(2, actions, 'turn');
    expect(patterns.checkThenBet).toBe(true);
  });

  it('detects betBetBet pattern', () => {
    const actions: HandActionRecord = {
      preflop: [{ seat: 1, action: 'raise', amount: 40 }],
      flop: [{ seat: 1, action: 'raise', amount: 80 }],
      turn: [{ seat: 1, action: 'raise', amount: 160 }],
      river: [],
    };
    const patterns = detectPatterns(1, actions, 'turn');
    expect(patterns.betBetBet).toBe(true);
  });

  it('detects checkCheckBet pattern', () => {
    const actions: HandActionRecord = {
      preflop: [],
      flop: [{ seat: 3, action: 'check', amount: 0 }],
      turn: [{ seat: 3, action: 'check', amount: 0 }],
      river: [{ seat: 3, action: 'raise', amount: 200 }],
    };
    const patterns = detectPatterns(3, actions, 'river');
    expect(patterns.checkCheckBet).toBe(true);
  });

  it('counts timesRaised correctly', () => {
    const actions: HandActionRecord = {
      preflop: [{ seat: 1, action: 'raise', amount: 40 }],
      flop: [{ seat: 1, action: 'raise', amount: 80 }, { seat: 1, action: 'raise', amount: 160 }],
      turn: [],
      river: [],
    };
    const patterns = detectPatterns(1, actions, 'flop');
    expect(patterns.timesRaised).toBe(3);
  });

  it('returns no patterns for passive play', () => {
    const actions: HandActionRecord = {
      preflop: [{ seat: 0, action: 'call', amount: 20 }],
      flop: [{ seat: 0, action: 'call', amount: 40 }],
      turn: [{ seat: 0, action: 'call', amount: 80 }],
      river: [],
    };
    const patterns = detectPatterns(0, actions, 'turn');
    expect(patterns.checkThenBet).toBe(false);
    expect(patterns.betBetBet).toBe(false);
    expect(patterns.checkCheckBet).toBe(false);
    expect(patterns.timesRaised).toBe(0);
  });
});

describe('Universal opponent modeling', () => {
  it('exploits calling station (high VPIP, low AF)', () => {
    const result = computeExploit({
      hands: 30, vpipRate: 0.70, pfrRate: 0.10, af: 0.4,
      cbetRate: 0.5, foldToCbetRate: 0.2, wtsdRate: 0.45,
    });
    expect(result.bluffDelta).toBeLessThan(0);
    expect(result.aggressionDelta).toBeGreaterThan(0);
  });

  it('exploits nit (low VPIP)', () => {
    const result = computeExploit({
      hands: 30, vpipRate: 0.15, pfrRate: 0.10, af: 1.5,
      cbetRate: 0.7, foldToCbetRate: 0.5, wtsdRate: 0.20,
    });
    expect(result.bluffDelta).toBeGreaterThan(0);
  });

  it('exploits aggro player (high AF)', () => {
    const result = computeExploit({
      hands: 30, vpipRate: 0.40, pfrRate: 0.30, af: 3.5,
      cbetRate: 0.8, foldToCbetRate: 0.3, wtsdRate: 0.35,
    });
    expect(result.slowplayDelta).toBeGreaterThan(0);
    expect(result.checkRaiseDelta).toBeGreaterThan(0);
  });

  it('returns zero deltas with insufficient hands', () => {
    const result = computeExploit({
      hands: 3, vpipRate: 0.5, pfrRate: 0.5, af: 2.0,
      cbetRate: 0.5, foldToCbetRate: 0.5, wtsdRate: 0.3,
    });
    expect(result.aggressionDelta).toBe(0);
    expect(result.bluffDelta).toBe(0);
    expect(result.callThresholdDelta).toBe(0);
    expect(result.slowplayDelta).toBe(0);
    expect(result.checkRaiseDelta).toBe(0);
  });
});
