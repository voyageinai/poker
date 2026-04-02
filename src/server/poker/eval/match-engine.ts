/**
 * Headless match engine for bot-vs-bot evaluation.
 *
 * Drives the pure state machine directly — no WebSocket, no DB, no UI.
 * Supports 6-max tables for realistic evaluation (bots are designed for 6-max).
 * Position rotation ensures each seat plays all positions equally.
 */
import type { Card, PlayerState, PokerAction, ActionType } from '@/lib/types';
import { createTableState, seatPlayer, startHand, applyAction, type TableEvent } from '../state-machine';
import { BuiltinBotAgent } from '../agents';
import { SYSTEM_BOTS, type SystemBotStyle } from '@/lib/system-bots';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HUDStats {
  hands: number;
  vpip: number;
  pfr: number;
  postflopRaises: number;
  postflopCalls: number;
  sawFlop: number;
  wtsd: number;
}

export interface PlayerResult {
  style: SystemBotStyle;
  totalChipDelta: number;
  mbbPerHand: number;
  hud: HUDStats;
}

export interface MatchResult {
  players: PlayerResult[];
  handsPlayed: number;
  bigBlind: number;
}

// ─── Agent factory ───────────────────────────────────────────────────────────

function createBotAgent(style: SystemBotStyle): BuiltinBotAgent {
  const def = SYSTEM_BOTS.find(b => b.style === style)!;
  return new BuiltinBotAgent(def.userId, def);
}

function emptyHUD(): HUDStats {
  return { hands: 0, vpip: 0, pfr: 0, postflopRaises: 0, postflopCalls: 0, sawFlop: 0, wtsd: 0 };
}

// ─── Core: run N hands on a 6-max table ─────────────────────────────────────

/**
 * Run a multi-player match with the given styles filling the table.
 * Each hand resets stacks to 100BB to prevent elimination.
 */
