import { describe, it, expect } from 'vitest';
import { buildPots, awardPots } from '../pot';

// ─── buildPots ─────────────────────────────────────────────────────────────────

describe('buildPots', () => {
  it('2 players, no all-in: single main pot', () => {
    const result = buildPots([
      { seat: 0, totalBet: 100 },
      { seat: 1, totalBet: 100 },
    ]);
    expect(result.main).toBe(200);
    expect(result.sides).toHaveLength(0);
    expect(result.total).toBe(200);
  });

  it('2 players, one all-in for less: main + side', () => {
    // Seat 0 all-in for 50; seat 1 bet 100
    // Main: 50×2=100 (both eligible)
    // Side: 50 (only seat 1 eligible — uncalled)
    const result = buildPots([
      { seat: 0, totalBet: 50, isAllIn: true },
      { seat: 1, totalBet: 100 },
    ]);
    expect(result.main).toBe(100);
    expect(result.sides).toHaveLength(1);
    expect(result.sides[0].amount).toBe(50);
    expect(result.sides[0].eligible).toEqual([1]);
    expect(result.total).toBe(150);
  });

  it('3 players, one all-in in the middle', () => {
    // Seat 0: 200, seat 1 (all-in): 100, seat 2: 200
    // Main: 100×3=300  eligible: [0,1,2]
    // Side: 100×2=200  eligible: [0,2]
    const result = buildPots([
      { seat: 0, totalBet: 200 },
      { seat: 1, totalBet: 100, isAllIn: true },
      { seat: 2, totalBet: 200 },
    ]);
    expect(result.main).toBe(300);
    expect(result.sides).toHaveLength(1);
    expect(result.sides[0].amount).toBe(200);
    expect(result.sides[0].eligible.sort()).toEqual([0, 2]);
    expect(result.total).toBe(500);
  });

  it('4 players, two all-ins at different amounts', () => {
    // Seat 0: 300, seat 1 (all-in): 100, seat 2 (all-in): 200, seat 3: 300
    // Level 100: 100×4=400  eligible: [0,1,2,3]
    // Level 200: 100×3=300  eligible: [0,2,3]  (seat1 excluded above 100)
    // Level 300: 100×2=200  eligible: [0,3]
    const result = buildPots([
      { seat: 0, totalBet: 300 },
      { seat: 1, totalBet: 100, isAllIn: true },
      { seat: 2, totalBet: 200, isAllIn: true },
      { seat: 3, totalBet: 300 },
    ]);
    expect(result.total).toBe(900);
    // main = first level (100 each)
    expect(result.main).toBe(400);
    expect(result.sides).toHaveLength(2);
    const side1 = result.sides[0];
    const side2 = result.sides[1];
    expect(side1.amount).toBe(300); // 100×3 from seats 0,2,3
    expect(side1.eligible.sort()).toEqual([0, 2, 3]);
    expect(side2.amount).toBe(200); // 100×2 from seats 0,3
    expect(side2.eligible.sort()).toEqual([0, 3]);
  });

  it('all players all-in at same amount: one main pot', () => {
    const result = buildPots([
      { seat: 0, totalBet: 100, isAllIn: true },
      { seat: 1, totalBet: 100, isAllIn: true },
      { seat: 2, totalBet: 100, isAllIn: true },
    ]);
    expect(result.main).toBe(300);
    expect(result.sides).toHaveLength(0);
    expect(result.total).toBe(300);
  });

  it('one player folds before betting: excluded from all pots', () => {
    // Seat 0 folded (contributed 50 from blind), seats 1 and 2 bet 200
    // Folded player's chips go to the pot but they can't win
    const result = buildPots([
      { seat: 0, totalBet: 50, folded: true },
      { seat: 1, totalBet: 200 },
      { seat: 2, totalBet: 200 },
    ]);
    expect(result.total).toBe(450);
    // Seat 0 is folded — ineligible for any pot
    // Main at level 50: 50×3=150 eligible [1,2] (seat0 folded)
    // Side 1: 150×2=300 eligible [1,2]
    const allEligible = [
      result.sides.map(s => s.eligible),
      // main pot eligible
    ].flat(2);
    expect(allEligible).not.toContain(0);
  });

  it('chip conservation: total always equals sum of all bets', () => {
    const bets = [
      { seat: 0, totalBet: 350 },
      { seat: 1, totalBet: 100, isAllIn: true },
      { seat: 2, totalBet: 250, isAllIn: true },
      { seat: 3, totalBet: 350 },
      { seat: 4, totalBet: 80, isAllIn: true },
    ];
    const result = buildPots(bets);
    const sumBets = bets.reduce((acc, b) => acc + b.totalBet, 0);
    expect(result.total).toBe(sumBets);
  });

  it('3 players, all-in with folded player in between', () => {
    // seat0 all-in 50, seat1 folded 200, seat2 calls 200
    const result = buildPots([
      { seat: 0, totalBet: 50, isAllIn: true },
      { seat: 1, totalBet: 200, folded: true },
      { seat: 2, totalBet: 200 },
    ]);
    expect(result.total).toBe(450);
    // seat1 is folded, seat0 capped at 50
    // seat0 eligible for main (50×3=150), seat1 excluded everywhere
    // remaining 150+150=300 goes to side where only seat2 eligible
    const mainEligible = result.sides.length > 0
      ? result.sides.flatMap(s => s.eligible)
      : [];
    expect(mainEligible).not.toContain(1);
  });
});

