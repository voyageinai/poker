/**
 * Texas Hold'em table state machine.
 *
 * Pure logic — no DB, no WebSocket, no timers.
 * All side effects are emitted as events and handled by TableManager.
 */
import type {
  TableState,
  TableStatus,
  PlayerState,
  PokerAction,
  ActionType,
  Card,
  WinnerEntry,
  ShowdownResult,
  Street,
  ClientTableState,
  ClientPlayerState,
  PotState,
} from '@/lib/types';
import { freshShuffledDeck, draw, burn } from './deck';
import { findWinners, evaluateHand } from './hand-eval';
import { buildPotsWithEligible, awardPotsWithEligible } from './pot';
import { nanoid } from 'nanoid';

// ─── Events emitted by the state machine ─────────────────────────────────────

export type TableEvent =
  | { kind: 'deal_hole_cards'; seat: number; cards: [Card, Card] }
  | { kind: 'deal_board'; street: Street; cards: Card[] }
  | { kind: 'action_request'; seat: number; toCall: number; minRaise: number }
  | { kind: 'player_action'; seat: number; action: ActionType; amount: number }
  | { kind: 'showdown'; results: ShowdownResult[] }
  | { kind: 'hand_complete'; winners: WinnerEntry[]; pot: number }
  | { kind: 'state_update' }; // generic: send current state to all clients

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_PLAYERS = 2;
/** Max raises per street. After this many raises, players can only call or fold. */
const MAX_RAISES_PER_STREET = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function activePlayers(state: TableState): PlayerState[] {
  return state.players.filter(
    (p): p is PlayerState =>
      p !== null && (p.status === 'active' || p.status === 'allin'),
  );
}

function bettablePlayers(state: TableState): PlayerState[] {
  return state.players.filter(
    (p): p is PlayerState => p !== null && p.status === 'active',
  );
}

function nextActiveSeat(state: TableState, fromSeat: number): number {
  const seats = state.players.length;
  for (let i = 1; i < seats; i++) {
    const idx = (fromSeat + i) % seats;
    const p = state.players[idx];
    if (p && p.status === 'active') return idx;
  }
  return -1;
}

/** First seat to the left of button */
function sbSeat(state: TableState): number {
  return nextActiveSeat(state, state.buttonSeat);
}

/** Second seat to the left of button */
function bbSeat(state: TableState): number {
  const sb = sbSeat(state);
  return nextActiveSeat(state, sb);
}

/** First to act post-flop: first active seat left of button */
function firstToActPostFlop(state: TableState): number {
  return nextActiveSeat(state, state.buttonSeat);
}

function isStreetOver(state: TableState): boolean {
  const bettable = bettablePlayers(state);
  // No one can bet (all folded or all-in) → street is over
  if (bettable.length === 0) return true;
  // Every bettable player must have acted AND matched the current bet
  for (const p of bettable) {
    if (!state.streetActed.has(p.seatIndex)) return false;
    if (p.streetBet < state.currentBet) return false;
  }
  return true;
}

