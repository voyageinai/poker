import { afterEach, describe, it, expect, vi } from 'vitest';
import { STYLE_CONFIG_FOR_TEST, calcPosition, getPositionFactor, getBetSizingMultiplier, detectPatterns, computeExploit, countActiveOpponents, type HandActionRecord } from '../agents';
import { postflopStrengthMC } from '../agents';
import { assessHumanSkill, calcHumanPressure } from '../agents';
import type { Card, PbpServerMessage } from '@/lib/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('STYLE_CONFIG intelligence fields', () => {
  const styles = Object.keys(STYLE_CONFIG_FOR_TEST) as Array<keyof typeof STYLE_CONFIG_FOR_TEST>;

  it('should have all 11 bot styles', () => {
    expect(styles).toHaveLength(11);
  });

  for (const field of ['positionSensitivity', 'sizingSensitivity', 'patternSensitivity', 'exploitWeight', 'preflopCommitCap'] as const) {
    it(`every style has ${field} between 0 and 1`, () => {
      for (const style of styles) {
        const value = (STYLE_CONFIG_FOR_TEST[style] as unknown as Record<string, unknown>)[field];
        expect(value, `${style}.${field}`).toBeTypeOf('number');
        expect(value as number, `${style}.${field} >= 0`).toBeGreaterThanOrEqual(0);
        expect(value as number, `${style}.${field} <= 1`).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('Position awareness', () => {
  // 6-player table, seats [0,1,2,3,4,5], button=3
  // Order after button: 4=SB, 5=BB, 0=UTG, 1=MP, 2=CO, 3=BTN
  it('calculates BTN position correctly', () => {
    expect(calcPosition(3, 3, [0, 1, 2, 3, 4, 5])).toBe('BTN');
  });

  it('calculates SB position correctly', () => {
    expect(calcPosition(4, 3, [0, 1, 2, 3, 4, 5])).toBe('SB');
  });

  it('calculates BB position correctly', () => {
    expect(calcPosition(5, 3, [0, 1, 2, 3, 4, 5])).toBe('BB');
  });

  it('calculates UTG position correctly', () => {
    expect(calcPosition(0, 3, [0, 1, 2, 3, 4, 5])).toBe('UTG');
  });

  it('calculates CO position correctly', () => {
    expect(calcPosition(2, 3, [0, 1, 2, 3, 4, 5])).toBe('CO');
  });

  it('handles 3-player table (BTN/SB/BB only)', () => {
    expect(calcPosition(3, 3, [1, 3, 5])).toBe('BTN');
    expect(calcPosition(5, 3, [1, 3, 5])).toBe('SB');
    expect(calcPosition(1, 3, [1, 3, 5])).toBe('BB');
  });

  it('handles 7-player table with distinct UTG, EP, and MP buckets', () => {
    expect(calcPosition(6, 3, [0, 1, 2, 3, 4, 5, 6])).toBe('UTG');
    expect(calcPosition(0, 3, [0, 1, 2, 3, 4, 5, 6])).toBe('EP');
    expect(calcPosition(1, 3, [0, 1, 2, 3, 4, 5, 6])).toBe('MP');
  });

  it('handles 9-player table without collapsing three seats into UTG', () => {
    expect(calcPosition(6, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe('UTG');
    expect(calcPosition(7, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe('EP');
    expect(calcPosition(8, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe('EP');
    expect(calcPosition(0, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe('MP');
    expect(calcPosition(1, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe('MP');
  });

  it('handles 2-player table (heads-up: BTN=SB)', () => {
    expect(calcPosition(0, 0, [0, 3])).toBe('SB');
    expect(calcPosition(3, 0, [0, 3])).toBe('BB');
  });

  it('getPositionFactor returns correct values', () => {
    expect(getPositionFactor('BTN')).toBe(0.08);
    expect(getPositionFactor('CO')).toBe(0.06);
    expect(getPositionFactor('MP')).toBe(0);
    expect(getPositionFactor('EP')).toBe(-0.03);
    expect(getPositionFactor('UTG')).toBe(-0.06);
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

  it('counts only live opponents after folds', () => {
    const actions: HandActionRecord = {
      preflop: [
        { seat: 1, action: 'fold', amount: 0 },
        { seat: 2, action: 'call', amount: 20 },
        { seat: 3, action: 'fold', amount: 0 },
      ],
      flop: [],
      turn: [],
      river: [],
    };

    expect(countActiveOpponents([0, 1, 2, 3, 4, 5], 0, actions)).toBe(3);
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

describe('Monte Carlo postflop equity', () => {
  it('pocket aces on low board has high equity', () => {
    const holeCards: [Card, Card] = ['Ah', 'As'];
    const board: Card[] = ['2c', '7d', '4h'];
    const eq = postflopStrengthMC(holeCards, board, 1);
    expect(eq).toBeGreaterThan(0.75);
  });

  it('72o on AKQ board has low equity', () => {
    const holeCards: [Card, Card] = ['7h', '2d'];
    const board: Card[] = ['Ac', 'Kd', 'Qh'];
    const eq = postflopStrengthMC(holeCards, board, 1);
    expect(eq).toBeLessThan(0.30);
  });

  it('equity decreases with more opponents', () => {
    const holeCards: [Card, Card] = ['Jh', 'Ts'];
    const board: Card[] = ['9c', '3d', '2h'];
    const eq1 = postflopStrengthMC(holeCards, board, 1);
    const eq3 = postflopStrengthMC(holeCards, board, 3);
    expect(eq1).toBeGreaterThan(eq3);
  });

  it('returns value between 0 and 1', () => {
    const holeCards: [Card, Card] = ['5h', '5d'];
    const board: Card[] = ['Tc', '8d', '3h', 'Js'];
    const eq = postflopStrengthMC(holeCards, board, 2);
    expect(eq).toBeGreaterThanOrEqual(0);
    expect(eq).toBeLessThanOrEqual(1);
  });
});

describe('PBP new_hand extension type check', () => {
  it('PbpServerMessage new_hand type includes isBot and elo', () => {
    const msg: PbpServerMessage = {
      type: 'new_hand',
      handId: 'test',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, playerId: 'alice', displayName: 'Alice', stack: 1000, isBot: false, elo: 1200 },
        { seat: 1, playerId: 'bot1', displayName: 'Bot1', stack: 1000, isBot: true },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    };
    expect(msg.players[0].isBot).toBe(false);
    expect(msg.players[0].elo).toBe(1200);
    expect(msg.players[1].isBot).toBe(true);
    expect(msg.players[1].elo).toBeUndefined();
  });
});

describe('GTO bot uses MC equity', () => {
  it('GTO chooseGtoAction uses real equity when board is present', async () => {
    const { BuiltinBotAgent } = await import('../agents');
    const { SYSTEM_BOTS } = await import('@/lib/system-bots');
    const gtoDef = SYSTEM_BOTS.find(b => b.style === 'gto')!;
    const agent = new BuiltinBotAgent('test-user', gtoDef);

    agent.notify({
      type: 'new_hand',
      handId: 'test-1',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, playerId: 'gto', displayName: 'GTO', stack: 1000, isBot: true },
        { seat: 1, playerId: 'opp', displayName: 'Opp', stack: 1000, isBot: true },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    });
    agent.notify({ type: 'hole_cards', cards: ['Ah', 'As'] });
    agent.notify({ type: 'street', name: 'flop', board: ['2c', '7d', '4h'] });

    const result = await agent.requestAction({
      street: 'flop',
      board: ['2c', '7d', '4h'],
      pot: 40,
      currentBet: 0,
      toCall: 0,
      minRaise: 20,
      stack: 980,
      history: [],
    });

    // GTO (balanced strategy v2) with AA on a dry board should have good equity
    expect(result.debug?.equity).toBeGreaterThan(0.5);
    expect(['raise', 'check', 'allin']).toContain(result.action);
  });
});

describe('Builtin bot runtime position wiring', () => {
  it('shortstack uses button and seat to recognize the big blind jam spot', async () => {
    const { BuiltinBotAgent } = await import('../agents');
    const { SYSTEM_BOTS } = await import('@/lib/system-bots');
    const shortstackDef = SYSTEM_BOTS.find(b => b.style === 'shortstack')!;
    const agent = new BuiltinBotAgent('test-user', shortstackDef);

    agent.notify({
      type: 'new_hand',
      handId: 'test-shortstack-bb',
      seat: 5,
      stack: 318,
      players: [
        { seat: 0, playerId: 'p0', displayName: 'P0', stack: 8000, isBot: true },
        { seat: 1, playerId: 'p1', displayName: 'P1', stack: 8000, isBot: true },
        { seat: 2, playerId: 'p2', displayName: 'P2', stack: 8000, isBot: true },
        { seat: 3, playerId: 'p3', displayName: 'P3', stack: 8000, isBot: true },
        { seat: 4, playerId: 'p4', displayName: 'P4', stack: 9377, isBot: true },
        { seat: 5, playerId: 'hero', displayName: 'Hero', stack: 318, isBot: true },
        { seat: 6, playerId: 'p6', displayName: 'P6', stack: 16956, isBot: true },
        { seat: 7, playerId: 'p7', displayName: 'P7', stack: 8000, isBot: true },
        { seat: 8, playerId: 'p8', displayName: 'P8', stack: 8000, isBot: true },
      ],
      smallBlind: 50,
      bigBlind: 100,
      buttonSeat: 3,
    });
    agent.notify({ type: 'hole_cards', cards: ['8h', '6h'] });

    const result = await agent.requestAction({
      street: 'preflop',
      board: [],
      pot: 200,
      currentBet: 237,
      toCall: 137,
      minRaise: 137,
      stack: 318,
      initialStack: 418,
      history: [{ seat: 4, action: 'raise', amount: 237 }],
    });

    expect(result.action).toBe('allin');
    expect(result.debug?.reasoning).toContain('短码模式');
  });

  it('nit can defend the big blind when the runtime seat mapping is correct', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const { BuiltinBotAgent } = await import('../agents');
    const { SYSTEM_BOTS } = await import('@/lib/system-bots');
    const nitDef = SYSTEM_BOTS.find(b => b.style === 'nit')!;
    const agent = new BuiltinBotAgent('test-user', nitDef);

    agent.notify({
      type: 'new_hand',
      handId: 'test-nit-bb',
      seat: 5,
      stack: 1500,
      players: [
        { seat: 0, playerId: 'p0', displayName: 'P0', stack: 8000, isBot: true },
        { seat: 1, playerId: 'p1', displayName: 'P1', stack: 8000, isBot: true },
        { seat: 2, playerId: 'p2', displayName: 'P2', stack: 8000, isBot: true },
        { seat: 3, playerId: 'p3', displayName: 'P3', stack: 8000, isBot: true },
        { seat: 4, playerId: 'p4', displayName: 'P4', stack: 9377, isBot: true },
        { seat: 5, playerId: 'hero', displayName: 'Hero', stack: 1500, isBot: true },
        { seat: 6, playerId: 'p6', displayName: 'P6', stack: 16956, isBot: true },
        { seat: 7, playerId: 'p7', displayName: 'P7', stack: 8000, isBot: true },
        { seat: 8, playerId: 'p8', displayName: 'P8', stack: 8000, isBot: true },
      ],
      smallBlind: 50,
      bigBlind: 100,
      buttonSeat: 3,
    });
    agent.notify({ type: 'hole_cards', cards: ['Qh', '9d'] });

    const result = await agent.requestAction({
      street: 'preflop',
      board: [],
      pot: 200,
      currentBet: 237,
      toCall: 137,
      minRaise: 137,
      stack: 1500,
      initialStack: 1500,
      history: [{ seat: 4, action: 'raise', amount: 237 }],
    });

    expect(result.action).toBe('call');
    expect(result.debug?.reasoning).toContain('preflop BB');
  });
});

describe('Human pressure module', () => {
  describe('assessHumanSkill', () => {
    it('low elo = low skill', () => {
      expect(assessHumanSkill(1050, undefined)).toBe('low');
    });
    it('high elo = high skill', () => {
      expect(assessHumanSkill(1500, undefined)).toBe('high');
    });
    it('default elo = mid skill', () => {
      expect(assessHumanSkill(1200, undefined)).toBe('mid');
    });
    it('high VPIP with enough hands = low skill regardless of elo', () => {
      const stats = { hands: 25, vpipRate: 0.60, af: 0.8 };
      expect(assessHumanSkill(1250, stats)).toBe('low');
    });
    it('good stats with high elo = high skill', () => {
      const stats = { hands: 25, vpipRate: 0.30, af: 2.0 };
      expect(assessHumanSkill(1450, stats)).toBe('high');
    });
  });

  describe('calcHumanPressure', () => {
    it('returns higher pressure for low skill', () => {
      const low = calcHumanPressure('low', 'tag');
      const high = calcHumanPressure('high', 'tag');
      expect(low).toBeGreaterThan(high);
    });
    it('caps pressure for station at 0.05', () => {
      const p = calcHumanPressure('low', 'station');
      expect(p).toBeLessThanOrEqual(0.05);
    });
    it('caps pressure for maniac at 0.05', () => {
      const p = calcHumanPressure('low', 'maniac');
      expect(p).toBeLessThanOrEqual(0.05);
    });
    it('allows higher cap for nit (0.12)', () => {
      const p = calcHumanPressure('low', 'nit');
      expect(p).toBeLessThanOrEqual(0.12);
      expect(p).toBeGreaterThan(0.05);
    });
    it('always returns a non-negative value', () => {
      expect(calcHumanPressure('high', 'gto')).toBeGreaterThanOrEqual(0);
    });
  });
});
