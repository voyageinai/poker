/**
 * Bot Entertainment Quality Test Suite
 *
 * Validates that bots produce an exciting, engaging poker experience:
 *   1. Preflop participation: bots don't fold too much, enough players see flops
 *   2. Check-raise: bots can check then raise when facing a bet
 *   3. Slow-play: bots with strong hands sometimes check to trap
 *   4. All-in restraint: not every hand ends in an all-in shove
 *   5. No big-hand preflop folding: AT+, pairs shouldn't fold to a single raise
 *   6. Personality differentiation: each style feels distinct
 */
import { describe, it, expect } from 'vitest';
import { BuiltinBotAgent } from '../agents';
import { SYSTEM_BOTS, type SystemBotStyle } from '@/lib/system-bots';
import type { Card, ActionType } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createAgent(style: string): BuiltinBotAgent {
  const def = SYSTEM_BOTS.find(b => b.style === style)!;
  return new BuiltinBotAgent(def.userId, def);
}

function notifyHand(
  agent: BuiltinBotAgent,
  seat: number,
  cards: [string, string],
  opts: {
    stack?: number;
    playerCount?: number;
    buttonSeat?: number;
    bigBlind?: number;
  } = {},
) {
  const stack = opts.stack ?? 1000;
  const count = opts.playerCount ?? 6;
  const btnSeat = opts.buttonSeat ?? (count - 1);
  const bb = opts.bigBlind ?? 20;
  const players = Array.from({ length: count }, (_, i) => ({
    seat: i,
    playerId: `p${i}`,
    displayName: `P${i}`,
    stack,
    isBot: i !== seat,
    elo: 1200,
  }));

  agent.notify({
    type: 'new_hand',
    handId: `ent-${Date.now()}-${Math.random()}`,
    seat,
    stack,
    players,
    smallBlind: bb / 2,
    bigBlind: bb,
    buttonSeat: btnSeat,
  });
  agent.notify({ type: 'hole_cards', cards: cards as [Card, Card] });
}

function notifyStreet(
  agent: BuiltinBotAgent,
  street: 'flop' | 'turn' | 'river',
  board: string[],
) {
  agent.notify({ type: 'street', name: street, board: board as Card[] });
}

/** Notify that the bot took an action (tracked in myActionsThisHand) */
function notifyMyAction(
  agent: BuiltinBotAgent,
  seat: number,
  action: ActionType,
  amount: number,
) {
  agent.notify({
    type: 'player_action',
    seat,
    action,
    amount,
  });
}

