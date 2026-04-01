import { describe, it, expect } from 'vitest';
import { BuiltinBotAgent } from '../agents';
import { SYSTEM_BOTS } from '@/lib/system-bots';

function createAgent(style: string): BuiltinBotAgent {
  const def = SYSTEM_BOTS.find(b => b.style === style)!;
  return new BuiltinBotAgent(def.userId, def);
}

function notifyNewHand(agent: BuiltinBotAgent, seat: number, stack: number, buttonSeat: number): void {
  agent.notify({
    type: 'new_hand',
    handId: `hand-${Date.now()}-${Math.random()}`,
    seat,
    stack,
    players: [
      { seat: 0, displayName: 'P0', stack: 1000, isBot: true },
      { seat: 1, displayName: 'P1', stack: 1000, isBot: false, elo: 1100 },
      { seat: 2, displayName: 'P2', stack: 1000, isBot: true },
    ],
    smallBlind: 10,
    bigBlind: 20,
    buttonSeat,
  });
}

describe('Bot integration', () => {
  it('all 11 bot styles produce valid actions preflop', async () => {
    for (const def of SYSTEM_BOTS) {
      const agent = new BuiltinBotAgent(def.userId, def);
      notifyNewHand(agent, 0, 1000, 2);
      agent.notify({ type: 'hole_cards', cards: ['Ah', 'Kd'] });

      const action = await agent.requestAction({
        street: 'preflop',
        board: [],
        pot: 30,
        currentBet: 20,
        toCall: 20,
        minRaise: 20,
        stack: 980,
        history: [{ seat: 1, action: 'call', amount: 20 }],
      });

      expect(['fold', 'check', 'call', 'raise', 'allin']).toContain(action.action);
      expect(action.debug).toBeDefined();
      expect(action.debug!.reasoning).toContain(def.name);
    }
  });

  it('all 11 bot styles produce valid actions postflop', async () => {
    for (const def of SYSTEM_BOTS) {
      const agent = new BuiltinBotAgent(def.userId, def);
      notifyNewHand(agent, 0, 1000, 2);
      agent.notify({ type: 'hole_cards', cards: ['Td', 'Tc'] });
      agent.notify({ type: 'street', name: 'flop', board: ['2h', '7d', 'Jc'] });

      const action = await agent.requestAction({
        street: 'flop',
        board: ['2h', '7d', 'Jc'],
        pot: 60,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 960,
        history: [],
      });

      expect(['fold', 'check', 'call', 'raise', 'allin']).toContain(action.action);
      expect(action.debug).toBeDefined();
    }
  }, 30000);

  it('nit folds weak hands more than maniac', async () => {
    const trials = 20;
    let nitFolds = 0;
    let maniacFolds = 0;

    for (let i = 0; i < trials; i++) {
      const nit = createAgent('nit');
      const maniac = createAgent('maniac');

      for (const agent of [nit, maniac]) {
        notifyNewHand(agent, 0, 1000, 2);
        agent.notify({ type: 'hole_cards', cards: ['8h', '3d'] });
      }

      const nitAction = await nit.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 20, minRaise: 20, stack: 980,
        history: [{ seat: 1, action: 'raise', amount: 60 }],
      });

      const maniacAction = await maniac.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 20, minRaise: 20, stack: 980,
        history: [{ seat: 1, action: 'raise', amount: 60 }],
      });

      if (nitAction.action === 'fold') nitFolds++;
      if (maniacAction.action === 'fold') maniacFolds++;
    }

    expect(nitFolds).toBeGreaterThan(maniacFolds);
  });

  it('maniac bluffs postflop on dry board with air', async () => {
    const trials = 40;
    let betCount = 0;

    for (let i = 0; i < trials; i++) {
      const maniac = createAgent('maniac');
      notifyNewHand(maniac, 0, 1000, 2);
      maniac.notify({ type: 'hole_cards', cards: ['2s', '5s'] });
      maniac.notify({ type: 'street', name: 'flop', board: ['Ah', '9d', '2c'] });

      const action = await maniac.requestAction({
        street: 'flop',
        board: ['Ah', '9d', '2c'],
        pot: 60,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 960,
        history: [],
      });

      if (action.action === 'raise' || action.action === 'allin') betCount++;
    }

    // Maniac (bluffRate 0.18, looseness 0.82) should bluff sometimes with air
    expect(betCount).toBeGreaterThan(0);
  }, 30000);

  it('adaptive bets two pair for value on paired board', async () => {
    const trials = 40;
    let betCount = 0;

    for (let i = 0; i < trials; i++) {
      const adaptive = createAgent('adaptive');
      notifyNewHand(adaptive, 0, 1000, 2);
      adaptive.notify({ type: 'hole_cards', cards: ['Kc', '6s'] });
      adaptive.notify({ type: 'street', name: 'turn', board: ['Ad', '9h', '9c', 'Ks'] });

      const action = await adaptive.requestAction({
        street: 'turn',
        board: ['Ad', '9h', '9c', 'Ks'],
        pot: 200,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 900,
        history: [],
      });

      if (action.action === 'raise' || action.action === 'allin') betCount++;
    }

    // Adaptive with two pair (KK99) should thin value bet
    expect(betCount).toBeGreaterThan(0);
  }, 30000);

  it('GTO bets or checks two pair on paired board (balanced strategy)', async () => {
    const trials = 60;
    let actionCount = 0;

    for (let i = 0; i < trials; i++) {
      const gto = createAgent('gto');
      notifyNewHand(gto, 0, 1000, 2);
      gto.notify({ type: 'hole_cards', cards: ['5h', '5d'] });
      gto.notify({ type: 'street', name: 'flop', board: ['Ad', '9h', '9c'] });

      const action = await gto.requestAction({
        street: 'flop',
        board: ['Ad', '9h', '9c'],
        pot: 60,
        currentBet: 0,
        toCall: 0,
        minRaise: 20,
        stack: 960,
        history: [],
      });

      // Balanced strategy: medium-strength hands (two pair on paired board) mix between bet and check
      if (['raise', 'allin', 'check'].includes(action.action)) actionCount++;
    }

    // Should always produce a valid action (never fold when toCall=0)
    expect(actionCount).toBe(trials);
  }, 30000);

  it('maniac raises preflop with trash hands', async () => {
    const trials = 30;
    let raiseCount = 0;

    for (let i = 0; i < trials; i++) {
      const maniac = createAgent('maniac');
      notifyNewHand(maniac, 0, 1000, 2);
      maniac.notify({ type: 'hole_cards', cards: ['8h', '3d'] });

      const action = await maniac.requestAction({
        street: 'preflop',
        board: [],
        pot: 30,
        currentBet: 20,
        toCall: 10,
        minRaise: 20,
        stack: 990,
        history: [],
      });

      if (action.action === 'raise' || action.action === 'allin') raiseCount++;
    }

    // Maniac should raise preflop with 83o at some frequency
    expect(raiseCount).toBeGreaterThan(0);
  });

  it('GTO auto-shoves when raise commits >90% of stack', async () => {
    const gto = createAgent('gto');
    notifyNewHand(gto, 0, 100, 2);
    gto.notify({ type: 'hole_cards', cards: ['Ah', 'Kd'] });

    // With only 100 stack, any raise will commit most of the stack
    const action = await gto.requestAction({
      street: 'preflop',
      board: [],
      pot: 30,
      currentBet: 20,
      toCall: 20,
      minRaise: 20,
      stack: 80,
      initialStack: 100,
      history: [],
    });

    // AKo with 5BB should go all-in, not raise leaving crumbs
    if (action.action === 'raise' || action.action === 'allin') {
      expect(action.action).toBe('allin');
    }
  });

  it('human pressure increases aggression vs human players', async () => {
    const trials = 30;
    let raiseCountWithHuman = 0;
    let raiseCountWithoutHuman = 0;

    for (let i = 0; i < trials; i++) {
      const agentH = createAgent('tag');
      agentH.notify({
        type: 'new_hand', handId: `h-${i}`, seat: 0, stack: 1000,
        players: [
          { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
          { seat: 1, displayName: 'Human', stack: 1000, isBot: false, elo: 1000 },
        ],
        smallBlind: 10, bigBlind: 20, buttonSeat: 0,
      });
      agentH.notify({ type: 'hole_cards', cards: ['Jh', 'Ts'] });
      const actionH = await agentH.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 10, minRaise: 20, stack: 990, history: [],
      });
      if (actionH.action === 'raise' || actionH.action === 'allin') raiseCountWithHuman++;

      const agentB = createAgent('tag');
      agentB.notify({
        type: 'new_hand', handId: `b-${i}`, seat: 0, stack: 1000,
        players: [
          { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
          { seat: 1, displayName: 'Bot2', stack: 1000, isBot: true },
        ],
        smallBlind: 10, bigBlind: 20, buttonSeat: 0,
      });
      agentB.notify({ type: 'hole_cards', cards: ['Jh', 'Ts'] });
      const actionB = await agentB.requestAction({
        street: 'preflop', board: [], pot: 30, currentBet: 20,
        toCall: 10, minRaise: 20, stack: 990, history: [],
      });
      if (actionB.action === 'raise' || actionB.action === 'allin') raiseCountWithoutHuman++;
    }

    expect(raiseCountWithHuman).toBeGreaterThanOrEqual(raiseCountWithoutHuman);
  });
});
