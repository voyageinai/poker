import { describe, it, expect } from 'vitest';
import { analyzeBoard } from '../strategy/board-texture';

// ─── analyzeBoard ────────────────────────────────────────────────────────────

describe('analyzeBoard', () => {
  // 1. Dry rainbow flop
  it('dry rainbow flop K72r', () => {
    const t = analyzeBoard(['Ks', '7d', '2c']);
    expect(t.wetness).toBeLessThan(0.25);
    expect(t.pairedness).toBe('none');
    expect(t.flushDraw).toBe('none');
    expect(t.straightDraw === 'none' || t.straightDraw === 'backdoor').toBe(true);
    expect(t.highCard).toBe(13);
  });

  // 2. Wet suited connected flop
  it('wet suited connected flop JT9hh', () => {
    const t = analyzeBoard(['Jh', 'Th', '9h']);
    expect(t.wetness).toBeGreaterThan(0.55);
    expect(t.flushDraw).toBe('monotone');
    expect(t.straightDraw).toBe('connected');
    expect(t.highCard).toBe(11);
  });

  // 3. Paired dry flop
  it('paired dry flop 882', () => {
    const t = analyzeBoard(['8s', '8d', '2c']);
    expect(t.pairedness).toBe('paired');
    // Wetness should include pair component (0.10)
    expect(t.wetness).toBeGreaterThanOrEqual(0.10);
  });

  // 4. Trips flop
  it('trips flop AAA', () => {
    const t = analyzeBoard(['Ah', 'Ad', 'Ac']);
    expect(t.pairedness).toBe('trips');
  });

  // 5. Two-tone flop with straight draw
  it('two-tone flop with straight draw 9h8h6d', () => {
    const t = analyzeBoard(['9h', '8h', '6d']);
    expect(t.flushDraw).toBe('backdoor');
    expect(t.straightDraw).toBe('open');
  });

  // 6. Monotone flop
  it('monotone flop AK2 all hearts', () => {
    const t = analyzeBoard(['Ah', 'Kh', '2h']);
    expect(t.flushDraw).toBe('monotone');
  });

  // 7. Turn with flush draw (3 of same suit on 4-card board)
  it('turn with flush draw Ks7s2d9s', () => {
    const t = analyzeBoard(['Ks', '7s', '2d', '9s']);
    expect(t.flushDraw).toBe('possible');
  });

  // 8. River full board straight
  it('river full board AKQJT', () => {
    const t = analyzeBoard(['As', 'Kd', 'Qh', 'Jc', 'Ts']);
    expect(t.straightDraw).toBe('connected');
    expect(t.connectivity).toBeGreaterThan(0.8);
  });

  // 9. Empty board
  it('empty board returns defaults', () => {
    const t = analyzeBoard([]);
    expect(t.wetness).toBe(0);
    expect(t.pairedness).toBe('none');
    expect(t.flushDraw).toBe('none');
    expect(t.straightDraw).toBe('none');
    expect(t.highCard).toBe(0);
    expect(t.connectivity).toBe(0);
  });

  // 10. High card detection
  it('high card detection with Ace', () => {
    const t = analyzeBoard(['2c', '3d', 'Ah']);
    expect(t.highCard).toBe(14);
  });

  // 11. Connectivity tests
  it('low connectivity for disconnected board', () => {
    const t = analyzeBoard(['2c', '7d', 'Kh']);
    expect(t.connectivity).toBeLessThan(0.1);
  });

  it('high connectivity for connected board', () => {
    const t = analyzeBoard(['7c', '8d', '9h']);
    expect(t.connectivity).toBe(1.0);
  });

  // ─── Additional edge cases ──────────────────────────────────────────────────

  it('wetness is clamped to [0, 1]', () => {
    // Monotone + connected + trips = 0.4 + 0.35 + 0.15 = 0.90, under cap
    // Just verify it never exceeds 1
    const t = analyzeBoard(['5h', '6h', '7h']); // monotone + connected
    expect(t.wetness).toBeLessThanOrEqual(1);
    expect(t.wetness).toBeGreaterThanOrEqual(0);
  });

  it('wheel straight draw (A-2-3-4-5 window)', () => {
    const t = analyzeBoard(['Ah', '2d', '3c']);
    // A-2-3 should be 3 in the A-5 window => open
    expect(t.straightDraw).toBe('open');
  });

  it('four-card board with pair', () => {
    const t = analyzeBoard(['Qs', 'Qd', '7h', '3c']);
    expect(t.pairedness).toBe('paired');
    expect(t.flushDraw).toBe('none');
  });

  it('five-card monotone board', () => {
    const t = analyzeBoard(['2h', '5h', '8h', 'Jh', 'Ah']);
    expect(t.flushDraw).toBe('monotone');
  });
});
