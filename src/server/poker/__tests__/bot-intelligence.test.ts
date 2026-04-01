import { describe, it, expect } from 'vitest';
import { STYLE_CONFIG_FOR_TEST, calcPosition, getPositionFactor } from '../agents';

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
