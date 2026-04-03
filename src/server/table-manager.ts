/**
 * TableManager — bridges the pure state machine with DB, WebSocket, and agents.
 *
 * Per-table action queue (async mutex) prevents concurrent action corruption:
 * even if two WebSocket messages arrive simultaneously, they are serialized.
 */
import { nanoid } from 'nanoid';
import type {
  TableState,
  PlayerState,
  PokerAction,
  ActionType,
  WsServerMessage,
  Card,
  Street,
} from '@/lib/types';
import {
  createTableState,
  seatPlayer,
  unseatPlayer,
  startHand,
  applyAction,
  toClientState,
  TableEvent,
} from './poker/state-machine';
import { HumanAgent, createBotAgent, PlayerAgent } from './poker/agents';
import { wsHub } from './ws';
import * as db from '@/db/queries';
import { getTableById } from '@/db/queries';
import { audit } from '@/db/audit';
import { calculateEloUpdates } from './elo';
import { SYSTEM_BOTS, getSystemBotByBotId, resolveSystemBotBuyin } from '@/lib/system-bots';
import { getStakeLevel, LEVEL_BOT_POOL, type StakeLevelId } from '@/lib/stake-levels';

type ExtState = TableState & { _smallBlind: number; _bigBlind: number };

interface SeatInfo {
  agent: PlayerAgent;
  botId: string | null;
}

export class TableManager {
  private state: ExtState;
  private agents = new Map<number, SeatInfo>(); // seatIndex → agent
  private handId: string | null = null;
  private currentStreet: Street = 'preflop';
  private _nextHandTimer: ReturnType<typeof setTimeout> | null = null;
  /** Action history for the current street, passed to bots for context */
  private streetHistory: Array<{ seat: number; action: ActionType; amount: number }> = [];
  /** True during blind-posting phase; prevents blind posts from polluting streetHistory */
  private blindsPhase = false;
  /** Per-seat starting stack for the current hand (before any bets including blinds) */
  private initialStacks = new Map<number, number>();
  /** v3: track whether current hand had a showdown (for show bluff logic) */
  private hadShowdown = false;

  // Per-table action queue: serializes all mutations
  private actionQueue: Promise<void> = Promise.resolve();

  /** Human players who have confirmed readiness for the next hand */
  private readyPlayers = new Set<string>();

  /** Timestamp of last meaningful activity (join/leave/action) — used for idle cleanup */
  lastActivity = Date.now();

  constructor(
    private readonly tableId: string,
    maxSeats: number,
    smallBlind: number,
    bigBlind: number,
  ) {
    this.state = createTableState(tableId, maxSeats, smallBlind, bigBlind) as ExtState;

    // Register WS action listener
    wsHub.onTableAction(tableId, (userId, msg) => {
      if (msg.type === 'action') {
        // MUST NOT go through enqueue! receiveAction only resolves a pending
        // Promise — the actual state mutation happens inside runHand's await
        // chain which already holds the queue. Enqueueing would deadlock:
        // runHand waits for requestAction, but receiveAction is queued behind it.
        this.handleHumanAction(userId, msg);
      } else if (msg.type === 'sit_out') {
        this.enqueue(() => this.handleSitOut(userId));
      } else if (msg.type === 'sit_in') {
        this.enqueue(() => this.handleSitIn(userId));
      } else if (msg.type === 'ready') {
        this.enqueue(() => this.handleReady(userId));
      } else if (msg.type === 'rebuy') {
        this.enqueue(() => this.handleRebuy(userId));
      }
    });
  }

  private enqueue(fn: () => Promise<void> | void): void {
    this.actionQueue = this.actionQueue.then(fn).catch(err => {
      console.error(`[Table ${this.tableId}] Queue error:`, err);
    });
  }

  // ─── Seat management ─────────────────────────────────────────────────────────

  joinHuman(userId: string, displayName: string, stack: number, seatIndex?: number): number {
    this.lastActivity = Date.now();
    const existingSeat = this.findSeatByUserId(userId);
    if (existingSeat !== -1) return existingSeat;

    let seat = seatIndex ?? this.findEmptySeat();
    // If table is full, kick a bot to make room for the human
    if (seat === -1) {
      seat = this.kickOneBot();
      if (seat === -1) throw new Error('Table is full');
    }

    const sendWs = (msg: object) =>
      wsHub.sendToUser(this.tableId, userId, msg as WsServerMessage);

    const agent = new HumanAgent(userId, sendWs);
    this.agents.set(seat, { agent, botId: null });

    seatPlayer(this.state, seat, {
      userId,
      displayName,
      kind: 'human',
      stack,
      streetBet: 0,
      totalBet: 0,
      holeCards: null,
      status: 'active',
      lastAction: null,
      debugInfo: null,
    });

    wsHub.broadcast(this.tableId, {
      type: 'player_joined',
      seat,
      player: {
        seatIndex: seat,
        userId,
        displayName,
        kind: 'human',
        stack,
        streetBet: 0,
        totalBet: 0,
        status: 'active',
        isButton: false,
        isSB: false,
        isBB: false,
        lastAction: null,
      },
    } satisfies WsServerMessage);

    this.broadcastState();
    this.maybeStartHand();
    return seat;
  }

