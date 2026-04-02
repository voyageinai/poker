import { describe, it, expect } from 'vitest';
import {
  createTableState,
  seatPlayer,
  startHand,
  applyAction,
  toClientState,
} from '../state-machine';
import type { TableState, PlayerState } from '@/lib/types';

type TestState = TableState & { _smallBlind: number; _bigBlind: number };

function makeTable(maxSeats = 6, sb = 10, bb = 20): TestState {
  return createTableState('t1', maxSeats, sb, bb) as TestState;
}

function addPlayer(
  state: TestState,
  seat: number,
  userId: string,
  stack = 1000,
  kind: 'human' | 'bot' = 'human',
): void {
  seatPlayer(state, seat, {
    userId,
    displayName: userId,
    kind,
    stack,
    streetBet: 0,
    totalBet: 0,
    holeCards: null,
    status: 'active',
    lastAction: null,
    debugInfo: null,
  });
}

// ─── Hand start ───────────────────────────────────────────────────────────────

describe('startHand', () => {
  it('throws if fewer than 2 players', () => {
    const state = makeTable();
    addPlayer(state, 0, 'alice');
    expect(() => startHand(state)).toThrow('Not enough players');
  });

  it('deals 2 hole cards to each player', () => {
    const state = makeTable();
    addPlayer(state, 0, 'alice');
    addPlayer(state, 1, 'bob');
    const events = startHand(state);
    const deals = events.filter(e => e.kind === 'deal_hole_cards');
    expect(deals).toHaveLength(2);
  });

  it('posts small and big blinds', () => {
    const state = makeTable();
    addPlayer(state, 0, 'alice');
    addPlayer(state, 1, 'bob');
    startHand(state);
    const totalBet = state.players
      .filter((p): p is PlayerState => p !== null)
      .reduce((acc, p) => acc + p.totalBet, 0);
    expect(totalBet).toBe(30); // 10+20
    expect(state.pot.total).toBe(30);
  });

  it('UTG acts first preflop (left of BB)', () => {
    const state = makeTable();
    addPlayer(state, 0, 'alice');
    addPlayer(state, 1, 'bob');
    addPlayer(state, 2, 'charlie');
    startHand(state);
    // Button=0, SB=1, BB=2, UTG=0
    // button advances from -1 → first active → 0
    // UTG = left of BB (2) = seat 0
    expect(state.activeSeat).toBe(0);
  });

  it('status becomes preflop', () => {
    const state = makeTable();
    addPlayer(state, 0, 'alice');
    addPlayer(state, 1, 'bob');
    startHand(state);
    expect(state.status).toBe('preflop');
  });
});

// ─── Basic betting ────────────────────────────────────────────────────────────

describe('applyAction - basic betting', () => {
  function twoPlayerHand() {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    startHand(state);
    return state;
  }

  it('fold: player status becomes folded, opponent wins', () => {
    const state = twoPlayerHand();
    const actingSeat = state.activeSeat;
    const events = applyAction(state, actingSeat, { action: 'fold' });
    const handComplete = events.find(e => e.kind === 'hand_complete');
    expect(handComplete).toBeDefined();
    expect(state.status).toBe('hand_complete');
  });

  it('call: stack reduces correctly', () => {
    const state = twoPlayerHand();
    const actingSeat = state.activeSeat;
    const player = state.players[actingSeat]!;
    const stackBefore = player.stack;
    applyAction(state, actingSeat, { action: 'call' });
    // Called 20 (BB), but already posted 10 if SB... depends on who UTG is
    // In heads-up, button = SB = seat 0, BB = seat 1
    // UTG preflop in HU = button/SB = seat 0, needs to call 10 more
    expect(player.stack).toBeLessThan(stackBefore);
  });

  it('raise: updates currentBet and minRaise', () => {
    const state = twoPlayerHand();
    const actingSeat = state.activeSeat;
    applyAction(state, actingSeat, { action: 'raise', amount: 60 });
    expect(state.currentBet).toBe(60);
    expect(state.minRaise).toBe(40); // 60 - 20 = 40
  });

  it('cannot check when there is a bet to call', () => {
    const state = twoPlayerHand();
    const actingSeat = state.activeSeat;
    expect(() => applyAction(state, actingSeat, { action: 'check' })).toThrow('Cannot check');
  });

  it('acting out of turn throws', () => {
    const state = twoPlayerHand();
    const wrongSeat = state.activeSeat === 0 ? 1 : 0;
    expect(() => applyAction(state, wrongSeat, { action: 'fold' })).toThrow("Not seat");
  });
});

