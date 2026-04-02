import { describe, it, expect } from 'vitest';
import {
  getPreflopAction,
  preflopHandStrength,
  type Position,
  type SystemBotStyle,
} from '../strategy/preflop-ranges';

// ─── preflopHandStrength ──────────────────────────────────────────────────────

describe('preflopHandStrength', () => {
  it('AA raises from any position for all styles', () => {
    const positions: Position[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
    const styles: SystemBotStyle[] = [
      'nit', 'tag', 'lag', 'station', 'maniac',
      'trapper', 'bully', 'tilter', 'shortstack', 'adaptive', 'gto',
    ];

    for (const pos of positions) {
      for (const style of styles) {
        const result = getPreflopAction(['Ah', 'As'], pos, style, {
          facing3Bet: false,
          raisersAhead: 0,
          stackBB: 100,
        });
        expect(result.action, `AA should raise from ${pos} as ${style}`).toBe('raise');
      }
    }
  });

  it('72o folds from UTG for nit/tag/gto', () => {
    for (const style of ['nit', 'tag', 'gto'] as SystemBotStyle[]) {
      const result = getPreflopAction(['7h', '2d'], 'UTG', style, {
        facing3Bet: false,
        raisersAhead: 0,
        stackBB: 100,
      });
      expect(result.action, `72o should fold from UTG as ${style}`).toBe('fold');
    }
  });

  it('position matters: ATo stronger from BTN than UTG', () => {
    const btnStrength = preflopHandStrength(['Ah', 'Td'], 'BTN', 'gto');
    const utgStrength = preflopHandStrength(['Ah', 'Td'], 'UTG', 'gto');
    expect(btnStrength).toBeGreaterThan(utgStrength);
  });

  it('style matters: JTs from CO — nit folds, lag raises', () => {
    const nitResult = getPreflopAction(['Jh', 'Th'], 'CO', 'nit', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    const lagResult = getPreflopAction(['Jh', 'Th'], 'CO', 'lag', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    expect(nitResult.action).toBe('fold');
    expect(lagResult.action).toBe('raise');
  });

  it('suited bonus: AKs > AKo strength', () => {
    const suited = preflopHandStrength(['Ah', 'Kh'], 'CO', 'gto');
    const offsuit = preflopHandStrength(['Ah', 'Kd'], 'CO', 'gto');
    expect(suited).toBeGreaterThan(offsuit);
  });

  it('facing 3bet tightens range', () => {
    // A hand that would normally raise should fold or call facing a 3bet
    const normal = getPreflopAction(['Ah', '9d'], 'CO', 'tag', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    const facing3Bet = getPreflopAction(['Ah', '9d'], 'CO', 'tag', {
      facing3Bet: true,
      raisersAhead: 1,
      stackBB: 100,
    });

    // The 3bet action should be tighter (fold or call instead of raise)
    const actionRank = (a: string) =>
      a === 'fold' ? 0 : a === 'call' ? 1 : 2;
    expect(actionRank(facing3Bet.action)).toBeLessThanOrEqual(
      actionRank(normal.action),
    );
  });

  it('short stack weakens speculative hands', () => {
    // Suited connector should be weaker with a short stack
    const deepStrength = preflopHandStrength(['7h', '6h'], 'BTN', 'gto');

    // Short stack context affects getPreflopAction
    const deepResult = getPreflopAction(['7h', '6h'], 'BTN', 'gto', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    const shortResult = getPreflopAction(['7h', '6h'], 'BTN', 'gto', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 8,
    });

    const actionRank = (a: string) =>
      a === 'fold' ? 0 : a === 'call' ? 1 : 2;
    expect(actionRank(shortResult.action)).toBeLessThanOrEqual(
      actionRank(deepResult.action),
    );
  });

  it('station calls more than nit', () => {
    // Test a range of marginal hands; station should have more calls
    const marginalHands: [string, string][] = [
      ['Jh', '8d'],
      ['Th', '7d'],
      ['9h', '6d'],
      ['8h', '5d'],
      ['Kh', '3d'],
    ];
    let stationCalls = 0;
    let nitCalls = 0;

    for (const hand of marginalHands) {
      const stationResult = getPreflopAction(hand, 'CO', 'station', {
        facing3Bet: false,
        raisersAhead: 1,
        stackBB: 100,
      });
      const nitResult = getPreflopAction(hand, 'CO', 'nit', {
        facing3Bet: false,
        raisersAhead: 1,
        stackBB: 100,
      });
      if (stationResult.action === 'call' || stationResult.action === 'raise')
        stationCalls++;
      if (nitResult.action === 'call' || nitResult.action === 'raise')
        nitCalls++;
    }
    expect(stationCalls).toBeGreaterThan(nitCalls);
  });

  it('trapper flats medium pairs more than tag facing an open', () => {
    const tagResult = getPreflopAction(['8h', '8d'], 'CO', 'tag', {
      facing3Bet: false,
      raisersAhead: 1,
      stackBB: 100,
      toCallBB: 3,
    });
    const trapperResult = getPreflopAction(['8h', '8d'], 'CO', 'trapper', {
      facing3Bet: false,
      raisersAhead: 1,
      stackBB: 100,
      toCallBB: 3,
    });

    expect(trapperResult.action).toBe('call');
    expect((trapperResult.frequencies?.call ?? 0)).toBeGreaterThan(tagResult.frequencies?.call ?? 0);
    expect((trapperResult.frequencies?.raise ?? 0)).toBeLessThanOrEqual(tagResult.frequencies?.raise ?? 1);
  });

  // ─── Bug fix: position bonus inflation ────────────────────────────────

  it('GTO folds 93o from BB (position bonus must not rescue garbage)', () => {
    const result = getPreflopAction(['9h', '3d'], 'BB', 'gto', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    expect(result.action, 'GTO should fold 93o from BB').toBe('fold');
  });

  it('GTO folds 72o from BB', () => {
    const result = getPreflopAction(['7h', '2d'], 'BB', 'gto', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    expect(result.action, 'GTO should fold 72o from BB').toBe('fold');
  });

  it('TAG folds 84o from BB', () => {
    const result = getPreflopAction(['8h', '4d'], 'BB', 'tag', {
      facing3Bet: false,
      raisersAhead: 0,
      stackBB: 100,
    });
    expect(result.action, 'TAG should fold 84o from BB').toBe('fold');
  });

  // ─── Bug fix: rfiThreshold floor ──────────────────────────────────────

  it('maniac folds at least some garbage facing a raise (rfiThreshold has floor)', () => {
    // Maniac facing an open raise should not 3-bet every garbage hand
    const garbageHands: [string, string][] = [
      ['7h', '2d'], ['8h', '3d'], ['9h', '2c'], ['6h', '2d'], ['5h', '2d'],
    ];
    let folds = 0;
    for (const hand of garbageHands) {
      const result = getPreflopAction(hand, 'CO', 'maniac', {
        facing3Bet: false,
        raisersAhead: 1,
        stackBB: 100,
        toCallBB: 3,
      });
      if (result.action === 'fold') folds++;
    }
    // At least 2 out of 5 garbage hands should fold when facing a raise
    expect(folds, 'Maniac should fold some garbage facing a raise').toBeGreaterThanOrEqual(2);
  });

  // ─── Bug fix: LAG/Maniac multi-raise commitment ──────────────────────

  it('LAG folds 97o facing 4-bet', () => {
    const result = getPreflopAction(['9h', '7d'], 'BB', 'lag', {
      facing3Bet: true,
      raisersAhead: 3,
      stackBB: 100,
      toCallBB: 30,
    });
    expect(result.action, 'LAG should fold 97o facing 4-bet').toBe('fold');
  });

  it('maniac folds 84o facing 3-bet from EP', () => {
    const result = getPreflopAction(['8h', '4d'], 'EP', 'maniac', {
      facing3Bet: true,
      raisersAhead: 2,
      stackBB: 100,
      toCallBB: 15,
    });
    expect(result.action, 'Maniac should fold 84o facing 3-bet from EP').toBe('fold');
  });

  it('position bonus is proportional: garbage gets less than good hands', () => {
    // AJs (strong but not capped) should gain more from position than 72o (junk)
    const ajsUTG = preflopHandStrength(['Ah', 'Jh'], 'UTG', 'gto');
    const ajsBB = preflopHandStrength(['Ah', 'Jh'], 'BB', 'gto');
    const junkUTG = preflopHandStrength(['7h', '2d'], 'UTG', 'gto');
    const junkBB = preflopHandStrength(['7h', '2d'], 'BB', 'gto');

    const ajsDelta = ajsBB - ajsUTG;
    const junkDelta = junkBB - junkUTG;

    // Good hands should benefit MORE from position than junk
    expect(ajsDelta, 'AJs should gain more from position than 72o').toBeGreaterThan(junkDelta);
  });

  it('result always between 0 and 1', () => {
    const positions: Position[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
    const styles: SystemBotStyle[] = ['nit', 'tag', 'lag', 'gto', 'maniac'];
    const hands: [string, string][] = [
      ['Ah', 'As'],
      ['2h', '3d'],
      ['Kh', 'Qh'],
      ['7d', '2c'],
      ['Th', 'Ts'],
    ];

    for (const hand of hands) {
      for (const pos of positions) {
        for (const style of styles) {
          const strength = preflopHandStrength(hand, pos, style);
          expect(strength).toBeGreaterThanOrEqual(0);
          expect(strength).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('maniac plays more hands than nit from BTN', () => {
    const allHands: [string, string][] = [
      ['Ah', 'Kd'], ['Ah', 'Qd'], ['Ah', 'Jd'], ['Ah', 'Td'],
      ['Ah', '9d'], ['Ah', '8d'], ['Ah', '7d'], ['Ah', '6d'],
      ['Kh', 'Qd'], ['Kh', 'Jd'], ['Kh', 'Td'], ['Kh', '9d'],
      ['Qh', 'Jd'], ['Qh', 'Td'], ['Qh', '9d'],
      ['Jh', 'Td'], ['Jh', '9d'], ['Jh', '8d'],
      ['Th', '9d'], ['Th', '8d'],
      ['9h', '8d'], ['9h', '7d'],
      ['8h', '7d'], ['8h', '6d'],
      ['7h', '6d'], ['6h', '5d'],
      ['5h', '4d'], ['4h', '3d'],
    ];

    let maniacPlays = 0;
    let nitPlays = 0;

    for (const hand of allHands) {
      const maniacResult = getPreflopAction(hand, 'BTN', 'maniac', {
        facing3Bet: false,
        raisersAhead: 0,
        stackBB: 100,
      });
      const nitResult = getPreflopAction(hand, 'BTN', 'nit', {
        facing3Bet: false,
        raisersAhead: 0,
        stackBB: 100,
      });
      if (maniacResult.action !== 'fold') maniacPlays++;
      if (nitResult.action !== 'fold') nitPlays++;
    }
    expect(maniacPlays).toBeGreaterThan(nitPlays);
  });

  it('trapper can flat medium premiums facing a single raise', () => {
    const result = getPreflopAction(['9h', '9d'], 'BTN', 'trapper', {
      facing3Bet: false,
      raisersAhead: 1,
      stackBB: 60,
      toCallBB: 2.5,
      potOdds: 0.22,
    });

    expect(result.action).toBe('call');
  });

  it('gto defends suited wheel aces from the big blind', () => {
    const result = getPreflopAction(['Ah', '5h'], 'BB', 'gto', {
      facing3Bet: false,
      raisersAhead: 1,
      stackBB: 60,
      toCallBB: 2,
      potOdds: 0.25,
    });

    expect(result.action).toBe('call');
  });

  it('tag defends suited wheel aces from the big blind', () => {
    const result = getPreflopAction(['Ah', '5h'], 'BB', 'tag', {
      facing3Bet: false,
      raisersAhead: 1,
      stackBB: 60,
      toCallBB: 2,
      potOdds: 0.25,
    });

    expect(result.action).toBe('call');
  });

  it('trapper keeps suited broadways in the flatting bucket from the blinds', () => {
    const result = getPreflopAction(['Qh', 'Jh'], 'BB', 'trapper', {
      facing3Bet: false,
      raisersAhead: 1,
      stackBB: 60,
      toCallBB: 3,
      potOdds: 0.28,
    });

    expect(result.action).toBe('call');
  });
});
