import { describe, it, expect } from 'vitest';
import { STYLE_CONFIG_FOR_TEST } from '../agents';

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
