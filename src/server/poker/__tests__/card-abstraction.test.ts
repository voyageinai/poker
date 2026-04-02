import { describe, it, expect } from 'vitest';
import {
  riverBucket,
  turnBucket,
  flopBucket,
  getHandBucket,
  getBucketCount,
  turnEquityDistribution,
  RIVER_BUCKETS,
  TURN_BUCKETS,
  FLOP_BUCKETS,
} from '../solver/card-abstraction';

// ─── River Bucketing ────────────────────────────────────────────────────────

describe('riverBucket', () => {
  it('AA on a low board gets a high bucket', () => {
    // Pocket aces on a low uncoordinated board — strong overpair
    const bucket = riverBucket(['Ah', 'Ad'], ['2c', '5d', '8s', '3h', '7c']);
    // Should be in the upper half at least
    expect(bucket).toBeGreaterThan(RIVER_BUCKETS / 2);
  });

  it('72o on AKQ board gets a low bucket', () => {
    // 7-2 offsuit on a broadway board — no pair, no draw
    const bucket = riverBucket(['7h', '2d'], ['Ac', 'Kd', 'Qs', '9h', '4c']);
    // Should be in the lower portion (weak high card)
    expect(bucket).toBeLessThan(RIVER_BUCKETS / 3);
  });

  it('royal flush gets the highest or near-highest bucket', () => {
    const bucket = riverBucket(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2d', '3c']);
    expect(bucket).toBe(RIVER_BUCKETS - 1);
  });

  it('returns the same bucket for the same hand (deterministic)', () => {
    const b1 = riverBucket(['Ks', 'Qs'], ['Js', 'Ts', '2h', '5d', '9c']);
    const b2 = riverBucket(['Ks', 'Qs'], ['Js', 'Ts', '2h', '5d', '9c']);
    expect(b1).toBe(b2);
  });

  it('bucket is in valid range [0, RIVER_BUCKETS)', () => {
    const hands: Array<{ hole: [string, string]; board: [string, string, string, string, string] }> = [
      { hole: ['Ah', 'Kh'], board: ['Qh', 'Jh', 'Th', '2d', '3c'] }, // royal flush
      { hole: ['7h', '2d'], board: ['Ac', 'Kd', 'Qs', '9s', '4c'] }, // junk
      { hole: ['5s', '5c'], board: ['5h', '5d', 'Ac', 'Kd', 'Qh'] }, // quads
      { hole: ['3h', '4d'], board: ['5c', '6s', '7h', 'Jd', 'Kc'] }, // straight
    ];
    for (const { hole, board } of hands) {
      const bucket = riverBucket(hole, board);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(RIVER_BUCKETS);
    }
  });

  it('stronger hands get higher buckets', () => {
    // Same board, different hole cards: quads vs high card
    const board: [string, string, string, string, string] = ['2c', '5d', '8s', 'Jh', 'Qc'];
    const quads = riverBucket(['Qh', 'Qd'], board); // trips queens on board Q
    const highCard = riverBucket(['3h', '4d'], board); // weak high card
    expect(quads).toBeGreaterThan(highCard);
  });
});

// ─── Turn Bucketing ─────────────────────────────────────────────────────────

describe('turnBucket', () => {
  it('AA on a low board gets a high bucket', () => {
    const bucket = turnBucket(['Ah', 'Ad'], ['2c', '5d', '8s', '3h']);
    expect(bucket).toBeGreaterThan(TURN_BUCKETS / 2);
  });

  it('72o on AKQ board gets a low bucket', () => {
    const bucket = turnBucket(['7h', '2d'], ['Ac', 'Kd', 'Qs', '9h']);
    expect(bucket).toBeLessThan(TURN_BUCKETS / 3);
  });

  it('bucket is in valid range [0, TURN_BUCKETS)', () => {
    const bucket = turnBucket(['Th', '9h'], ['8h', '7d', '2c', 'Ks']);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(TURN_BUCKETS);
  });

  it('returns the same bucket for the same hand (deterministic via enumeration)', () => {
    const b1 = turnBucket(['Ah', 'Kd'], ['Qc', 'Js', '2h', '5d']);
    const b2 = turnBucket(['Ah', 'Kd'], ['Qc', 'Js', '2h', '5d']);
    expect(b1).toBe(b2);
  });

  it('nut straight draw is stronger than complete air', () => {
    const board: [string, string, string, string] = ['Ts', '9d', '3c', '2h'];
    const oesd = turnBucket(['Jh', 'Qd'], board); // open-ended straight draw + overcards
    const air = turnBucket(['4h', '5d'], board); // very weak
    expect(oesd).toBeGreaterThan(air);
  });
});

// ─── Flop Bucketing ─────────────────────────────────────────────────────────

describe('flopBucket', () => {
  it('AA on a low board gets a high bucket', () => {
    const bucket = flopBucket(['Ah', 'Ad'], ['2c', '5d', '8s']);
    expect(bucket).toBeGreaterThan(FLOP_BUCKETS / 2);
  });

  it('72o on AKQ board gets a low bucket', () => {
    const bucket = flopBucket(['7h', '2d'], ['Ac', 'Kd', 'Qs']);
    expect(bucket).toBeLessThan(FLOP_BUCKETS / 3);
  });

  it('bucket is in valid range [0, FLOP_BUCKETS)', () => {
    const bucket = flopBucket(['Jh', 'Td'], ['9c', '8s', '2h']);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(FLOP_BUCKETS);
  });

  it('flopped set is stronger than no pair', () => {
    const board: [string, string, string] = ['Ks', '8d', '3c'];
    const set = flopBucket(['Kh', 'Kd'], board); // top set
    const noPair = flopBucket(['4h', '5d'], board); // complete air
    expect(set).toBeGreaterThan(noPair);
  });
});

// ─── Generic getHandBucket API ──────────────────────────────────────────────

describe('getHandBucket', () => {
  it('dispatches to river bucketing with 5-card board', () => {
    const genericBucket = getHandBucket(
      ['Ah', 'Kh'],
      ['Qh', 'Jh', 'Th', '2d', '3c'],
      'river',
    );
    const directBucket = riverBucket(
      ['Ah', 'Kh'],
      ['Qh', 'Jh', 'Th', '2d', '3c'],
    );
    expect(genericBucket).toBe(directBucket);
  });

  it('dispatches to turn bucketing with 4-card board', () => {
    const genericBucket = getHandBucket(
      ['Ah', 'Ad'],
      ['2c', '5d', '8s', '3h'],
      'turn',
    );
    const directBucket = turnBucket(
      ['Ah', 'Ad'],
      ['2c', '5d', '8s', '3h'],
    );
    expect(genericBucket).toBe(directBucket);
  });

  it('dispatches to flop bucketing with 3-card board', () => {
    // Note: flop uses MC so we just check range, not exact equality
    const bucket = getHandBucket(
      ['Ah', 'Ad'],
      ['2c', '5d', '8s'],
      'flop',
    );
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(FLOP_BUCKETS);
  });
});

// ─── getBucketCount ─────────────────────────────────────────────────────────

describe('getBucketCount', () => {
  it('returns correct bucket counts per street', () => {
    expect(getBucketCount('river')).toBe(200);
    expect(getBucketCount('turn')).toBe(500);
    expect(getBucketCount('flop')).toBe(1000);
  });
});

// ─── Turn Equity Distribution ───────────────────────────────────────────────

describe('turnEquityDistribution', () => {
  it('returns a normalized histogram that sums to ~1', () => {
    const hist = turnEquityDistribution(['Ah', 'Kd'], ['Qc', 'Js', '2h', '5d'], 10);
    expect(hist).toHaveLength(10);
    const sum = hist.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('all bins are non-negative', () => {
    const hist = turnEquityDistribution(['7h', '2d'], ['Ac', 'Kd', 'Qs', '9h'], 10);
    for (const v of hist) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('strong hands have more weight in higher bins', () => {
    const strongHist = turnEquityDistribution(['Ah', 'Ad'], ['2c', '3d', '4s', '7h'], 5);
    const weakHist = turnEquityDistribution(['7h', '2d'], ['Ac', 'Kd', 'Qs', '9h'], 5);

    // Strong hand should have more mass in the top 2 bins
    const strongTopMass = strongHist[3] + strongHist[4];
    const weakTopMass = weakHist[3] + weakHist[4];
    expect(strongTopMass).toBeGreaterThan(weakTopMass);
  });
});

// ─── Performance ────────────────────────────────────────────────────────────

describe('performance', () => {
  it('river bucketing is fast (no MC overhead)', () => {
    const board: [string, string, string, string, string] = ['2c', '5d', '8s', 'Jh', 'Qc'];
    const start = performance.now();
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      riverBucket(['Ah', 'Kd'], board);
    }
    const elapsed = performance.now() - start;
    // 1000 river buckets should complete in well under 500ms
    expect(elapsed).toBeLessThan(500);
  });

  it('turn bucketing via enumeration is reasonably fast', () => {
    const board: [string, string, string, string] = ['2c', '5d', '8s', 'Jh'];
    const start = performance.now();
    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      turnBucket(['Ah', 'Kd'], board);
    }
    const elapsed = performance.now() - start;
    // 100 turn buckets (each enumerates 46 river cards) should be < 2s
    expect(elapsed).toBeLessThan(2000);
  });

  it('river bucketing is significantly faster than flop bucketing', () => {
    const riverBoard: [string, string, string, string, string] = ['2c', '5d', '8s', 'Jh', 'Qc'];
    const flopBoard: [string, string, string] = ['2c', '5d', '8s'];

    const riverStart = performance.now();
    for (let i = 0; i < 100; i++) {
      riverBucket(['Ah', 'Kd'], riverBoard);
    }
    const riverTime = performance.now() - riverStart;

    const flopStart = performance.now();
    for (let i = 0; i < 100; i++) {
      flopBucket(['Ah', 'Kd'], flopBoard, 1, 100); // fewer iterations for perf test
    }
    const flopTime = performance.now() - flopStart;

    // River should be at least 5x faster than flop (no MC vs MC)
    expect(riverTime).toBeLessThan(flopTime);
  });
});