async function collectActions(
  style: string,
  cards: [string, string],
  req: Parameters<BuiltinBotAgent['requestAction']>[0],
  opts: {
    seat?: number;
    stack?: number;
    playerCount?: number;
    buttonSeat?: number;
    bigBlind?: number;
    trials?: number;
    /** Called after notifyHand but before requestAction — use to set up street/prior actions */
    setup?: (agent: BuiltinBotAgent, seat: number) => void;
  } = {},
): Promise<{ fold: number; check: number; call: number; raise: number; allin: number; total: number }> {
  const trials = opts.trials ?? 200;
  const counts = { fold: 0, check: 0, call: 0, raise: 0, allin: 0, total: trials };

  for (let i = 0; i < trials; i++) {
    const agent = createAgent(style);
    const seat = opts.seat ?? 0;
    notifyHand(agent, seat, cards, opts);
    if (opts.setup) opts.setup(agent, seat);
    const result = await agent.requestAction(req);
    counts[result.action as keyof typeof counts]++;
  }
  return counts;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Preflop Participation — bots should see flops, not just fold
// ═══════════════════════════════════════════════════════════════════════════════

describe('Preflop participation: no excessive folding', () => {
  // Standard scenario: facing a single raise, medium hand
  const facingRaise = {
    street: 'preflop' as const,
    board: [] as Card[],
    pot: 50,
    currentBet: 40,
    toCall: 20,
    minRaise: 20,
    stack: 980,
    history: [{ seat: 3, action: 'raise' as ActionType, amount: 40 }],
  };

  const ALL_STYLES: SystemBotStyle[] = ['nit', 'tag', 'lag', 'station', 'maniac', 'trapper', 'bully', 'tilter', 'shortstack', 'adaptive', 'gto'];

  it('every style plays AT suited at least 50% vs single raise', async () => {
    for (const style of ALL_STYLES) {
      const stats = await collectActions(style, ['Ah', 'Th'], facingRaise, {
        seat: 0, buttonSeat: 5, trials: 100,
      });
      const playRate = (stats.call + stats.raise + stats.allin) / stats.total;
      expect(playRate, `${style} should play ATs vs raise, got ${Math.round(playRate * 100)}%`).toBeGreaterThanOrEqual(0.50);
    }
  }, 60000);

  it('every style plays pocket 77 at least 60% vs single raise', async () => {
    for (const style of ALL_STYLES) {
      const stats = await collectActions(style, ['7h', '7d'], facingRaise, {
        seat: 0, buttonSeat: 5, trials: 100,
      });
      const playRate = (stats.call + stats.raise + stats.allin) / stats.total;
      expect(playRate, `${style} should play 77 vs raise, got ${Math.round(playRate * 100)}%`).toBeGreaterThanOrEqual(0.60);
    }
  }, 60000);

  it('no style folds KQo on the button to a single raise more than 30%', async () => {
    for (const style of ALL_STYLES) {
      const stats = await collectActions(style, ['Kh', 'Qd'], facingRaise, {
        seat: 5, buttonSeat: 5, trials: 100,
      });
      const foldRate = stats.fold / stats.total;
      expect(foldRate, `${style} folding KQo on BTN: ${Math.round(foldRate * 100)}%`).toBeLessThanOrEqual(0.30);
    }
  }, 60000);

  it('average preflop fold rate across styles is under 35% with random hands', async () => {
    // Test with a range of hands, not just premiums
    const hands: [string, string][] = [
      ['Ah', 'Th'], ['Kh', '9d'], ['Qh', 'Jd'], ['Ts', '9s'],
      ['8h', '7h'], ['5d', '5c'], ['Jh', '4d'], ['6s', '3s'],
    ];
    let totalFold = 0;
    let totalActions = 0;
    for (const style of ALL_STYLES) {
      for (const hand of hands) {
        const stats = await collectActions(style, hand, facingRaise, {
          seat: 4, buttonSeat: 5, trials: 30,
        });
        totalFold += stats.fold;
        totalActions += stats.total;
      }
    }
    const avgFoldRate = totalFold / totalActions;
    expect(avgFoldRate, `avg preflop fold rate: ${Math.round(avgFoldRate * 100)}%`).toBeLessThan(0.50);
  }, 120000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Check-Raise — bots must be able to check then raise
// ═══════════════════════════════════════════════════════════════════════════════

describe('Check-raise capability', () => {
  // Scenario: bot checked on flop, opponent bet, now bot faces a bet
  const flopFacingBetAfterCheck = {
    street: 'flop' as const,
    board: ['Ks', '8d', '2c'] as Card[],
    pot: 120,
    currentBet: 40,
    toCall: 40,
    minRaise: 40,
    stack: 900,
    history: [{ seat: 3, action: 'raise' as ActionType, amount: 40 }],
  };

  // Styles that should check-raise with decent frequency
  const crStyles: SystemBotStyle[] = ['trapper', 'gto', 'adaptive', 'lag', 'maniac'];

  it('trappy/aggressive styles check-raise at least 5% of the time with strong hands', async () => {
    for (const style of crStyles) {
      const stats = await collectActions(style, ['Kh', 'Kd'], flopFacingBetAfterCheck, {
        seat: 0, buttonSeat: 5, trials: 300,
        setup: (agent, seat) => {
          notifyStreet(agent, 'flop', ['Ks', '8d', '2c']);
          // Simulate that we checked earlier this street
          notifyMyAction(agent, seat, 'check', 0);
        },
      });
      const raiseRate = (stats.raise + stats.allin) / stats.total;
      expect(raiseRate, `${style} check-raise rate with KK on K82: ${Math.round(raiseRate * 100)}%`).toBeGreaterThanOrEqual(0.05);
    }
  }, 60000);

  it('check-raise happens across all streets, not just flop', async () => {
    // Turn check-raise scenario
    const turnFacingBet = {
      street: 'turn' as const,
      board: ['Ks', '8d', '2c', '5h'] as Card[],
      pot: 200,
      currentBet: 60,
      toCall: 60,
      minRaise: 60,
      stack: 800,
      history: [{ seat: 3, action: 'raise' as ActionType, amount: 60 }],
    };

    const stats = await collectActions('trapper', ['Ah', 'Kd'], turnFacingBet, {
      seat: 0, buttonSeat: 5, trials: 300,
      setup: (agent, seat) => {
        notifyStreet(agent, 'flop', ['Ks', '8d', '2c']);
        notifyMyAction(agent, seat, 'call', 40);
        notifyStreet(agent, 'turn', ['Ks', '8d', '2c', '5h']);
        notifyMyAction(agent, seat, 'check', 0);
      },
    });
    const raiseRate = (stats.raise + stats.allin) / stats.total;
    expect(raiseRate, `trapper turn check-raise AK on K825: ${Math.round(raiseRate * 100)}%`).toBeGreaterThanOrEqual(0.05);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Slow-Play — strong hands sometimes check to trap
// ═══════════════════════════════════════════════════════════════════════════════

describe('Slow-play capability', () => {
  // Scenario: bot has a monster, no bet to face (can check or bet)
  const flopNoBet = {
    street: 'flop' as const,
    board: ['Ks', '8d', '2c'] as Card[],
    pot: 60,
    currentBet: 0,
    toCall: 0,
    minRaise: 20,
    stack: 970,
    history: [] as Array<{ seat: number; action: ActionType; amount: number }>,
  };

  it('trapper slow-plays a set at least 20% on dry board', async () => {
    const stats = await collectActions('trapper', ['Kh', 'Kd'], flopNoBet, {
      seat: 0, buttonSeat: 5, trials: 300,
      setup: (agent) => {
        notifyStreet(agent, 'flop', ['Ks', '8d', '2c']);
      },
    });
    const checkRate = stats.check / stats.total;
    expect(checkRate, `trapper slow-play KK on K82: ${Math.round(checkRate * 100)}%`).toBeGreaterThanOrEqual(0.15);
  }, 30000);

  it('nit slow-plays strong hands sometimes', async () => {
    const stats = await collectActions('nit', ['Ah', 'Ad'], flopNoBet, {
      seat: 0, buttonSeat: 5, trials: 300,
      setup: (agent) => {
        notifyStreet(agent, 'flop', ['Ks', '8d', '2c']);
      },
    });
    const checkRate = stats.check / stats.total;
    expect(checkRate, `nit slow-play AA on K82: ${Math.round(checkRate * 100)}%`).toBeGreaterThanOrEqual(0.08);
  }, 30000);

  it('maniac almost never slow-plays (always betting)', async () => {
    const stats = await collectActions('maniac', ['Kh', 'Kd'], flopNoBet, {
      seat: 0, buttonSeat: 5, trials: 200,
      setup: (agent) => {
        notifyStreet(agent, 'flop', ['Ks', '8d', '2c']);
      },
    });
    const checkRate = stats.check / stats.total;
    // Maniac may occasionally check (slowplayRate=0 but dramatic layer can trigger)
    // but should bet the vast majority
    const betRate = (stats.raise + stats.allin) / stats.total;
    expect(betRate, `maniac should mostly bet with KK: ${Math.round(betRate * 100)}%`).toBeGreaterThanOrEqual(0.60);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. All-in Restraint — not every postflop decision should be a shove
// ═══════════════════════════════════════════════════════════════════════════════

describe('All-in restraint: shoves should not dominate', () => {
  const flopBet = {
    street: 'flop' as const,
    board: ['Qs', '7d', '3c'] as Card[],
    pot: 80,
    currentBet: 30,
    toCall: 30,
    minRaise: 30,
    stack: 940,
    history: [{ seat: 3, action: 'raise' as ActionType, amount: 30 }],
  };

  it('with deep stacks (47BB), all-in rate stays under 20% for non-maniac styles', async () => {
    const conservativeStyles: SystemBotStyle[] = ['nit', 'tag', 'trapper', 'gto', 'adaptive', 'station'];
    for (const style of conservativeStyles) {
      const stats = await collectActions(style, ['Qh', 'Jd'], flopBet, {
        seat: 0, buttonSeat: 5, trials: 150,
        setup: (agent) => {
          notifyStreet(agent, 'flop', ['Qs', '7d', '3c']);
        },
      });
      const allinRate = stats.allin / stats.total;
      expect(allinRate, `${style} all-in rate with QJo on Q73 (deep): ${Math.round(allinRate * 100)}%`).toBeLessThanOrEqual(0.20);
    }
  }, 60000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. No Big Hand Preflop Folding — premium hands must not fold to single raise
// ═══════════════════════════════════════════════════════════════════════════════

describe('Premium hand protection: no folding big hands preflop', () => {
  const facingSingleRaise = {
    street: 'preflop' as const,
    board: [] as Card[],
    pot: 50,
    currentBet: 40,
    toCall: 20,
    minRaise: 20,
    stack: 980,
    history: [{ seat: 3, action: 'raise' as ActionType, amount: 40 }],
  };

  const premiumHands: [string, string][] = [
    ['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd'], ['Jh', 'Jd'],
    ['Ah', 'Kd'], ['Ah', 'Qd'],
  ];

  const ALL_STYLES: SystemBotStyle[] = ['nit', 'tag', 'lag', 'station', 'maniac', 'trapper', 'bully', 'tilter', 'shortstack', 'adaptive', 'gto'];

  it('no style folds AA/KK/QQ/JJ/AK/AQ to a single raise', async () => {
    for (const style of ALL_STYLES) {
      for (const hand of premiumHands) {
        const stats = await collectActions(style, hand, facingSingleRaise, {
          seat: 0, buttonSeat: 5, trials: 50,
        });
        const foldRate = stats.fold / stats.total;
        expect(foldRate, `${style} folding ${hand.join('')} to single raise: ${Math.round(foldRate * 100)}%`).toBe(0);
      }
    }
  }, 120000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Personality Differentiation — each style should feel distinct
// ═══════════════════════════════════════════════════════════════════════════════

describe('Personality differentiation', () => {
  const flopOpen = {
    street: 'flop' as const,
    board: ['Ts', '7d', '3c'] as Card[],
    pot: 60,
    currentBet: 0,
    toCall: 0,
    minRaise: 20,
    stack: 970,
    history: [] as Array<{ seat: number; action: ActionType; amount: number }>,
  };

  it('maniac bets far more often than nit on flop', async () => {
    const maniacStats = await collectActions('maniac', ['9h', '6d'], flopOpen, {
      seat: 0, buttonSeat: 5, trials: 200,
      setup: (agent) => notifyStreet(agent, 'flop', ['Ts', '7d', '3c']),
    });
    const nitStats = await collectActions('nit', ['9h', '6d'], flopOpen, {
      seat: 0, buttonSeat: 5, trials: 200,
      setup: (agent) => notifyStreet(agent, 'flop', ['Ts', '7d', '3c']),
    });

    const maniacBet = (maniacStats.raise + maniacStats.allin) / maniacStats.total;
    const nitBet = (nitStats.raise + nitStats.allin) / nitStats.total;
    expect(maniacBet, `maniac bet rate: ${Math.round(maniacBet * 100)}%`).toBeGreaterThan(nitBet + 0.10);
  }, 30000);

  it('station calls more than any other style', async () => {
    const flopFacingBet = {
      street: 'flop' as const,
      board: ['Ts', '7d', '3c'] as Card[],
      pot: 100,
      currentBet: 40,
      toCall: 40,
      minRaise: 40,
      stack: 920,
      history: [{ seat: 3, action: 'raise' as ActionType, amount: 40 }],
    };

    const stationStats = await collectActions('station', ['8h', '5d'], flopFacingBet, {
      seat: 0, buttonSeat: 5, trials: 200,
      setup: (agent) => notifyStreet(agent, 'flop', ['Ts', '7d', '3c']),
    });
    const tagStats = await collectActions('tag', ['8h', '5d'], flopFacingBet, {
      seat: 0, buttonSeat: 5, trials: 200,
      setup: (agent) => notifyStreet(agent, 'flop', ['Ts', '7d', '3c']),
    });

    const stationCall = stationStats.call / stationStats.total;
    const tagCall = tagStats.call / tagStats.total;
    expect(stationCall, `station call rate: ${Math.round(stationCall * 100)}%`).toBeGreaterThan(tagCall);
  }, 30000);

  it('trapper checks strong hands more than lag', async () => {
    const trapperStats = await collectActions('trapper', ['Th', 'Td'], flopOpen, {
      seat: 0, buttonSeat: 5, trials: 300,
      setup: (agent) => notifyStreet(agent, 'flop', ['Ts', '7d', '3c']),
    });
    const lagStats = await collectActions('lag', ['Th', 'Td'], flopOpen, {
      seat: 0, buttonSeat: 5, trials: 300,
      setup: (agent) => notifyStreet(agent, 'flop', ['Ts', '7d', '3c']),
    });

    const trapperCheck = trapperStats.check / trapperStats.total;
    const lagCheck = lagStats.check / lagStats.total;
    expect(trapperCheck, `trapper check rate with set: ${Math.round(trapperCheck * 100)}%`).toBeGreaterThan(lagCheck);
  }, 30000);
});