export async function runMatch(
  styles: SystemBotStyle[],
  numHands: number,
  bigBlind: number = 20,
): Promise<MatchResult> {
  const numSeats = styles.length;
  const stack = bigBlind * 100;
  const smallBlind = bigBlind / 2;

  // Per-seat accumulators
  const chipDeltas = new Array(numSeats).fill(0);
  const huds: HUDStats[] = styles.map(() => emptyHUD());

  for (let handIdx = 0; handIdx < numHands; handIdx++) {
    // Create fresh state and agents each hand (reset stacks)
    const state = createTableState(`eval-${handIdx}`, numSeats, smallBlind, bigBlind);
    const agents: BuiltinBotAgent[] = styles.map(s => createBotAgent(s));

    // Seat players
    for (let s = 0; s < numSeats; s++) {
      const def = SYSTEM_BOTS.find(b => b.style === styles[s])!;
      seatPlayer(state, s, {
        userId: def.userId,
        displayName: def.name,
        kind: 'bot',
        stack,
        streetBet: 0,
        totalBet: 0,
        holeCards: null,
        status: 'active',
        lastAction: null,
        debugInfo: null,
      });
    }

    // If not the first hand, advance button to rotate positions
    // startHand advances button internally, and handIdx naturally rotates
    // But since we create fresh state each time, we need to set button manually
    if (handIdx > 0) {
      (state as unknown as Record<string, unknown>).buttonSeat = (handIdx - 1) % numSeats;
    }

    // Start hand
    const startEvents = startHand(state as Parameters<typeof startHand>[0]);

    // Notify agents of hand start
    for (let s = 0; s < numSeats; s++) {
      agents[s].notify({
        type: 'new_hand',
        handId: `eval-h${handIdx}`,
        seat: s,
        stack: state.players[s]!.stack + state.players[s]!.totalBet,
        players: state.players.filter((p): p is PlayerState => p !== null).map(p => ({
          seat: p.seatIndex,
          playerId: p.userId,
          displayName: p.displayName,
          stack: p.stack + p.totalBet,
          isBot: true,
          elo: 1200,
        })),
        smallBlind,
        bigBlind,
        buttonSeat: state.buttonSeat,
      });
    }

    // Track per-hand stats
    let isPreflop = true;
    let preflopRaiseCount = 0;
    const seatSawFlop = new Array(numSeats).fill(false);
    const seatReachedShowdown = new Array(numSeats).fill(false);
    const seatVpip = new Array(numSeats).fill(false);
    const seatPfr = new Array(numSeats).fill(false);

    // Process start events
    let pendingAction: { seat: number; toCall: number; minRaise: number } | null = null;
    let currentStreet: string = 'preflop';

    for (const ev of startEvents) {
      if (ev.kind === 'deal_hole_cards') {
        agents[ev.seat].notify({ type: 'hole_cards', cards: ev.cards });
      } else if (ev.kind === 'action_request') {
        pendingAction = { seat: ev.seat, toCall: ev.toCall, minRaise: ev.minRaise };
      }
    }

    // Game loop
    let safety = 0;
    while (pendingAction && safety < 500) {
      safety++;
      const { seat, toCall, minRaise } = pendingAction;
      pendingAction = null;

      const player = state.players[seat];
      if (!player) break;

      // Request action from bot
      let response: PokerAction;
      try {
        const r = await agents[seat].requestAction({
          street: currentStreet as 'preflop' | 'flop' | 'turn' | 'river',
          board: [...state.board],
          pot: state.pot.total,
          currentBet: state.currentBet,
          toCall,
          minRaise,
          stack: player.stack,
          initialStack: stack,
          history: [],
        });
        response = { action: r.action, amount: r.amount };
      } catch {
        response = { action: 'fold' };
      }

      // Track stats before applying
      if (isPreflop) {
        if (response.action === 'raise' || response.action === 'allin') {
          preflopRaiseCount++;
          seatPfr[seat] = true;
          seatVpip[seat] = true;
        } else if (response.action === 'call') {
          seatVpip[seat] = true;
        }
      } else {
        if (response.action === 'raise' || response.action === 'allin') {
          huds[seat].postflopRaises++;
        } else if (response.action === 'call') {
          huds[seat].postflopCalls++;
        }
      }

      // Apply action (with error recovery — fold on invalid action)
      let resultEvents: TableEvent[];
      try {
        resultEvents = applyAction(
          state as Parameters<typeof applyAction>[0],
          seat,
          response,
        );
      } catch {
        // Invalid action (e.g., raise too small) — fall back to fold or check
        try {
          const fallback: PokerAction = toCall > 0 ? { action: 'fold' } : { action: 'check' };
          resultEvents = applyAction(state as Parameters<typeof applyAction>[0], seat, fallback);
        } catch {
          break; // Catastrophic — abort this hand
        }
      }

      // Broadcast events to agents
      for (const ev of resultEvents) {
        switch (ev.kind) {
          case 'player_action':
            for (const a of agents) {
              a.notify({ type: 'player_action', seat: ev.seat, action: ev.action, amount: ev.amount });
            }
            break;
          case 'deal_board':
            if (ev.street === 'flop') {
              isPreflop = false;
              for (let s = 0; s < numSeats; s++) {
                const p = state.players[s];
                if (p && (p.status === 'active' || p.status === 'allin')) {
                  seatSawFlop[s] = true;
                }
              }
            }
            currentStreet = ev.street;
            for (const a of agents) {
              a.notify({ type: 'street', name: ev.street, board: [...state.board] });
            }
            break;
          case 'action_request':
            pendingAction = { seat: ev.seat, toCall: ev.toCall, minRaise: ev.minRaise };
            break;
          case 'showdown':
            for (let s = 0; s < numSeats; s++) {
              if (seatSawFlop[s]) seatReachedShowdown[s] = true;
            }
            break;
          case 'hand_complete':
            for (const a of agents) {
              a.notify({
                type: 'hand_over',
                winners: ev.winners.map(w => ({ seat: w.seat, amount: w.amountWon })),
                board: [...state.board],
              });
            }
            break;
        }
      }
    }

    // Record chip deltas
    for (let s = 0; s < numSeats; s++) {
      const finalStack = state.players[s]?.stack ?? 0;
      chipDeltas[s] += finalStack - stack;

      huds[s].hands++;
      if (seatVpip[s]) huds[s].vpip++;
      if (seatPfr[s]) huds[s].pfr++;
      if (seatSawFlop[s]) huds[s].sawFlop++;
      if (seatReachedShowdown[s]) huds[s].wtsd++;
    }
  }

  // Build results
  const players: PlayerResult[] = styles.map((style, i) => ({
    style,
    totalChipDelta: chipDeltas[i],
    mbbPerHand: (chipDeltas[i] / numHands) / bigBlind * 1000,
    hud: huds[i],
  }));

  return { players, handsPlayed: numHands, bigBlind };
}

// ─── Convenience wrappers ────────────────────────────────────────────────────

/** Run a heads-up match between two styles (less realistic, but fast). */
export async function runHeadsUp(
  styleA: SystemBotStyle,
  styleB: SystemBotStyle,
  numHands: number,
  bigBlind: number = 20,
): Promise<MatchResult> {
  return runMatch([styleA, styleB], numHands, bigBlind);
}

/** Run a full 6-max table with the given styles. */
export async function run6Max(
  styles: [SystemBotStyle, SystemBotStyle, SystemBotStyle, SystemBotStyle, SystemBotStyle, SystemBotStyle],
  numHands: number,
  bigBlind: number = 20,
): Promise<MatchResult> {
  return runMatch(styles, numHands, bigBlind);
}