  joinBot(userId: string, botId: string, botName: string, binaryPath: string, stack: number, seatIndex?: number): number {
    this.lastActivity = Date.now();
    const existingSeat = this.findSeatByBotId(botId);
    if (existingSeat !== -1) return existingSeat;

    const seat = seatIndex ?? this.findEmptySeat();
    if (seat === -1) throw new Error('Table is full');

    // Deduct buyin from bot owner's account
    const owner = db.getUserById(userId);
    if (!owner || owner.chips < stack) {
      throw new Error('Bot owner 筹码不足');
    }
    db.updateUserChips(userId, owner.chips - stack);
    audit({
      userId,
      category: 'chips',
      action: 'bot_buyin',
      targetId: this.tableId,
      detail: { tableId: this.tableId, botId, botName, amount: stack, balanceBefore: owner.chips, balanceAfter: owner.chips - stack },
    });

    const agent = createBotAgent(userId, binaryPath, botId);
    this.agents.set(seat, { agent, botId });

    seatPlayer(this.state, seat, {
      userId,
      displayName: botName,
      kind: 'bot',
      stack,
      streetBet: 0,
      totalBet: 0,
      holeCards: null,
      status: 'active',
      lastAction: null,
      debugInfo: null,
    });

    this.broadcastState();
    this.maybeStartHand();
    return seat;
  }

  leave(userId: string): void {
    // If this player is currently being asked for an action, inject a fold
    // IMMEDIATELY (outside the queue) to unblock the awaiting requestAction.
    // Same deadlock prevention as handleHumanAction — see Fix #1.
    const immediateSeat = this.findSeatByUserId(userId);
    if (immediateSeat !== -1) {
      const info = this.agents.get(immediateSeat);
      const handInProgress = this.isHandInProgress();
      if (handInProgress && info?.agent instanceof HumanAgent && this.state.activeSeat === immediateSeat) {
        info.agent.receiveAction({ action: 'fold' });
      }
    }

    this.enqueue(() => {
      const seat = this.findSeatByUserId(userId);
      if (seat === -1) return;
      const player = this.state.players[seat];
      const info = this.agents.get(seat);
      const handInProgress = this.isHandInProgress();

      // If player is in an active hand but not the current actor, mark them as folded
      // so the state machine handles them correctly (pot eligibility, etc.)
      if (handInProgress && player && (player.status === 'active' || player.status === 'allin')) {
        player.status = 'folded';
      }

      info?.agent.dispose();
      this.agents.delete(seat);

      if (handInProgress) {
        // Hand still in progress — defer unseat until hand_complete.
        // Do NOT credit chips now; wait for hand_complete so any winnings are included.
        (player as PlayerState & { _pendingLeave?: boolean })._pendingLeave = true;
        this.broadcastState();
      } else {
        // Hand already completed (or never started) — credit chips and unseat now.
        this.creditAndUnseat(seat, player, userId);
        this.cleanupBotsIfNoHumans();
      }
    });
  }

  // ─── Hand lifecycle ──────────────────────────────────────────────────────────

  private maybeStartHand(): void {
    if (this.state.status !== 'waiting' && this.state.status !== 'hand_complete') return;
    const seated = this.state.players.filter(
      (p): p is PlayerState => p !== null && p.status !== 'sitting_out',
    );
    if (seated.length < 2) return;
    // Prevent duplicate scheduling
    if (this._nextHandTimer) return;

    // At least one human must be present — pure bot tables cannot start.
    const humans = seated.filter(p => p.kind === 'human');
    if (humans.length === 0) return;

    // Wait for all humans to confirm ready.
    if (humans.length > 0) {
      const allReady = humans.every(p => this.readyPlayers.has(p.userId));
      if (!allReady) return;
    }

    const delay = this.state.handNumber === 0 ? 0 : 2000;
    this._nextHandTimer = setTimeout(() => {
      this._nextHandTimer = null;
      this.enqueue(() => this.runHand());
    }, delay);
  }

  private async runHand(): Promise<void> {
    if (this.state.status !== 'waiting' && this.state.status !== 'hand_complete') return;
    this.lastActivity = Date.now();
    this.readyPlayers.clear();

    // Create DB record
    this.handId = nanoid();
    this.currentStreet = 'preflop';
    this.streetHistory = [];
    this.blindsPhase = true;
    this.hadShowdown = false;

    let events: TableEvent[];
    try {
      events = startHand(this.state);
    } catch (err) {
      console.error(`[Table ${this.tableId}] startHand failed:`, err);
      // Reset status so maybeStartHand can retry when conditions change
      this.state.status = 'waiting';
      this.maybeStartHand();
      return;
    }

    // Record initial stacks (current stack + blinds already posted)
    this.initialStacks.clear();
    for (const p of this.state.players) {
      if (p && p.status === 'active') {
        this.initialStacks.set(p.seatIndex, p.stack + p.totalBet);
      }
    }

    db.createHand({
      id: this.handId,
      table_id: this.tableId,
      hand_number: this.state.handNumber,
      button_seat: this.state.buttonSeat,
      status: 'active',
    });

    // Record initial player states
    for (const p of this.state.players) {
      if (p && p.status === 'active') {
        const seatInfo = this.agents.get(p.seatIndex);
        db.insertHandPlayer({
          hand_id: this.handId,
          seat_index: p.seatIndex,
          user_id: p.userId,
          bot_id: seatInfo?.botId ?? null,
          stack_start: this.initialStacks.get(p.seatIndex) ?? p.stack + p.totalBet,
          hole_cards: null,
        });
      }
    }

    // Notify bots of new hand start
    for (const [seatIdx, info] of this.agents) {
      const p = this.state.players[seatIdx];
      if (!p) continue;
      info.agent.notify({
        type: 'new_hand',
        handId: this.handId,
        seat: seatIdx,
        stack: p.stack,
        players: this.state.players
          .filter((pl): pl is PlayerState => pl !== null)
          .map(pl => {
            const seatInfo = this.agents.get(pl.seatIndex);
            const isBot = seatInfo?.botId !== null;
            let elo: number | undefined;
            if (!isBot) {
              const user = db.getUserById(pl.userId);
              if (user) elo = user.elo;
            }
            return { seat: pl.seatIndex, playerId: pl.userId, displayName: pl.displayName, stack: pl.stack, isBot, elo };
          }),
        smallBlind: this.state._smallBlind,
        bigBlind: this.state._bigBlind,
        buttonSeat: this.state.buttonSeat,
      });
    }

    await this.processEvents(events);
  }

