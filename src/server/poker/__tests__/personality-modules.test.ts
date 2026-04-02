import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchPlaybook, type PlaybookContext } from '../strategy/playbook';
import { checkUnconditionalBluff } from '../strategy/unconditional-bluff';
import type { BoardTexture } from '../strategy/board-texture';

const dryTexture: BoardTexture = {
  wetness: 0.10,
  pairedness: 'none',
  flushDraw: 'none',
  straightDraw: 'none',
  highCard: 14,
  connectivity: 0.1,
};

const baseContext: PlaybookContext = {
  street: 'flop',
  position: 'BTN',
  facingAction: 'none',
  opponents: 1,
  stackBB: 50,
  pot: 100,
  stack: 1000,
  toCall: 0,
  minRaise: 20,
  currentBet: 0,
  boardTexture: dryTexture,
  strength: 0.10,
  priorMyActions: [],
  chipAdvantageRatio: 1.0,
  tiltLevel: 0,
  bigBlind: 20,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playbook personality moves', () => {
  it('maniac random_shove ignores hand strength', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const result = matchPlaybook('maniac', baseContext);

    expect(result).not.toBeNull();
    expect(result?.patternName).toBe('random_shove');
    expect(result?.action).toBe('allin');
  });

  it('trapper limp_reraise triggers after limping preflop', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.10);

    const result = matchPlaybook('trapper', {
      ...baseContext,
      street: 'preflop',
      position: 'SB',
      facingAction: 'raise',
      strength: 0.82,
      currentBet: 60,
      toCall: 40,
      priorMyActions: [{ street: 'preflop', action: 'call' }],
    });

    expect(result).not.toBeNull();
    expect(result?.patternName).toBe('limp_reraise');
    expect(result?.action).toBe('raise');
    expect(result?.amount).toBeGreaterThanOrEqual(20);
  });

  it('adaptive pressure_probe opens a low-strength info line in position', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const result = matchPlaybook('adaptive', {
      ...baseContext,
      street: 'flop',
      position: 'BTN',
      facingAction: 'none',
      opponents: 1,
      strength: 0.08,
    });

    expect(result).not.toBeNull();
    expect(result?.patternName).toBe('pressure_probe');
    expect(result?.action).toBe('raise');
  });

  it('gto can show a low-frequency range_small_cbet line', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const result = matchPlaybook('gto', {
      ...baseContext,
      street: 'flop',
      position: 'BTN',
      facingAction: 'none',
      opponents: 1,
      strength: 0.12,
    });

    expect(result).not.toBeNull();
    expect(result?.patternName).toBe('range_small_cbet');
    expect(result?.action).toBe('raise');
    expect(result?.amount).toBeGreaterThanOrEqual(20);
  });
});

describe('unconditional bluff engine', () => {
  it('starts a positional bluff for maniac on a dry button spot', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const result = checkUnconditionalBluff(
      'maniac',
      'BTN',
      'flop',
      dryTexture,
      false,
      false,
      0,
      100,
      1000,
      20,
      0,
      0,
      20,
    );

    expect(result).not.toBeNull();
    expect(result?.source).toBe('positional_bluff');
    expect(result?.action).toBe('raise');
    expect(result?.amount).toBeGreaterThanOrEqual(80);
  });

  it('continues a second barrel when already in a bluff line', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const result = checkUnconditionalBluff(
      'lag',
      'CO',
      'turn',
      dryTexture,
      false,
      true,
      1,
      120,
      900,
      20,
      0,
      0,
      20,
    );

    expect(result).not.toBeNull();
    expect(result?.source).toBe('second_barrel');
  });

  it('station never gets a positional bluff config', () => {
    const result = checkUnconditionalBluff(
      'station',
      'BTN',
      'flop',
      dryTexture,
      false,
      false,
      0,
      100,
      1000,
      20,
      0,
      0,
      20,
    );

    expect(result).toBeNull();
  });
});