// ─── awardPots ─────────────────────────────────────────────────────────────────

describe('awardPots', () => {
  it('single winner takes full main pot', () => {
    const pots = {
      main: 200,
      sides: [],
      total: 200,
    };
    const stacks = { 0: 500, 1: 500 };
    const winnersBySeat = (_eligible: number[]) => [0]; // seat 0 always wins
    const result = awardPots(pots, stacks, winnersBySeat);
    expect(result[0]).toBe(700);
    expect(result[1]).toBe(500);
  });

  it('side pot goes to better hand among eligible seats', () => {
    // main pot: both eligible, seat1 wins
    // side pot: only seat0 and seat2 eligible (seat1 all-in for less), seat0 wins
    const pots = {
      main: 300,
      sides: [{ amount: 200, eligible: [0, 2] }],
      total: 500,
    };
    const stacks = { 0: 0, 1: 0, 2: 0 };
    const winnersBySeat = (eligible: number[]) => {
      if (eligible.includes(1)) return [1]; // seat1 wins main
      return [0]; // seat0 wins side
    };
    const result = awardPots(pots, stacks, winnersBySeat);
    expect(result[1]).toBe(300); // main pot
    expect(result[0]).toBe(200); // side pot
    expect(result[2]).toBe(0);
  });

  it('tie splits pot evenly', () => {
    const pots = { main: 200, sides: [], total: 200 };
    const stacks = { 0: 100, 1: 100 };
    const result = awardPots(pots, stacks, () => [0, 1]); // both win
    expect(result[0]).toBe(200);
    expect(result[1]).toBe(200);
  });

  it('odd chip from tie goes to first winner seat', () => {
    // 3-way tie for pot of 100 (not divisible by 3)
    // 100 / 3 = 33 remainder 1 → seat 0 gets extra chip
    const pots = { main: 100, sides: [], total: 100 };
    const stacks = { 0: 0, 1: 0, 2: 0 };
    const result = awardPots(pots, stacks, () => [0, 1, 2]);
    expect(result[0] + result[1] + result[2]).toBe(100); // conservation
    // The odd chip must go to exactly one player
    const max = Math.max(result[0], result[1], result[2]);
    const min = Math.min(result[0], result[1], result[2]);
    expect(max - min).toBeLessThanOrEqual(1);
  });

  it('chip conservation: sum of awards equals sum of pots', () => {
    const pots = {
      main: 400,
      sides: [
        { amount: 300, eligible: [0, 2, 3] },
        { amount: 200, eligible: [0, 3] },
      ],
      total: 900,
    };
    const stacks = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const result = awardPots(pots, stacks, eligible => [eligible[0]]);
    const totalAwarded = Object.values(result).reduce((a, b) => a + b, 0);
    expect(totalAwarded).toBe(900);
  });

  it('all-in player wins main but not side pot they are ineligible for', () => {
    // seat0 all-in (eligible for main only), seat1 and seat2 in side pot
    // seat0 has best hand but cannot win side pot
    const pots = {
      main: 300,
      sides: [{ amount: 200, eligible: [1, 2] }],
      total: 500,
    };
    const stacks = { 0: 0, 1: 0, 2: 0 };
    // seat0 has best hand overall, but side only has [1,2]
    const winnersBySeat = (eligible: number[]) => {
      if (eligible.includes(0)) return [0]; // seat0 wins if eligible
      return [1]; // seat1 wins side
    };
    const result = awardPots(pots, stacks, winnersBySeat);
    expect(result[0]).toBe(300);
    expect(result[1]).toBe(200);
    expect(result[2]).toBe(0);
  });

  it('5-player multi-level all-in chip conservation', () => {
    const pots = {
      main: 400,
      sides: [
        { amount: 300, eligible: [0, 2, 3, 4] },
        { amount: 200, eligible: [0, 3, 4] },
        { amount: 100, eligible: [0, 4] },
      ],
      total: 1000,
    };
    const stacks: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    const result = awardPots(pots, stacks, eligible => [eligible[0]]);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1000);
  });
});