  private async processEvents(events: TableEvent[]): Promise<void> {
    for (const event of events) {
      await this.handleEvent(event);
    }
  }

  private async handleEvent(event: TableEvent): Promise<void> {
    switch (event.kind) {
      case 'deal_hole_cards': {
        const p = this.state.players[event.seat];
        if (!p) break;
        // Send hole cards only to the card owner
        wsHub.sendToUser(this.tableId, p.userId, {
          type: 'deal_hole_cards',
          seat: event.seat,
          cards: event.cards,
        } satisfies WsServerMessage);
        // Notify the seat agent; HumanAgent ignores this, built-in and external bots use it.
        const info = this.agents.get(event.seat);
        info?.agent.notify({ type: 'hole_cards', cards: event.cards });
        // Store hole cards in DB (result/stack will be set at hand_complete)
        if (this.handId) {
          db.updateHandPlayerHoleCards(this.handId, event.seat, JSON.stringify(event.cards));
        }
        break;
      }

      case 'deal_board': {
        this.currentStreet = event.street;
        this.streetHistory = [];
        wsHub.broadcast(this.tableId, {
          type: 'deal_board',
          street: event.street,
          cards: event.cards,
        } satisfies WsServerMessage);
        // Notify all bots
        for (const info of this.agents.values()) {
          info.agent.notify({ type: 'street', name: event.street, board: this.state.board });
        }
        this.broadcastState();
        break;
      }

      case 'action_request': {
        this.blindsPhase = false;  // First action_request marks end of blind-posting phase
        const seat = event.seat;
        const info = this.agents.get(seat);
        const player = this.state.players[seat];
        if (!info || !player) break;

        this.broadcastState();

        let resultAction: PokerAction;
        try {
          const response = await info.agent.requestAction({
            street: this.currentStreet,
            board: this.state.board as Card[],
            pot: this.state.pot.total,
            currentBet: this.state.currentBet,
            toCall: event.toCall,
            minRaise: event.minRaise,
            stack: player.stack,
            initialStack: this.initialStacks.get(seat) ?? player.stack + player.totalBet,
            history: [...this.streetHistory],
          });

          // Update bot debug info on player state
          if (response.debug && player) {
            player.debugInfo = response.debug;
          }

          resultAction = { action: response.action, amount: response.amount };
        } catch (err) {
          console.error(`[Table ${this.tableId}] Bot exception at seat ${seat}, auto-folding:`, err);
          resultAction = { action: 'fold' };
        }

        // Apply and recurse on new events
        let newEvents: TableEvent[];
        try {
          newEvents = applyAction(this.state, seat, resultAction);
        } catch (err) {
          console.error(`[Table ${this.tableId}] Invalid action from seat ${seat}:`, err);
          newEvents = applyAction(this.state, seat, { action: 'fold' });
        }

        // Persist action
        if (this.handId && player) {
          db.insertHandAction({
            hand_id: this.handId,
            seat_index: seat,
            user_id: player.userId,
            street: this.currentStreet,
            action: resultAction.action,
            amount: resultAction.amount ?? 0,
            stack_after: player.stack,
          });
        }

        await this.processEvents(newEvents);
        break;
      }

      case 'player_action': {
        // Skip blind posts — they are emitted as 'raise' but must not pollute
        // the action history that bots use to count raisersAhead.
        if (!this.blindsPhase) {
          this.streetHistory.push({ seat: event.seat, action: event.action as ActionType, amount: event.amount });
        }
        wsHub.broadcast(this.tableId, {
          type: 'player_action',
          seat: event.seat,
          action: event.action,
          amount: event.amount,
        } satisfies WsServerMessage);
        // Notify all bots of this action, including the actor.
        // Builtin personalities track their own prior lines (e.g. limp-reraise,
        // delayed c-bet, stop-and-go) from these canonical table events.
        for (const [seatIdx, info] of this.agents) {
          void seatIdx;
          info.agent.notify({
            type: 'player_action',
            seat: event.seat,
            action: event.action as 'fold' | 'check' | 'call' | 'raise' | 'allin',
            amount: event.amount,
          });
        }
        break;
      }

      case 'showdown': {
        this.hadShowdown = true;
        wsHub.broadcast(this.tableId, {
          type: 'showdown',
          results: event.results,
        } satisfies WsServerMessage);
        // Notify bots of showdown participants (for WTSD tracking)
        for (const info of this.agents.values()) {
          info.agent.notify({
            type: 'showdown_result',
            players: event.results.map(r => ({ seat: r.seat, playerId: r.userId, cards: r.holeCards })),
          });
        }
        break;
      }

      case 'hand_complete': {
        // ─── Rake calculation ────────────────────────────────────────────
        let rake = 0;
        const sawFlop = this.state.board.length >= 3;
        if (sawFlop && event.pot > 0 && event.winners.length > 0) {
          const tableRow = db.getTableById(this.tableId);
          const level = tableRow?.level ? getStakeLevel(tableRow.level) : null;
          const rakePercent = level?.rakePercent ?? 0.05;
          const rakeCap = (level?.rakeCapBB ?? 3) * this.state._bigBlind;
          rake = Math.min(Math.floor(event.pot * rakePercent), rakeCap);

          if (rake > 0) {
            // Deduct rake from winners proportionally
            const totalWon = event.winners.reduce((s, w) => s + w.amountWon, 0);
            if (totalWon > 0) {
              let remaining = rake;
              for (let i = 0; i < event.winners.length; i++) {
                const w = event.winners[i];
                const share = (i === event.winners.length - 1)
                  ? remaining  // last winner absorbs rounding
                  : Math.floor(rake * w.amountWon / totalWon);
                const p = this.state.players[w.seat];
                if (p) p.stack -= share;
                w.amountWon -= share;
                remaining -= share;
              }
            }
            db.creditTreasury(rake);
            if (this.handId) {
              db.recordRake(this.handId, this.tableId, rake, event.pot);
              audit({
                category: 'chips',
                action: 'rake',
                targetId: this.tableId,
                detail: { handId: this.handId, tableId: this.tableId, amount: rake, potBefore: event.pot },
              });
            }
          }
        }

        // Persist hand completion + Elo update
        if (this.handId) {
          db.finishHand(this.handId, JSON.stringify(this.state.board), event.pot);
          const winnerSeats = new Set(event.winners.map(w => w.seat));
          // Update ALL players who participated in this hand, not just winners
          for (const p of this.state.players) {
            if (!p) continue;
            // Skip players who weren't in this hand (sitting_out from the start)
            // They have no hand_players record
            if (p.status === 'sitting_out' && p.totalBet === 0) continue;
            const won = event.winners.find(w => w.seat === p.seatIndex)?.amountWon ?? 0;
            const result = winnerSeats.has(p.seatIndex) ? 'won' : 'lost';
            db.updateHandPlayer(this.handId, p.seatIndex, p.stack, result, won, JSON.stringify(p.holeCards));
          }

          // Elo update for ALL participants (bots + humans)
          const eloEntries: Array<{
            participantId: string;
            botId?: string;
            userId?: string;
            currentElo: number;
            gamesPlayed: number;
            chipResult: number;
            kind: 'bot' | 'human';
          }> = [];

          for (const [seatIdx, info] of this.agents.entries()) {
            const p = this.state.players[seatIdx];
            if (!p) continue;
            // Skip players who weren't in this hand
            if (p.status === 'sitting_out' && p.totalBet === 0) continue;
            const chipResult = event.winners.find(w => w.seat === seatIdx)?.amountWon ?? 0;

            if (info.botId) {
              const botData = db.getBotById(info.botId);
              eloEntries.push({
                participantId: info.botId,
                botId: info.botId,
                currentElo: botData?.elo ?? 1200,
                gamesPlayed: botData?.games_played ?? 0,
                chipResult,
                kind: 'bot',
              });
            } else {
              const userData = db.getUserById(p.userId);
              eloEntries.push({
                participantId: p.userId,
                userId: p.userId,
                currentElo: userData?.elo ?? 1200,
                gamesPlayed: userData?.games_played ?? 0,
                chipResult,
                kind: 'human',
              });
            }
          }

          if (eloEntries.length >= 2) {
            const updates = calculateEloUpdates(eloEntries);
            for (const u of updates) {
              const entry = eloEntries.find(e => e.participantId === u.participantId);
              if (!entry) continue;
              if (entry.kind === 'bot' && entry.botId) {
                db.updateBotElo(entry.botId, u.newElo, entry.gamesPlayed + 1);
                db.recordElo(entry.botId, u.newElo, this.handId);
              } else if (entry.kind === 'human' && entry.userId) {
                db.updateUserElo(entry.userId, u.newElo, entry.gamesPlayed + 1);
                db.recordUserElo(entry.userId, u.newElo, this.handId);
              }
            }
          }
        }

        wsHub.broadcast(this.tableId, {
          type: 'hand_complete',
          winners: event.winners,
          pot: event.pot,
          ...(rake > 0 ? { rake } : {}),
        } satisfies WsServerMessage);

        // v3: Show bluff — if hand ended without showdown and winner was a bluffing bot
        if (!this.hadShowdown && event.winners.length > 0) {
          for (const w of event.winners) {
            const info = this.agents.get(w.seat);
            if (info?.agent.getShowBluff) {
              const bluff = info.agent.getShowBluff();
              if (bluff) {
                const p = this.state.players[w.seat];
                wsHub.broadcast(this.tableId, {
                  type: 'show_bluff',
                  seat: w.seat,
                  cards: bluff.cards,
                  playerName: bluff.name,
                } satisfies WsServerMessage);
              }
            }
          }
        }

        // Notify bots
        for (const info of this.agents.values()) {
          info.agent.notify({
            type: 'hand_over',
            winners: event.winners.map(w => ({ seat: w.seat, amount: w.amountWon })),
            board: this.state.board,
          });
        }

        // Clean up players who left / busted during the hand
        this.cleanupPendingLeaves();

        // If last human left during the hand, kick all remaining bots
        this.cleanupBotsIfNoHumans();

        // Auto-refill empty seats with system bots (if any humans remain)
        this.tryAutoFillBots();

        // Clear ready state for next hand — everyone must confirm again
        this.readyPlayers.clear();

        this.broadcastState();

        // Schedule next hand: auto-start for bot-only, wait for human ready otherwise
        this.maybeStartHand();
        break;
      }

      case 'state_update': {
        this.broadcastState();
        break;
      }
    }
  }