// ─── Street progression ───────────────────────────────────────────────────────

describe('street progression', () => {
  function threePlayerHand() {
    const state = makeTable(3);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    addPlayer(state, 2, 'charlie', 1000);
    startHand(state);
    return state;
  }

  it('reaches flop after preflop betting round completes', () => {
    const state = threePlayerHand();
    // Everyone calls/checks around until street is done
    let safety = 20;
    while (state.status === 'preflop' && safety-- > 0) {
      const seat = state.activeSeat;
      const player = state.players[seat]!;
      const toCall = state.currentBet - player.streetBet;
      applyAction(state, seat, toCall > 0 ? { action: 'call' } : { action: 'check' });
    }
    expect(state.status).toBe('flop');
    expect(state.board).toHaveLength(3);
  });

  it('reaches turn after flop betting', () => {
    const state = threePlayerHand();
    // Fast-forward to flop
    completeBettingRound(state);
    expect(state.status).toBe('flop');
    completeBettingRound(state);
    expect(state.status).toBe('turn');
    expect(state.board).toHaveLength(4);
  });

  it('reaches river and then showdown', () => {
    const state = threePlayerHand();
    completeBettingRound(state);
    completeBettingRound(state);
    completeBettingRound(state);
    completeBettingRound(state);
    expect(state.status).toBe('hand_complete');
    expect(state.board).toHaveLength(5);
  });
});

// ─── All-in ───────────────────────────────────────────────────────────────────

describe('all-in', () => {
  it('all-in player status becomes allin', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 100);
    addPlayer(state, 1, 'bob', 100);
    startHand(state);
    const seat = state.activeSeat;
    applyAction(state, seat, { action: 'allin' });
    expect(state.players[seat]!.status).toBe('allin');
    expect(state.players[seat]!.stack).toBe(0);
  });

  it('when all players all-in, board runs out automatically', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 200);
    addPlayer(state, 1, 'bob', 200);
    startHand(state);
    // Both go all-in
    const seat1 = state.activeSeat;
    applyAction(state, seat1, { action: 'allin' });
    if (state.status !== 'hand_complete') {
      const seat2 = state.activeSeat;
      if (seat2 !== -1) {
        applyAction(state, seat2, { action: 'allin' });
      }
    }
    expect(state.status).toBe('hand_complete');
    expect(state.board).toHaveLength(5);
  });

  it('chip conservation: stacks before = stacks after + pot', () => {
    const state = makeTable(3);
    addPlayer(state, 0, 'alice', 500);
    addPlayer(state, 1, 'bob', 500);
    addPlayer(state, 2, 'charlie', 500);
    const totalBefore = 1500;

    startHand(state);
    completeBettingRound(state);
    completeBettingRound(state);
    completeBettingRound(state);
    completeBettingRound(state);

    const totalAfter = state.players
      .filter((p): p is PlayerState => p !== null)
      .reduce((acc, p) => acc + p.stack, 0);
    expect(totalAfter).toBe(totalBefore);
  });
});

// ─── Big blind option ─────────────────────────────────────────────────────────

describe('BB option', () => {
  it('BB can raise when no one else has raised (preflop walk)', () => {
    const state = makeTable(3);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    addPlayer(state, 2, 'charlie', 1000);
    startHand(state);

    // UTG and SB just call
    let safety = 10;
    while (state.activeSeat !== findBBSeat(state) && safety-- > 0) {
      const seat = state.activeSeat;
      const toCall = state.currentBet - state.players[seat]!.streetBet;
      applyAction(state, seat, toCall > 0 ? { action: 'call' } : { action: 'check' });
    }

    // BB should still be in preflop (has option)
    expect(state.status).toBe('preflop');
    const bbSeat = state.activeSeat;
    // BB raises
    expect(() => applyAction(state, bbSeat, { action: 'raise', amount: 60 })).not.toThrow();
  });
});

// ─── Client state projection ──────────────────────────────────────────────────

