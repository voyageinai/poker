import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BuiltinBotAgent,
  STYLE_CONFIG_FOR_TEST,
  chooseBuiltinActionForTest,
  computePersonalityThinkTime,
  resolveAdaptivePersonality,
} from '../agents';
import { SYSTEM_BOTS } from '@/lib/system-bots';
import type { BoardTexture } from '../strategy/board-texture';

const dryTexture: BoardTexture = {
  wetness: 0.10,
  pairedness: 'none',
  flushDraw: 'none',
  straightDraw: 'none',
  highCard: 14,
  connectivity: 0.1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('heuristic personality lines', () => {
  it('trapper can slowplay below the old nuts-only gate', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const action = chooseBuiltinActionForTest(
      'trapper',
      0.62,
      0,
      {
        street: 'turn',
        board: ['Ah', '9d', '4c', '2s'],
        pot: 120,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 880,
        history: [],
      },
      STYLE_CONFIG_FOR_TEST.trapper,
      dryTexture,
      0,
      {
        checkedThisStreet: false,
        dryBoard: true,
        wetBoard: false,
        latePosition: true,
      },
    );

    expect(action.action).toBe('check');
  });

  it('maniac fallback can bluff pure air when checked to', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const action = chooseBuiltinActionForTest(
      'maniac',
      0.02,
      0,
      {
        street: 'flop',
        board: ['As', '9c', '2d'],
        pot: 60,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 960,
        history: [],
      },
      STYLE_CONFIG_FOR_TEST.maniac,
      dryTexture,
      0,
      {
        checkedThisStreet: false,
        dryBoard: true,
        wetBoard: false,
        latePosition: true,
      },
    );

    expect(['raise', 'allin']).toContain(action.action);
  });

  it('trapper can bluff check-raise after checking', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const action = chooseBuiltinActionForTest(
      'trapper',
      0.12,
      0.22,
      {
        street: 'turn',
        board: ['Ks', '8d', '2c', '4h'],
        pot: 180,
        currentBet: 40,
        toCall: 40,
        minRaise: 40,
        stack: 820,
        history: [{ seat: 1, action: 'raise', amount: 40 }],
      },
      STYLE_CONFIG_FOR_TEST.trapper,
      dryTexture,
      0,
      {
        checkedThisStreet: true,
        dryBoard: true,
        wetBoard: false,
        latePosition: false,
      },
    );

    expect(['raise', 'allin']).toContain(action.action);
  });
});

describe('adaptive mirroring', () => {
  it('uses an exploratory pressure style before enough hands accumulate', () => {
    const plan = resolveAdaptivePersonality({
      hands: 4,
      vpipRate: 0.38,
      pfrRate: 0.18,
      af: 1.1,
      cbetRate: 0.48,
      foldToCbetRate: 0.38,
      wtsdRate: 0.30,
    }, 1.0);

    expect(plan.mimicStyle).toBe('lag');
  });

  it('uses bully pressure as exploratory default with a chip lead', () => {
    const plan = resolveAdaptivePersonality({
      hands: 4,
      vpipRate: 0.38,
      pfrRate: 0.18,
      af: 1.1,
      cbetRate: 0.48,
      foldToCbetRate: 0.38,
      wtsdRate: 0.30,
    }, 1.35);

    expect(plan.mimicStyle).toBe('bully');
  });

  it('targets maniac pressure against tight opponents', () => {
    const plan = resolveAdaptivePersonality({
      hands: 40,
      vpipRate: 0.12,
      pfrRate: 0.08,
      af: 1.1,
      cbetRate: 0.45,
      foldToCbetRate: 0.72,
      wtsdRate: 0.18,
    }, 1.0);

    expect(plan.mimicStyle).toBe('maniac');
  });

  it('targets trapper lines against aggro opponents', () => {
    const plan = resolveAdaptivePersonality({
      hands: 32,
      vpipRate: 0.42,
      pfrRate: 0.28,
      af: 3.6,
      cbetRate: 0.74,
      foldToCbetRate: 0.33,
      wtsdRate: 0.31,
    }, 1.0);

    expect(plan.mimicStyle).toBe('trapper');
  });

  it('attacks tight-aggressive opponents instead of defaulting to trapper', () => {
    const plan = resolveAdaptivePersonality({
      hands: 24,
      vpipRate: 0.22,
      pfrRate: 0.18,
      af: 3.1,
      cbetRate: 0.68,
      foldToCbetRate: 0.52,
      wtsdRate: 0.19,
    }, 1.0);

    expect(plan.mimicStyle).toBe('lag');
  });

  it('adaptive agent explains the mirrored style in debug output', async () => {
    const def = SYSTEM_BOTS.find(bot => bot.style === 'adaptive')!;
    const agent = new BuiltinBotAgent(def.userId, def);

    for (let i = 0; i < 9; i++) {
      agent.notify({
        type: 'new_hand',
        handId: `h-${i}`,
        seat: 0,
        stack: 1000,
        players: [
          { seat: 0, playerId: 'p0', displayName: 'P0', stack: 1000, isBot: true },
          { seat: 1, playerId: 'p1', displayName: 'P1', stack: 1000, isBot: true },
          { seat: 2, playerId: 'p2', displayName: 'P2', stack: 1000, isBot: true },
        ],
        smallBlind: 10,
        bigBlind: 20,
        buttonSeat: 2,
      });
    }

    agent.notify({ type: 'hole_cards', cards: ['7h', '3d'] });
    agent.notify({ type: 'street', name: 'flop', board: ['As', '9c', '2d'] });

    const action = await agent.requestAction({
      street: 'flop',
      board: ['As', '9c', '2d'],
      pot: 60,
      currentBet: 0,
      toCall: 0,
      minRaise: 20,
      stack: 960,
      history: [],
    });

    expect(action.debug?.reasoning).toContain('变色龙→张飞');
    expect(action.debug?.thinkMs).toBeTypeOf('number');
    expect(action.debug?.thinkMs).toBeGreaterThanOrEqual(0);
  });
});

describe('personality timing', () => {
  const req = {
    street: 'river' as const,
    board: ['As', '9c', '2d', '7h', '3s'],
    pot: 240,
    currentBet: 80,
    toCall: 80,
    minRaise: 80,
    stack: 720,
    history: [{ seat: 1, action: 'raise' as const, amount: 80 }],
  };

  it('nit thinks longer than maniac in the same spot', () => {
    const nitMs = computePersonalityThinkTime('nit', { action: 'call' }, req, 0.5);
    const maniacMs = computePersonalityThinkTime('maniac', { action: 'call' }, req, 0.5);

    expect(nitMs).toBeGreaterThan(maniacMs);
  });

  it('maniac jams faster while nit tanks longer before all-in', () => {
    const maniacJam = computePersonalityThinkTime('maniac', { action: 'allin' }, req, 0.5);
    const nitJam = computePersonalityThinkTime('nit', { action: 'allin' }, req, 0.5);

    expect(maniacJam).toBeLessThan(nitJam);
  });
});