  // ─── Human action handler ─────────────────────────────────────────────────────

  private handleHumanAction(userId: string, msg: { type: 'action'; action: string; amount?: number }): void {
    const seat = this.findSeatByUserId(userId);
    if (seat === -1) return;
    const info = this.agents.get(seat);
    if (!(info?.agent instanceof HumanAgent)) return;

    info.agent.receiveAction({
      action: msg.action as PokerAction['action'],
      amount: msg.amount,
    });
  }

  private isHandInProgress(): boolean {
    return this.state.status !== 'waiting' && this.state.status !== 'hand_complete';
  }

  private handleSitOut(userId: string): void {
    const seat = this.findSeatByUserId(userId);
    if (seat === -1) return;
    const p = this.state.players[seat];
    if (!p) return;

    if (this.isHandInProgress() && (p.status === 'active' || p.status === 'allin')) {
      // Hand in progress — defer sit-out until hand completes
      (p as PlayerState & { _pendingSitOut?: boolean })._pendingSitOut = true;
    } else {
      p.status = 'sitting_out';
    }
    this.broadcastState();
  }

  private handleSitIn(userId: string): void {
    const seat = this.findSeatByUserId(userId);
    if (seat === -1) return;
    const p = this.state.players[seat];
    if (!p) return;

    // Clear pending sit-out if they change their mind
    delete (p as PlayerState & { _pendingSitOut?: boolean })._pendingSitOut;

    if (p.status === 'sitting_out' && !this.isHandInProgress()) {
      // Only allow sit-in between hands
      p.status = 'active';
      this.broadcastState();
      this.maybeStartHand();
    }
  }

