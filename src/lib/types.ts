// ─── Cards ───────────────────────────────────────────────────────────────────

export type Suit = 'h' | 'd' | 'c' | 's'; // hearts diamonds clubs spades
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

/** e.g. "Ah", "Td", "2c" */
export type Card = `${Rank}${Suit}`;

// ─── Game Streets ─────────────────────────────────────────────────────────────

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

// ─── Actions ─────────────────────────────────────────────────────────────────

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PokerAction {
  action: ActionType;
  amount?: number; // only for raise; allin uses player's remaining stack
}

// ─── Pot & Side Pots ─────────────────────────────────────────────────────────

export interface SidePot {
  amount: number;
  /** seat indices eligible to win this pot */
  eligible: number[];
}

export interface PotState {
  main: number;
  sides: SidePot[];
  /** total chips in play this hand (sum of all pots) */
  total: number;
}

// ─── Player ──────────────────────────────────────────────────────────────────

export type PlayerStatus = 'active' | 'folded' | 'allin' | 'sitting_out' | 'disconnected';
export type PlayerKind = 'human' | 'bot';

export interface PlayerState {
  seatIndex: number;
  userId: string;
  displayName: string;
  kind: PlayerKind;
  stack: number;
  /** chips committed to pot this street */
  streetBet: number;
  /** chips committed to pot this hand */
  totalBet: number;
  holeCards: [Card, Card] | null; // null until dealt, hidden from others
  status: PlayerStatus;
  isButton: boolean;
  isSB: boolean;
  isBB: boolean;
  /** last action this street for display */
  lastAction: ActionType | null;
  /** optional: bot exposes its reasoning */
  debugInfo: BotDebugInfo | null;
}

// ─── Bot Debug / AI Reasoning ─────────────────────────────────────────────────
// Bots may optionally return this in their PBP response.
// If absent the UI shows "---".

export interface BotDebugInfo {
  /** win equity 0–1 */
  equity?: number;
  /** expected value in chips */
  ev?: number;
  /** pot odds 0–1 */
  potOdds?: number;
  foldFreq?: number;
  callFreq?: number;
  raiseFreq?: number;
  /** free-form label, e.g. "Bluff", "Value bet", "Fold equity play" */
  reasoning?: string;
}

// ─── Table State Machine ──────────────────────────────────────────────────────

export type TableStatus =
  | 'waiting'       // < 2 players
  | 'starting'      // dealing in progress
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'hand_complete'; // briefly, between hands

export interface TableState {
  tableId: string;
  status: TableStatus;
  handNumber: number;
  players: (PlayerState | null)[]; // null = empty seat; length = maxSeats
  buttonSeat: number; // seat index of dealer button
  activeSeat: number; // whose turn it is (-1 if not in betting round)
  board: Card[];      // community cards revealed so far
  pot: PotState;
  currentBet: number; // amount to call this street
  minRaise: number;
  lastRaiserSeat: number; // -1 if no raise this street
  deck: Card[];       // remaining deck (server-only, never sent to clients)
  streetActed: Set<number>; // seats that have acted this street
}

// ─── WebSocket Messages ───────────────────────────────────────────────────────

// Server → Client
export type WsServerMessage =
  | { type: 'table_state'; state: ClientTableState }
  | { type: 'action_request'; seat: number; toCall: number; minRaise: number; timeoutMs: number }
  | { type: 'player_action'; seat: number; action: ActionType; amount: number }
  | { type: 'deal_hole_cards'; seat: number; cards: [Card, Card] } // only sent to the card owner
  | { type: 'deal_board'; street: Street; cards: Card[] }
  | { type: 'showdown'; results: ShowdownResult[] }
  | { type: 'hand_complete'; winners: WinnerEntry[]; pot: number; rake?: number }
  | { type: 'player_joined'; seat: number; player: Omit<PlayerState, 'holeCards' | 'debugInfo'> }
  | { type: 'player_left'; seat: number }
  | { type: 'busted'; seat: number; canRebuy: boolean; timeoutSec: number }
  | { type: 'rebuy_success'; seat: number; stack: number }
  | { type: 'error'; message: string };

// Client → Server
export type WsClientMessage =
  | { type: 'join_table'; tableId: string; token?: string }
  | { type: 'action'; action: ActionType; amount?: number }
  | { type: 'sit_out' }
  | { type: 'sit_in' }
  | { type: 'rebuy' }
  | { type: 'ready' };

