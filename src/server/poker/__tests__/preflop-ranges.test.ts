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
});