  private handleReady(userId: string): void {
    const seat = this.findSeatByUserId(userId);
    if (seat === -1) return;
    this.readyPlayers.add(userId);
    this.maybeStartHand();
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  /** Bust timers for human players waiting to rebuy */
  private bustTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Remove players who left / requested sit-out / busted during an active hand */
  private cleanupPendingLeaves(): void {
    const table = db.getTableById(this.tableId);
    const minBuyin = table?.min_buyin ?? 200;
    const maxBuyin = table?.max_buyin ?? minBuyin;

    for (let seat = 0; seat < this.state.players.length; seat++) {
      const p = this.state.players[seat] as (PlayerState & { _pendingLeave?: boolean; _pendingSitOut?: boolean }) | null;
      if (!p) continue;
      if (p._pendingLeave) {
        this.creditAndUnseat(seat, p, p.userId);
      } else if (p.stack <= 0 && p.kind === 'bot') {
        // Bot busted → auto-rebuy from owner's account
        const botId = this.agents.get(seat)?.botId;
        const systemBot = botId ? getSystemBotByBotId(botId) : undefined;
        const rebuyAmount = systemBot
          ? resolveSystemBotBuyin(systemBot, this.state._bigBlind, minBuyin, maxBuyin)
          : minBuyin;
        const owner = db.getUserById(p.userId);
        if (owner && owner.chips >= rebuyAmount) {
          db.updateUserChips(p.userId, owner.chips - rebuyAmount);
          p.stack = rebuyAmount;
          p.status = 'active';
          audit({
            userId: p.userId,
            category: 'chips',
            action: 'bot_buyin',
            targetId: this.tableId,
            detail: { tableId: this.tableId, botId, botName: p.displayName, amount: rebuyAmount, balanceBefore: owner.chips, balanceAfter: owner.chips - rebuyAmount, autoRebuy: true },
          });
          console.log(`[Table ${this.tableId}] Bot ${p.displayName} (seat ${seat}) auto-rebuy ${rebuyAmount}`);
        } else {
          // Owner can't afford rebuy — remove the bot
          const info = this.agents.get(seat);
          info?.agent.dispose();
          this.agents.delete(seat);
          unseatPlayer(this.state, seat);
          wsHub.broadcast(this.tableId, { type: 'player_left', seat } satisfies WsServerMessage);
          console.log(`[Table ${this.tableId}] Bot ${p.displayName} (seat ${seat}) owner 筹码不足, 无法 rebuy — removed`);
        }
      } else if (p.stack <= 0 && p.kind === 'human' && !this.bustTimers.has(seat)) {
        // Human busted → sit out + give 30s to rebuy (only notify once)
        p.status = 'sitting_out';
        const dbUser = db.getUserById(p.userId);
        const canRebuy = !!dbUser && dbUser.chips >= minBuyin;
        wsHub.sendToUser(this.tableId, p.userId, {
          type: 'busted',
          seat,
          canRebuy,
          timeoutSec: 30,
        } satisfies WsServerMessage);
        this.bustTimers.set(seat, setTimeout(() => {
          this.enqueue(() => {
            this.bustTimers.delete(seat);
            const player = this.state.players[seat];
            if (player && player.stack <= 0) {
              const info = this.agents.get(seat);
              info?.agent.dispose();
              this.agents.delete(seat);
              this.creditAndUnseat(seat, player, player.userId);
            }
          });
        }, 30_000));
      } else if (p._pendingSitOut) {
        p.status = 'sitting_out';
        delete p._pendingSitOut;
      }
    }
  }

  /** Human player rebuys after going bust */
  handleRebuy(userId: string): void {
    const seat = this.findSeatByUserId(userId);
    if (seat === -1) return;
    const p = this.state.players[seat];
    if (!p || p.stack > 0) return; // Not busted

    const table = db.getTableById(this.tableId);
    const minBuyin = table?.min_buyin ?? 200;
    const dbUser = db.getUserById(userId);
    if (!dbUser || dbUser.chips < minBuyin) {
      wsHub.sendToUser(this.tableId, userId, {
        type: 'error',
        message: '余额不足，无法补充牌资',
      } satisfies WsServerMessage);
      return;
    }

    // Deduct from account, add to stack
    db.updateUserChips(userId, dbUser.chips - minBuyin);
    p.stack = minBuyin;
    p.status = 'active';

    audit({
      userId,
      category: 'chips',
      action: 'rebuy',
      targetId: this.tableId,
      detail: { tableId: this.tableId, amount: minBuyin, balanceBefore: dbUser.chips, balanceAfter: dbUser.chips - minBuyin },
    });

    // Cancel the kick timer
    const timer = this.bustTimers.get(seat);
    if (timer) {
      clearTimeout(timer);
      this.bustTimers.delete(seat);
    }

    // Explicitly tell the client busted state is over
    wsHub.sendToUser(this.tableId, userId, {
      type: 'rebuy_success', seat, stack: minBuyin,
    } satisfies WsServerMessage);

    this.broadcastState();
    this.maybeStartHand();
  }

  /** If no human players remain, kick all bots and credit their stacks back. */
  private cleanupBotsIfNoHumans(): void {
    const hasHuman = this.state.players.some(p => p !== null && p.kind === 'human');
    if (hasHuman) return;

    let cleaned = false;
    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      if (!p) continue;
      const info = this.agents.get(i);
      info?.agent.dispose();
      this.agents.delete(i);
      this.creditAndUnseat(i, p, p.userId);
      cleaned = true;
    }

    if (cleaned) {
      if (this._nextHandTimer) {
        clearTimeout(this._nextHandTimer);
        this._nextHandTimer = null;
      }
      console.log(`[Table ${this.tableId}] No humans left — all bots cleaned up`);

      // Auto-close the now-empty table: remove from registry and mark DB closed
      if (this.isEmpty()) {
        console.log(`[Table ${this.tableId}] Table empty after bot cleanup — auto-closing`);
        activeManagers.delete(this.tableId);
        dbCloseTable(this.tableId);
      }
    }
  }