function allInOrFolded(state: TableState): boolean {
  // No more betting possible: zero active (non-allin) players
  return bettablePlayers(state).length === 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Create a fresh table state */
export function createTableState(
  tableId: string,
  maxSeats: number,
  smallBlind: number,
  bigBlind: number,
): TableState {
  return {
    tableId,
    status: 'waiting',
    handNumber: 0,
    players: new Array(maxSeats).fill(null),
    buttonSeat: -1,
    activeSeat: -1,
    board: [],
    pot: { main: 0, sides: [], total: 0 },
    currentBet: 0,
    minRaise: bigBlind,
    lastRaiserSeat: -1,
    streetRaiseCount: 0,
    deck: [],
    streetActed: new Set(),
    // Store blinds for reset
    _smallBlind: smallBlind as unknown as number,
    _bigBlind: bigBlind as unknown as number,
  } as TableState & { _smallBlind: number; _bigBlind: number };
}

/** Seat a player. Returns events. */
export function seatPlayer(
  state: TableState,
  seat: number,
  player: Omit<PlayerState, 'seatIndex' | 'isButton' | 'isSB' | 'isBB'>,
): TableEvent[] {
  if (state.players[seat] !== null) throw new Error(`Seat ${seat} is occupied`);
  state.players[seat] = {
    ...player,
    seatIndex: seat,
    isButton: false,
    isSB: false,
    isBB: false,
  };
  return [{ kind: 'state_update' }];
}

/** Remove a player from their seat. */
export function unseatPlayer(state: TableState, seat: number): TableEvent[] {
  state.players[seat] = null;
  return [{ kind: 'state_update' }];
}

/**
 * Start a new hand. Returns events (deal_hole_cards × players, action_request).
 */
export function startHand(
  state: TableState & { _smallBlind: number; _bigBlind: number },
): TableEvent[] {
  // Auto-sit-out busted players (stack ≤ 0) BEFORE checking ready count
  for (const p of state.players) {
    if (p && p.status !== 'sitting_out' && p.stack <= 0) {
      p.status = 'sitting_out';
    }
  }

  const readyPlayers = state.players.filter(
    (p): p is PlayerState => p !== null && p.status !== 'sitting_out',
  );
  if (readyPlayers.length < MIN_PLAYERS) {
    throw new Error('Not enough players to start a hand');
  }

  const events: TableEvent[] = [];
  state.handNumber++;
  state.board = [];
  state.pot = { main: 0, sides: [], total: 0 };
  state.currentBet = state._bigBlind;
  state.minRaise = state._bigBlind;
  state.lastRaiserSeat = -1;
  state.streetRaiseCount = 0;
  state.streetActed = new Set();
  state.deck = freshShuffledDeck();
  state.status = 'preflop';

  // Advance button
  const prevButton = state.buttonSeat;
  state.buttonSeat = nextActiveSeatAmongAll(state, prevButton === -1 ? -1 : prevButton);

  // Reset player states for the new hand
  for (const p of state.players) {
    if (p) {
      p.streetBet = 0;
      p.totalBet = 0;
      p.holeCards = null;
      p.lastAction = null;
      p.debugInfo = null;
      p.isButton = false;
      p.isSB = false;
      p.isBB = false;
      if (p.status !== 'sitting_out') {
        p.status = 'active';
      }
    }
  }

  const active = state.players.filter(
    (p): p is PlayerState => p !== null && p.status === 'active',
  );

  // Mark positions — heads-up special case: Button = SB
  const buttonPlayer = state.players[state.buttonSeat];
  if (buttonPlayer) buttonPlayer.isButton = true;

  const isHeadsUp = active.length === 2;
  let sb: number;
  let bb: number;

  if (isHeadsUp) {
    // Heads-up: Button posts SB, the other player posts BB
    sb = state.buttonSeat;
    bb = nextActiveSeat(state, state.buttonSeat);
  } else {
    sb = sbSeat(state);
    bb = bbSeat(state);
  }

  const sbPlayer = state.players[sb];
  const bbPlayer = state.players[bb];
  if (sbPlayer) sbPlayer.isSB = true;
  if (bbPlayer) bbPlayer.isBB = true;

  // Post blinds (and emit events so clients can display them)
  const sbActual = Math.min(state._smallBlind, state.players[sb]?.stack ?? 0);
  postBlind(state, sb, state._smallBlind);
  events.push({ kind: 'player_action', seat: sb, action: sbActual < state._smallBlind ? 'allin' : 'raise', amount: sbActual });

  const bbActual = Math.min(state._bigBlind, state.players[bb]?.stack ?? 0);
  postBlind(state, bb, state._bigBlind);
  events.push({ kind: 'player_action', seat: bb, action: bbActual < state._bigBlind ? 'allin' : 'raise', amount: bbActual });

  state.streetActed.delete(bb); // BB has option to re-open

  // Deal hole cards
  for (const p of active) {
    const cards = draw(state.deck, 2) as [Card, Card];
    p.holeCards = cards;
    events.push({ kind: 'deal_hole_cards', seat: p.seatIndex, cards });
  }

  // First to act pre-flop: heads-up → SB/Button acts first; otherwise → left of BB
  // Use dynamic lookup: if the preferred seat is allin, find the next active player
  const preferredUtg = isHeadsUp ? sb : nextActiveSeat(state, bb);
  const utg = (state.players[preferredUtg]?.status === 'active')
    ? preferredUtg
    : nextActiveSeat(state, isHeadsUp ? sb : bb);

  // If all players are allin after blinds, skip action_request — advanceGame will deal remaining streets
  if (utg === -1 || allInOrFolded(state)) {
    state.activeSeat = -1;
    events.push(...dealNextStreet(state));
  } else {
    state.activeSeat = utg;
    events.push({ kind: 'action_request', seat: utg, toCall: state.currentBet - (state.players[utg]?.streetBet ?? 0), minRaise: state.minRaise });
  }

  return events;
}

function nextActiveSeatAmongAll(state: TableState, fromSeat: number): number {
  const seats = state.players.length;
  for (let i = 1; i <= seats; i++) {
    const idx = (fromSeat + i) % seats;
    const p = state.players[idx];
    if (p && p.status !== 'sitting_out') return idx;
  }
  return 0;
}

function postBlind(
  state: TableState & { _smallBlind?: number; _bigBlind?: number },
  seat: number,
  amount: number,
): void {
  const p = state.players[seat];
  if (!p) return;
  const actual = Math.min(amount, p.stack);
  p.stack -= actual;
  p.streetBet += actual;
  p.totalBet += actual;
  state.pot.main += actual;
  state.pot.total += actual;
  if (p.stack === 0) p.status = 'allin';
  if (actual < amount) {
    // Player couldn't cover blind → all-in
    state.currentBet = Math.max(state.currentBet, actual);
  }
  state.streetActed.add(seat);
}

/**
 * Apply a player action. Returns events.
 * Throws if the action is invalid.
 */
export function applyAction(
  state: TableState & { _smallBlind: number; _bigBlind: number },
  seat: number,
  action: PokerAction,
): TableEvent[] {
  const player = state.players[seat];
  if (!player) throw new Error(`No player at seat ${seat}`);
  if (state.activeSeat !== seat) throw new Error(`Not seat ${seat}'s turn`);
  if (player.status !== 'active') throw new Error(`Seat ${seat} cannot act (status: ${player.status})`);

  const events: TableEvent[] = [];
  const toCall = state.currentBet - player.streetBet;

  switch (action.action) {
    case 'fold': {
      player.status = 'folded';
      player.lastAction = 'fold';
      break;
    }
    case 'check': {
      if (toCall > 0) throw new Error('Cannot check, there is a bet to call');
      player.lastAction = 'check';
      break;
    }
    case 'call': {
      if (toCall <= 0) throw new Error('Nothing to call');
      const callAmount = Math.min(toCall, player.stack);
      player.stack -= callAmount;
      player.streetBet += callAmount;
      player.totalBet += callAmount;
      state.pot.main += callAmount;
      state.pot.total += callAmount;
      player.lastAction = 'call';
      if (player.stack === 0) player.status = 'allin';
      break;
    }
    case 'raise': {
      // Raise cap: if max raises reached, downgrade to call
      if (state.streetRaiseCount >= MAX_RAISES_PER_STREET) {
        const callAmt = Math.min(toCall, player.stack);
        player.stack -= callAmt;
        player.streetBet += callAmt;
        player.totalBet += callAmt;
        state.pot.main += callAmt;
        state.pot.total += callAmt;
        player.lastAction = 'call';
        if (player.stack === 0) player.status = 'allin';
        break;
      }
      const raiseTotal = action.amount ?? 0;
      if (raiseTotal < state.currentBet + state.minRaise) {
        throw new Error(`Raise must be at least ${state.currentBet + state.minRaise}`);
      }
      const raiseBy = raiseTotal - player.streetBet;
      if (raiseBy > player.stack) throw new Error('Not enough chips to raise that amount');
      const prevBet = state.currentBet;
      player.stack -= raiseBy;
      player.streetBet += raiseBy;
      player.totalBet += raiseBy;
      state.pot.main += raiseBy;
      state.pot.total += raiseBy;
      state.minRaise = raiseTotal - prevBet;
      state.currentBet = raiseTotal;
      state.lastRaiserSeat = seat;
      state.streetRaiseCount++;
      player.lastAction = 'raise';
      if (player.stack === 0) player.status = 'allin';
      // Reopen action: everyone else needs to act again
      state.streetActed = new Set([seat]);
      break;
    }
    case 'allin': {
      const allInAmount = player.stack;
      player.stack = 0;
      player.streetBet += allInAmount;
      player.totalBet += allInAmount;
      state.pot.main += allInAmount;
      state.pot.total += allInAmount;
      if (player.streetBet > state.currentBet) {
        const raiseSize = player.streetBet - state.currentBet;
        state.currentBet = player.streetBet;
        state.lastRaiserSeat = seat;
        // Only reopen action if the raise is a full raise (>= minRaise).
        // An incomplete all-in raise does NOT reopen betting per poker rules.
        if (raiseSize >= state.minRaise) {
          state.minRaise = raiseSize;
          state.streetRaiseCount++;
          state.streetActed = new Set([seat]);
        }
      }
      player.status = 'allin';
      player.lastAction = 'allin';
      break;
    }
    default:
      throw new Error(`Unknown action: ${(action as PokerAction).action}`);
  }

  state.streetActed.add(seat);
  events.push({ kind: 'player_action', seat, action: action.action, amount: action.amount ?? 0 });

  // Advance game
  const next = advanceGame(state);
  events.push(...next);
  return events;
}

/**
 * Called after each action. Determines what happens next:
 *   - If street is over → deal next street or showdown
 *   - Otherwise → next player to act
 */
function advanceGame(
  state: TableState & { _smallBlind: number; _bigBlind: number },
): TableEvent[] {
  const events: TableEvent[] = [];

  // Check if only one player hasn't folded → they win uncontested
  const stillIn = activePlayers(state);
  if (stillIn.length === 1) {
    events.push(...concludeHand(state, stillIn[0].seatIndex));
    return events;
  }

  if (!isStreetOver(state)) {
    // Find next active player
    const next = nextActiveSeat(state, state.activeSeat);
    if (next === -1) {
      // No active players — shouldn't happen
      return events;
    }
    state.activeSeat = next;
    const toCall = state.currentBet - (state.players[next]?.streetBet ?? 0);
    // When raise cap reached, signal with huge minRaise so no one can raise
    const effectiveMinRaise = state.streetRaiseCount >= MAX_RAISES_PER_STREET
      ? Number.MAX_SAFE_INTEGER
      : state.minRaise;
    events.push({ kind: 'action_request', seat: next, toCall, minRaise: effectiveMinRaise });
    return events;
  }

  // Street is over — move to next street
  events.push(...dealNextStreet(state));
  return events;
}

function dealNextStreet(
  state: TableState & { _smallBlind: number; _bigBlind: number },
): TableEvent[] {
  const events: TableEvent[] = [];

  // Reset street state
  for (const p of state.players) {
    if (p && (p.status === 'active' || p.status === 'allin')) {
      p.streetBet = 0;
      p.lastAction = null;
    }
  }
  state.streetActed = new Set();
  state.currentBet = 0;
  state.minRaise = state._bigBlind;
  state.lastRaiserSeat = -1;
  state.streetRaiseCount = 0;

  // Rebuild pot from totalBets
  rebuildPot(state);

  let nextStreet: TableStatus;
  let newCards: Card[];

  switch (state.status) {
    case 'preflop': {
      nextStreet = 'flop';
      burn(state.deck);
      newCards = draw(state.deck, 3);
      state.board.push(...newCards);
      state.status = 'flop';
      events.push({ kind: 'deal_board', street: 'flop', cards: newCards });
      break;
    }
    case 'flop': {
      nextStreet = 'turn';
      burn(state.deck);
      newCards = draw(state.deck, 1);
      state.board.push(...newCards);
      state.status = 'turn';
      events.push({ kind: 'deal_board', street: 'turn', cards: newCards });
      break;
    }
    case 'turn': {
      nextStreet = 'river';
      burn(state.deck);
      newCards = draw(state.deck, 1);
      state.board.push(...newCards);
      state.status = 'river';
      events.push({ kind: 'deal_board', street: 'river', cards: newCards });
      break;
    }
    case 'river': {
      // Go to showdown
      events.push(...doShowdown(state));
      return events;
    }
    default:
      return events;
  }

  // If no meaningful betting is possible (all allin/folded, or only 1 active
  // player facing allin opponents), deal remaining streets automatically.
  const bettable = bettablePlayers(state);
  const stillInCount = activePlayers(state).length;
  if (allInOrFolded(state) || bettable.length <= 1 && stillInCount >= 2) {
    events.push(...dealNextStreet(state));
    return events;
  }

  // Find first to act post-flop
  const firstSeat = firstToActPostFlop(state);
  if (firstSeat !== -1) {
    state.activeSeat = firstSeat;
    events.push({ kind: 'action_request', seat: firstSeat, toCall: 0, minRaise: state.minRaise });
  }

  return events;
}

function rebuildPot(state: TableState): void {
  const bets = state.players
    .filter((p): p is PlayerState => p !== null && p.status !== 'sitting_out')
    .map(p => ({
      seat: p.seatIndex,
      totalBet: p.totalBet,
      isAllIn: p.status === 'allin',
      folded: p.status === 'folded',
    }));

  const built = buildPotsWithEligible(bets);
  state.pot = { main: built.main, sides: built.sides, total: built.total };
  (state as TableState & { _potEligible?: Record<string, number[]> })._potEligible = {
    main: built.mainEligible,
    ...Object.fromEntries(built.sides.map((s, i) => [`side${i}`, s.eligible])),
  };
}

function doShowdown(
  state: TableState & { _smallBlind: number; _bigBlind: number },
): TableEvent[] {
  const events: TableEvent[] = [];
  state.status = 'showdown';

  const contestants = state.players.filter(
    (p): p is PlayerState =>
      p !== null && (p.status === 'active' || p.status === 'allin'),
  );

  const results: ShowdownResult[] = contestants.map(p => {
    const eval_ = evaluateHand(p.holeCards!, state.board);
    return {
      seat: p.seatIndex,
      userId: p.userId,
      displayName: p.displayName,
      holeCards: p.holeCards!,
      bestHand: eval_.name,
      handRank: eval_.rank,
    };
  });

  events.push({ kind: 'showdown', results });

  // Rebuild pot one final time
  rebuildPot(state);
  const potEligible = (state as TableState & { _potEligible?: Record<string, number[]> })._potEligible ?? {};

  // Award pots
  const stacks: Record<number, number> = {};
  for (const p of state.players) {
    if (p) stacks[p.seatIndex] = p.stack;
  }

  // Track which seats actually won through hand comparison (not just refunds)
  const trueWinnerSeats = new Set<number>();

  const winnersBySeat = (eligible: number[]): number[] => {
    const eligibleContestants = contestants.filter(c => eligible.includes(c.seatIndex));
    if (eligibleContestants.length === 0) return [];
    // If only 1 eligible, it's a refund — don't mark as true winner
    if (eligibleContestants.length === 1) return [eligibleContestants[0].seatIndex];
    const winners = findWinners(
      eligibleContestants.map(c => ({ seat: c.seatIndex, holeCards: c.holeCards! })),
      state.board,
    );
    for (const s of winners) trueWinnerSeats.add(s);
    return winners;
  };

  // Use extended pot state
  const bets = state.players
    .filter((p): p is PlayerState => p !== null && p.status !== 'sitting_out')
    .map(p => ({
      seat: p.seatIndex,
      totalBet: p.totalBet,
      isAllIn: p.status === 'allin',
      folded: p.status === 'folded',
    }));
  const builtPot = buildPotsWithEligible(bets);
  const newStacks = awardPotsWithEligible(builtPot, stacks, winnersBySeat);

  // Only report true winners (won through hand comparison), not side-pot refunds
  const winners: WinnerEntry[] = [];
  for (const [seatStr, newStack] of Object.entries(newStacks)) {
    const seat = Number(seatStr);
    const oldStack = stacks[seat] ?? 0;
    const won = newStack - oldStack;
    if (won > 0) {
      const p = state.players[seat];
      if (p) p.stack = newStack;
      // Only push to winners if this seat actually won a contested pot
      if (trueWinnerSeats.has(seat)) {
        winners.push({ seat, userId: p?.userId ?? '', displayName: p?.displayName ?? `座位 ${seat}`, amountWon: won, potDescription: 'pot' });
      }
    }
  }

  const uncalled = calcUncalledBet(state);
  events.push({ kind: 'hand_complete', winners, pot: builtPot.total - uncalled });
  state.status = 'hand_complete';
  state.activeSeat = -1;
  return events;
}

/**
 * Calculate the uncalled portion of the highest bet.
 * If only one player has the maximum totalBet, the excess over the
 * second-highest totalBet is "uncalled" and should be returned / excluded.
 */
function calcUncalledBet(state: TableState): number {
  const bets = state.players
    .filter((p): p is PlayerState => p !== null && p.status !== 'sitting_out')
    .map(p => p.totalBet)
    .sort((a, b) => b - a);
  if (bets.length < 2) return 0;
  return bets[0] - bets[1];
}

function concludeHand(
  state: TableState & { _smallBlind: number; _bigBlind: number },
  winningSeat: number,
): TableEvent[] {
  const winner = state.players[winningSeat];
  if (!winner) return [];

  rebuildPot(state);
  // Subtract uncalled bet: winner's excess over the next-highest totalBet
  const uncalled = calcUncalledBet(state);
  const pot = state.pot.total - uncalled;
  winner.stack += pot;

  state.status = 'hand_complete';
  state.activeSeat = -1;

  return [
    {
      kind: 'hand_complete',
      winners: [{ seat: winningSeat, userId: winner.userId, displayName: winner.displayName, amountWon: pot, potDescription: 'main pot' }],
      pot,
    },
  ];
}

// ─── Client state projection ──────────────────────────────────────────────────

/**
 * Project the full TableState into a ClientTableState for a specific viewer.
 * Scrubs other players' hole cards.
 * @param viewerUserId - the user receiving this state (null = spectator)
 */
export function toClientState(state: TableState, viewerUserId: string | null): ClientTableState {
  return {
    tableId: state.tableId,
    status: state.status,
    handNumber: state.handNumber,
    buttonSeat: state.buttonSeat,
    activeSeat: state.activeSeat,
    board: state.board,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.streetRaiseCount >= MAX_RAISES_PER_STREET
      ? Number.MAX_SAFE_INTEGER
      : state.minRaise,
    players: state.players.map((p): ClientPlayerState | null => {
      if (!p) return null;
      return {
        seatIndex: p.seatIndex,
        userId: p.userId,
        displayName: p.displayName,
        kind: p.kind,
        stack: p.stack,
        streetBet: p.streetBet,
        totalBet: p.totalBet,
        // Only reveal own hole cards (or at showdown / hand_complete for replay)
        holeCards:
          p.userId === viewerUserId || state.status === 'showdown' || state.status === 'hand_complete'
            ? p.holeCards
            : null,
        status: p.status,
        isButton: p.isButton,
        isSB: p.isSB,
        isBB: p.isBB,
        lastAction: p.lastAction,
        debugInfo: p.debugInfo, // bots expose this; null for humans
      };
    }),
  };
}