describe('toClientState', () => {
  it('hides other players hole cards', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    startHand(state);

    const clientState = toClientState(state, 'alice');
    const aliceSeat = clientState.players.find(p => p?.userId === 'alice');
    const bobSeat = clientState.players.find(p => p?.userId === 'bob');

    expect(aliceSeat?.holeCards).not.toBeNull();
    expect(bobSeat?.holeCards).toBeNull();
  });

  it('spectator sees no hole cards', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    startHand(state);

    const clientState = toClientState(state, null);
    for (const p of clientState.players) {
      if (p) expect(p.holeCards).toBeNull();
    }
  });

  it('does not include server-only deck field', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    startHand(state);
    const clientState = toClientState(state, 'alice');
    expect((clientState as unknown as Record<string, unknown>).deck).toBeUndefined();
  });
});

// ─── Bug fix: zero-stack players ──────────────────────────────────────────

describe('zero-stack players (Bug 1)', () => {
  it('players with stack=0 are set to sitting_out on next hand', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 1000);
    startHand(state);

    // Simulate bob busting: set stack to 0 and complete hand
    state.players[1]!.stack = 0;
    state.players[1]!.status = 'allin';
    state.status = 'hand_complete';

    // Try to start next hand — bob should be sitting_out
    expect(() => startHand(state)).toThrow('Not enough players');
    expect(state.players[1]!.status).toBe('sitting_out');
  });

  it('does not deal cards to zero-stack players', () => {
    const state = makeTable(3);
    addPlayer(state, 0, 'alice', 1000);
    addPlayer(state, 1, 'bob', 0); // busted
    addPlayer(state, 2, 'charlie', 1000);
    startHand(state);

    // Bob should be sitting_out and not dealt cards
    expect(state.players[1]!.status).toBe('sitting_out');
    expect(state.players[1]!.holeCards).toBeNull();
    // Only alice and charlie get hole cards
    const deals = state.players
      .filter((p): p is PlayerState => p !== null && p.holeCards !== null);
    expect(deals).toHaveLength(2);
    expect(deals.map(p => p.userId).sort()).toEqual(['alice', 'charlie']);
  });
});

// ─── Bug fix: heads-up SB all-in ──────────────────────────────────────────

describe('heads-up SB all-in (Bug 2)', () => {
  it('when SB cannot cover the blind, BB gets to act', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 5); // less than SB=10
    addPlayer(state, 1, 'bob', 1000);
    const events = startHand(state);

    // SB (alice) should be allin from posting the blind
    const sbPlayer = state.players.find(p => p?.isSB);
    expect(sbPlayer?.status).toBe('allin');

    // BB (bob) should be the active seat, not the allin SB
    expect(state.activeSeat).not.toBe(-1);
    const activePlayer = state.players[state.activeSeat];
    expect(activePlayer?.status).toBe('active');
  });
});

// ─── Bug fix: all-in from blinds ──────────────────────────────────────────

describe('all-in from blinds (Bug 3)', () => {
  it('when both players all-in from blinds, hand completes automatically', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 8);  // less than SB=10, goes allin
    addPlayer(state, 1, 'bob', 15);   // less than BB=20, goes allin
    const events = startHand(state);

    // Both should be allin after blinds
    const alice = state.players[0]!;
    const bob = state.players[1]!;
    expect(alice.status).toBe('allin');
    expect(bob.status).toBe('allin');

    // Hand should run to completion automatically (no action_request needed)
    expect(state.status).toBe('hand_complete');
    expect(state.board).toHaveLength(5);
  });

  it('chip conservation holds when both players allin from blinds', () => {
    const state = makeTable(2);
    addPlayer(state, 0, 'alice', 8);
    addPlayer(state, 1, 'bob', 15);
    const totalBefore = 8 + 15;
    startHand(state);

    const totalAfter = state.players
      .filter((p): p is PlayerState => p !== null)
      .reduce((acc, p) => acc + p.stack, 0);
    expect(totalAfter).toBe(totalBefore);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function completeBettingRound(state: TestState): void {
  let safety = 30;
  const initialStatus = state.status;
  while (state.status === initialStatus && state.activeSeat !== -1 && safety-- > 0) {
    const seat = state.activeSeat;
    const player = state.players[seat];
    if (!player || player.status !== 'active') break;
    const toCall = state.currentBet - player.streetBet;
    applyAction(state, seat, toCall > 0 ? { action: 'call' } : { action: 'check' });
  }
}

function findBBSeat(state: TestState): number {
  return state.players.findIndex(p => p?.isBB);
}