  /** Credit player's remaining stack back to their DB account and unseat them. */
  private creditAndUnseat(seat: number, player: PlayerState | null, userId: string): void {
    if (player && player.stack > 0) {
      const dbUser = db.getUserById(userId);
      if (dbUser) {
        db.updateUserChips(userId, dbUser.chips + player.stack);
        const isBotSeat = this.agents.get(seat)?.botId;
        audit({
          userId,
          category: 'chips',
          action: isBotSeat ? 'bot_cashout' : 'cashout',
          targetId: this.tableId,
          detail: {
            tableId: this.tableId,
            amount: player.stack,
            balanceBefore: dbUser.chips,
            balanceAfter: dbUser.chips + player.stack,
            ...(isBotSeat ? { botId: isBotSeat } : {}),
          },
        });
      }
    }
    unseatPlayer(this.state, seat);
    wsHub.broadcast(this.tableId, { type: 'player_left', seat } satisfies WsServerMessage);
    this.broadcastState();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private broadcastState(): void {
    const conns = wsHub.connectedUsers(this.tableId);
    for (const userId of conns) {
      const clientState = toClientState(this.state, userId);
      wsHub.sendToUser(this.tableId, userId, { type: 'table_state', state: clientState } satisfies WsServerMessage);
    }
    // Also send to spectators (userId not in players) — they get null hole cards via toClientState(state, null)
  }

  private findEmptySeat(): number {
    return this.state.players.findIndex(p => p === null);
  }

  private findSeatByUserId(userId: string): number {
    return this.state.players.findIndex(p => p?.userId === userId);
  }

  private findSeatByBotId(botId: string): number {
    for (const [seatIdx, info] of this.agents.entries()) {
      if (info.botId === botId) return seatIdx;
    }
    return -1;
  }

  /**
   * Kick one bot from the table to make room for a human.
   * Prefers bots that are NOT in an active hand (sitting_out/folded).
   * Returns the freed seat index, or -1 if no bot could be kicked.
   */
  private kickOneBot(): number {
    const handInProgress = this.isHandInProgress();
    // First pass: find a bot that's safe to remove (not actively playing)
    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      if (!p || p.kind !== 'bot') continue;
      if (handInProgress && (p.status === 'active' || p.status === 'allin')) continue;
      // Safe to kick — fold if needed and unseat
      const info = this.agents.get(i);
      if (p.status === 'active' || p.status === 'allin') p.status = 'folded';
      info?.agent.dispose();
      this.agents.delete(i);
      this.creditAndUnseat(i, p, p.userId);
      return i;
    }
    // Second pass: if hand in progress, find any bot (will be marked folded)
    if (handInProgress) {
      for (let i = 0; i < this.state.players.length; i++) {
        const p = this.state.players[i];
        if (!p || p.kind !== 'bot') continue;
        p.status = 'folded';
        const info = this.agents.get(i);
        info?.agent.dispose();
        this.agents.delete(i);
        // Defer unseat until hand completes
        (p as PlayerState & { _pendingLeave?: boolean })._pendingLeave = true;
        this.broadcastState();
        // Return a conceptually "freed" seat — but it's still occupied until hand ends.
        // The human will need to wait, so find an actually empty seat instead.
        const empty = this.findEmptySeat();
        if (empty !== -1) return empty;
      }
    }
    return -1;
  }

