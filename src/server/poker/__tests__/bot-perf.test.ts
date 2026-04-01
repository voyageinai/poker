import { describe, it, expect } from 'vitest';
import { BuiltinBotAgent } from '../agents';
import { SYSTEM_BOTS } from '@/lib/system-bots';

describe('Bot decision performance', () => {
  it('postflop decision completes within 300ms', async () => {
    const def = SYSTEM_BOTS.find(b => b.style === 'tag')!;
    const agent = new BuiltinBotAgent(def.userId, def);

    agent.notify({
      type: 'new_hand',
      handId: 'perf-test',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
        { seat: 1, displayName: 'Opp', stack: 1000, isBot: false, elo: 1200 },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    });
    agent.notify({ type: 'hole_cards', cards: ['Jh', 'Ts'] });
    agent.notify({ type: 'street', name: 'flop', board: ['9c', '3d', '2h'] });

    const start = performance.now();
    await agent.requestAction({
      street: 'flop',
      board: ['9c', '3d', '2h'],
      pot: 60,
      currentBet: 40,
      toCall: 40,
      minRaise: 40,
      stack: 960,
      history: [{ seat: 1, action: 'raise', amount: 40 }],
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(300);
  });

  it('preflop decision completes within 5ms (no MC)', async () => {
    const def = SYSTEM_BOTS.find(b => b.style === 'gto')!;
    const agent = new BuiltinBotAgent(def.userId, def);

    agent.notify({
      type: 'new_hand',
      handId: 'perf-test-2',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'Bot', stack: 1000, isBot: true },
        { seat: 1, displayName: 'Opp', stack: 1000, isBot: true },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    });
    agent.notify({ type: 'hole_cards', cards: ['Ah', 'Kd'] });

    const start = performance.now();
    await agent.requestAction({
      street: 'preflop',
      board: [],
      pot: 30,
      currentBet: 20,
      toCall: 20,
      minRaise: 20,
      stack: 980,
      history: [],
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});
