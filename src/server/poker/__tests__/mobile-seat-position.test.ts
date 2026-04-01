// src/server/poker/__tests__/mobile-seat-position.test.ts
import { describe, it, expect } from 'vitest';
import { getMobileSeatPosition } from '@/components/table/TableFelt';

describe('getMobileSeatPosition', () => {
  it('distributes 5 opponents across upper arc for 6-max', () => {
    const positions = Array.from({ length: 5 }, (_, i) => getMobileSeatPosition(i, 5));
    for (const pos of positions) {
      expect(pos.y).toBeLessThan(50);
    }
    expect(positions[0].x).toBeLessThan(50);
    expect(positions[4].x).toBeGreaterThan(50);
    expect(positions[2].x).toBeCloseTo(50, 0);
    expect(positions[2].y).toBeLessThan(20);
  });

  it('distributes 8 opponents across upper arc for 9-max', () => {
    const positions = Array.from({ length: 8 }, (_, i) => getMobileSeatPosition(i, 8));
    for (const pos of positions) {
      expect(pos.y).toBeLessThan(50);
    }
    expect(positions[0].x).toBeLessThan(50);
    expect(positions[7].x).toBeGreaterThan(50);
  });

  it('handles single opponent', () => {
    const pos = getMobileSeatPosition(0, 1);
    expect(pos.x).toBeCloseTo(50, 0);
    expect(pos.y).toBeLessThan(20);
  });

  it('no positions overlap for 9-max', () => {
    const positions = Array.from({ length: 8 }, (_, i) => getMobileSeatPosition(i, 8));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThan(5);
      }
    }
  });
});