  /**
   * Auto-fill empty seats with system bots if at least one human is present.
   * Uses per-style preferred buyins, clamped by the table's min/max buyin.
   * Called after hand_complete cleanup.
   */
  private tryAutoFillBots(): void {
    const hasHuman = this.state.players.some(p => p !== null && p.kind === 'human');
    if (!hasHuman) return;
    if (this.findEmptySeat() === -1) return;

    const table = db.getTableById(this.tableId);
    if (!table) return;

    // Use level-appropriate bot pool, shuffled for variety
    const pool = table.level ? LEVEL_BOT_POOL[table.level as StakeLevelId] ?? [] : [];
    const poolSet = new Set(pool);
    const activeBots = SYSTEM_BOTS.filter(b => {
      if (pool.length > 0 && !poolSet.has(b.key)) return false;
      const dbBot = db.getBotById(b.botId);
      return dbBot && dbBot.status === 'active';
    });
    // Fisher-Yates shuffle
    for (let i = activeBots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [activeBots[i], activeBots[j]] = [activeBots[j], activeBots[i]];
    }
    this.autoFillBots(activeBots, table.min_buyin, table.max_buyin);
  }

  /**
   * Fill empty seats with system bots (no duplicates).
   * Called after a human joins to ensure the table is full.
   */
  autoFillBots(bots: typeof SYSTEM_BOTS, minBuyin: number, maxBuyin: number): void {
    for (const bot of bots) {
      if (this.findEmptySeat() === -1) break;
      if (this.findSeatByBotId(bot.botId) !== -1) continue;
      try {
        const buyin = resolveSystemBotBuyin(bot, this.state._bigBlind, minBuyin, maxBuyin);
        this.joinBot(bot.userId, bot.botId, bot.name, bot.binaryPath, buyin);
        console.log(`[Table ${this.tableId}] Bot ${bot.name} joined (buyin=${buyin})`);
      } catch (err) {
        console.error(`[Table ${this.tableId}] Bot ${bot.name} failed to join:`, (err as Error).message);
        continue;
      }
    }
  }

  getState(): TableState {
    return this.state;
  }

  dispose(): void {
    if (this._nextHandTimer) clearTimeout(this._nextHandTimer);
    wsHub.offTableAction(this.tableId);
    // Credit remaining stacks back to all players before disposing
    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      if (p && p.stack > 0) {
        const dbUser = db.getUserById(p.userId);
        if (dbUser) {
          db.updateUserChips(p.userId, dbUser.chips + p.stack);
        }
      }
    }
    for (const info of this.agents.values()) {
      info.agent.dispose();
    }
    this.agents.clear();
  }

  /** Returns true if no players are seated */
  isEmpty(): boolean {
    return this.state.players.every(p => p === null);
  }
}

// ─── Global table registry ────────────────────────────────────────────────────

// Use globalThis to share the singleton Map across Next.js webpack bundles
// and tsx runtime — otherwise API routes and WebSocket operate on separate instances.
const activeManagers: Map<string, TableManager> =
  (globalThis as Record<string, unknown>).__pokerActiveManagers as Map<string, TableManager>
  ?? ((globalThis as Record<string, unknown>).__pokerActiveManagers = new Map<string, TableManager>());

export function getTableManager(tableId: string): TableManager | null {
  return activeManagers.get(tableId) ?? null;
}

export function createTableManager(tableId: string): TableManager | null {
  const table = getTableById(tableId);
  if (!table) return null;

  const mgr = new TableManager(tableId, table.max_seats, table.small_blind, table.big_blind);
  activeManagers.set(tableId, mgr);
  return mgr;
}

export function getOrCreateTableManager(tableId: string): TableManager | null {
  return activeManagers.get(tableId) ?? createTableManager(tableId);
}

// ─── Stake level helpers ──────────────────────────────────────────────────

import { STAKE_LEVELS } from '@/lib/stake-levels';
import { listTablesForLevel, createTable as dbCreateTable, closeTable as dbCloseTable } from '@/db/queries';