/** State sent to clients — hole cards are scrubbed for other players */
export interface ClientTableState {
  tableId: string;
  status: TableStatus;
  handNumber: number;
  players: (ClientPlayerState | null)[];
  buttonSeat: number;
  activeSeat: number;
  board: Card[];
  pot: PotState;
  currentBet: number;
  minRaise: number;
}

export interface ClientPlayerState {
  seatIndex: number;
  userId: string;
  displayName: string;
  kind: PlayerKind;
  stack: number;
  streetBet: number;
  totalBet: number;
  /** own hole cards revealed; others get null */
  holeCards: [Card, Card] | null;
  status: PlayerStatus;
  isButton: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: ActionType | null;
  debugInfo: BotDebugInfo | null; // null unless bot exposes
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

export interface ShowdownResult {
  seat: number;
  userId: string;
  displayName: string;
  holeCards: [Card, Card];
  bestHand: string; // e.g. "Flush, Ace High"
  handRank: number; // lower = better (for pokersolver)
}

export interface WinnerEntry {
  seat: number;
  userId: string;
  displayName: string;
  amountWon: number;
  potDescription: string; // "main pot" | "side pot 1" etc.
}

// ─── DB row types ─────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  chips: number;
  last_chip_refresh: number;
  banned: number;
  elo: number;
  games_played: number;
  created_at: number;
}

export interface DbTable {
  id: string;
  name: string;
  small_blind: number;
  big_blind: number;
  min_buyin: number;
  max_buyin: number;
  max_seats: number;
  level: string;
  status: 'open' | 'closed';
  created_by: string;
  created_at: number;
}

export interface DbBot {
  id: string;
  user_id: string;
  name: string;
  description: string;
  binary_path: string;
  elo: number;
  games_played: number;
  status: 'active' | 'disabled' | 'validating' | 'invalid';
  created_at: number;
}

export interface DbChipCode {
  code: string;
  chips: number;
  created_by: string;
  max_uses: number;
  use_count: number;
  expires_at: number | null;
  created_at: number;
}

export interface DbHand {
  id: string;
  table_id: string;
  hand_number: number;
  button_seat: number;
  board: string; // JSON
  pot: number;
  status: 'active' | 'complete';
  started_at: number;
  ended_at: number | null;
}

export interface DbHandAction {
  id: number;
  hand_id: string;
  seat_index: number;
  user_id: string;
  street: Street;
  action: ActionType;
  amount: number;
  stack_after: number;
  created_at: number;
}

export interface DbHandPlayer {
  hand_id: string;
  seat_index: number;
  user_id: string;
  bot_id: string | null;
  stack_start: number;
  stack_end: number | null;
  hole_cards: string | null; // JSON [Card, Card]
  result: 'won' | 'lost' | 'push' | null;
  amount_won: number;
}

export interface DbTournament {
  id: string;
  name: string;
  buyin: number;
  starting_chips: number;
  max_players: number;
  status: 'registering' | 'running' | 'complete';
  blind_schedule: string; // JSON BlindLevel[]
  created_by: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

// ─── Tournament ───────────────────────────────────────────────────────────────

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  durationMinutes: number;
}

// ─── Bot Protocol (PBP) ───────────────────────────────────────────────────────

// Server → Bot (stdin, newline-delimited JSON)
export type PbpServerMessage =
  | {
      type: 'new_hand';
      handId: string;
      seat: number;
      stack: number;
      players: Array<{ seat: number; displayName: string; stack: number; isBot: boolean; elo?: number }>;
      smallBlind: number;
      bigBlind: number;
      buttonSeat: number;
    }
  | { type: 'hole_cards'; cards: [Card, Card] }
  | {
      type: 'action_request';
      street: Street;
      board: Card[];
      pot: number;
      currentBet: number;
      toCall: number;
      minRaise: number;
      stack: number;
      history: Array<{ seat: number; action: ActionType; amount: number }>;
    }
  | { type: 'player_action'; seat: number; action: ActionType; amount: number }
  | { type: 'street'; name: Street; board: Card[] }
  | { type: 'hand_over'; winners: Array<{ seat: number; amount: number }>; board: Card[] };

// Bot → Server (stdout, newline-delimited JSON)
export interface PbpBotMessage {
  action: ActionType;
  amount?: number;
  /** optional AI reasoning for the data-art UI */
  debug?: BotDebugInfo;
}