/**
 * Find an existing open table for the given stake level that has an empty seat,
 * or create a new one. Returns the table ID.
 */
export function getOrCreateTableForLevel(level: StakeLevelId, createdBy: string): string {
  const config = getStakeLevel(level);
  if (!config) throw new Error(`未知的级别: ${level}`);

  // Check existing tables for this level
  const tables = listTablesForLevel(level);
  for (const t of tables) {
    const mgr = activeManagers.get(t.id);
    if (mgr) {
      const state = mgr.getState();
      // Skip tables where this user is already seated
      if (state.players.some(p => p !== null && p.userId === createdBy)) continue;
      const seatCount = state.players.filter((p: unknown) => p !== null).length;
      const hasBotToKick = state.players.some(p => p !== null && p.kind === 'bot');
      // Table is available if there's an empty seat OR a bot that can be kicked
      if (seatCount < config.maxSeats || hasBotToKick) {
        return t.id;
      }
    } else {
      // Table exists in DB but no active manager — 0 players, available
      return t.id;
    }
  }

  // No available table — create a new one
  const id = nanoid();
  dbCreateTable({
    id,
    name: `${config.name} #${id.slice(0, 4)}`,
    small_blind: config.smallBlind,
    big_blind: config.bigBlind,
    min_buyin: config.minBuyin,
    max_buyin: config.maxBuyin,
    max_seats: config.maxSeats,
    level,
    status: 'open',
    created_by: createdBy,
  });
  return id;
}

/** Get live player count for a table from in-memory state. */
export function getLivePlayerCount(tableId: string): number {
  const mgr = activeManagers.get(tableId);
  if (!mgr) return 0;
  return mgr.getState().players.filter((p: unknown) => p !== null).length;
}

/** Get aggregated player counts per stake level. */
export function getLevelPlayerCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const level of STAKE_LEVELS) counts[level.id] = 0;

  for (const [tableId, mgr] of activeManagers) {
    const dbTable = getTableById(tableId);
    if (dbTable?.level) {
      const playerCount = mgr.getState().players.filter((p: unknown) => p !== null).length;
      counts[dbTable.level] = (counts[dbTable.level] ?? 0) + playerCount;
    }
  }
  return counts;
}

/** Count of active table managers. */
export function getActiveTableCount(): number {
  return activeManagers.size;
}

/** Total online players across all active tables. */
export function getOnlinePlayerCount(): number {
  let count = 0;
  for (const mgr of activeManagers.values()) {
    count += mgr.getState().players.filter((p: unknown) => p !== null).length;
  }
  return count;
}

/** Total chips currently on tables (already deducted from DB balances). */
export function getInPlayChips(): number {
  let total = 0;
  for (const mgr of activeManagers.values()) {
    for (const p of mgr.getState().players) {
      if (p) total += p.stack;
    }
  }
  return total;
}

// ─── Admin helpers ──────────────────────────────────────────────────────────

export interface AdminTableSeat {
  seat: number;
  displayName: string;
  kind: 'human' | 'bot';
  stack: number;
  status: string;
}

export interface AdminTableInfo {
  id: string;
  name: string;
  level: string;
  levelName: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  status: string;
  handNumber: number;
  pot: number;
  players: AdminTableSeat[];
  playerCount: number;
  createdAt: number;
}

/** Return detail info for every active table (admin use). */
export function getActiveTableDetails(): AdminTableInfo[] {
  const result: AdminTableInfo[] = [];
  for (const [tableId, mgr] of activeManagers) {
    const dbTable = getTableById(tableId);
    if (!dbTable) continue;
    const state = mgr.getState();
    const stakeLevel = getStakeLevel(dbTable.level);
    const players: AdminTableSeat[] = [];
    for (const p of state.players) {
      if (!p) continue;
      players.push({
        seat: p.seatIndex,
        displayName: p.displayName,
        kind: p.kind,
        stack: p.stack,
        status: p.status,
      });
    }
    result.push({
      id: tableId,
      name: dbTable.name,
      level: dbTable.level,
      levelName: stakeLevel?.name ?? dbTable.level,
      smallBlind: dbTable.small_blind,
      bigBlind: dbTable.big_blind,
      maxSeats: dbTable.max_seats,
      status: state.status,
      handNumber: state.handNumber,
      pot: state.pot.total,
      players,
      playerCount: players.length,
      createdAt: dbTable.created_at,
    });
  }
  // Sort by level then creation time
  const levelOrder = ['micro', 'low', 'mid', 'high', 'elite'];
  result.sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level) || a.createdAt - b.createdAt);
  return result;
}

/** Force-close a table: dispose manager, mark DB closed, return chips. */
export function forceCloseTable(tableId: string): boolean {
  const mgr = activeManagers.get(tableId);
  if (!mgr) return false;
  mgr.dispose();
  activeManagers.delete(tableId);
  dbCloseTable(tableId);
  return true;
}

// ─── Idle cleanup ───────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  for (const [tableId, mgr] of activeManagers) {
    if (mgr.isEmpty() && now - mgr.lastActivity > IDLE_TIMEOUT_MS) {
      console.log(`[TableManager] Cleaning up idle table ${tableId}`);
      mgr.dispose();
      activeManagers.delete(tableId);
      dbCloseTable(tableId);
    }
  }
}, 60_000); // Check every minute
