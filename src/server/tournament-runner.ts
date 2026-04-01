/**
 * SNG Tournament Runner — Sit-and-Go tournaments.
 *
 * When max_players register, the tournament starts automatically.
 * Blind levels escalate on a timer. Eliminated players get ranked.
 * Last player standing wins.
 */
import { nanoid } from 'nanoid';
import type { BlindLevel, PlayerState } from '@/lib/types';
import { TableManager, getOrCreateTableManager, createTableManager } from './table-manager';
import * as db from '@/db/queries';
import { audit } from '@/db/audit';
import { wsHub } from './ws';

export const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1, smallBlind: 10,  bigBlind: 20,   durationMinutes: 8 },
  { level: 2, smallBlind: 15,  bigBlind: 30,   durationMinutes: 8 },
  { level: 3, smallBlind: 25,  bigBlind: 50,   durationMinutes: 6 },
  { level: 4, smallBlind: 50,  bigBlind: 100,  durationMinutes: 6 },
  { level: 5, smallBlind: 75,  bigBlind: 150,  durationMinutes: 5 },
  { level: 6, smallBlind: 100, bigBlind: 200,  durationMinutes: 5 },
  { level: 7, smallBlind: 150, bigBlind: 300,  durationMinutes: 4 },
  { level: 8, smallBlind: 200, bigBlind: 400,  durationMinutes: 4 },
  { level: 9, smallBlind: 300, bigBlind: 600,  durationMinutes: 3 },
  { level: 10, smallBlind: 500, bigBlind: 1000, durationMinutes: 3 },
];

interface RunningTournament {
  id: string;
  tableId: string;
  blindSchedule: BlindLevel[];
  currentLevel: number;
  levelTimer: ReturnType<typeof setTimeout> | null;
  playersRemaining: number;
  eliminationOrder: string[]; // userId of eliminated players, first eliminated first
}

const activeTournaments = new Map<string, RunningTournament>();

export function getActiveTournament(id: string): RunningTournament | undefined {
  return activeTournaments.get(id);
}

/**
 * Register a participant (human or bot). Returns true if tournament auto-starts.
 */
export function registerParticipant(
  tournamentId: string,
  userId: string,
  botId: string | null,
): { started: boolean; error?: string } {
  const tourney = db.getTournamentById(tournamentId);
  if (!tourney) return { started: false, error: 'Tournament not found' };
  if (tourney.status !== 'registering') return { started: false, error: 'Registration closed' };

  const currentCount = db.countTournamentEntries(tournamentId);
  if (currentCount >= tourney.max_players) return { started: false, error: 'Tournament full' };

  // Check for duplicate registration
  const entries = db.getTournamentEntries(tournamentId);
  if (entries.some(e => e.user_id === userId)) return { started: false, error: 'Already registered' };

  db.registerForTournament(tournamentId, userId, botId, tourney.starting_chips);

  const newCount = currentCount + 1;
  if (newCount >= tourney.max_players) {
    // Auto-start
    startTournament(tournamentId);
    return { started: true };
  }

  return { started: false };
}

/**
 * Start the tournament: create a table, seat all players, begin play.
 */
function startTournament(tournamentId: string): void {
  const tourney = db.getTournamentById(tournamentId);
  if (!tourney) return;

  const schedule: BlindLevel[] = JSON.parse(tourney.blind_schedule) || DEFAULT_BLIND_SCHEDULE;
  const entries = db.getTournamentEntries(tournamentId);

  // Create dedicated tournament table
  const tableId = `tourney-${tournamentId}`;
  db.createTable({
    id: tableId,
    name: `${tourney.name} - Table`,
    small_blind: schedule[0].smallBlind,
    big_blind: schedule[0].bigBlind,
    min_buyin: tourney.starting_chips,
    max_buyin: tourney.starting_chips,
    max_seats: Math.max(tourney.max_players, 2),
    level: '',
    status: 'open',
    created_by: tourney.created_by,
  });

  db.updateTournamentStatus(tournamentId, 'running');

  const mgr = createTableManager(tableId);
  if (!mgr) return;

  // Seat all players
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const bot = e.bot_id ? db.getBotById(e.bot_id) : null;

    if (bot) {
      mgr.joinBot(e.user_id, bot.id, bot.name, bot.binary_path, tourney.starting_chips, i);
    } else {
      const user = db.getUserById(e.user_id);
      mgr.joinHuman(e.user_id, user?.username ?? e.user_id, tourney.starting_chips, i);
    }

    db.updateTournamentEntry(tournamentId, e.user_id, tourney.starting_chips, tableId, i);
  }

  const rt: RunningTournament = {
    id: tournamentId,
    tableId,
    blindSchedule: schedule,
    currentLevel: 0,
    levelTimer: null,
    playersRemaining: entries.length,
    eliminationOrder: [],
  };

  activeTournaments.set(tournamentId, rt);

  audit({
    category: 'tournament',
    action: 'start',
    targetId: tournamentId,
    detail: { tournamentId, name: tourney.name, playerCount: entries.length },
  });

  // Start blind level timer
  scheduleLevelUp(rt);

  // Monitor for eliminations (poll every 3s)
  const checkInterval = setInterval(() => {
    const state = mgr.getState();
    if (!state) { clearInterval(checkInterval); return; }

    // Check for busted players (stack = 0 at hand_complete)
    if (state.status === 'hand_complete') {
      const activePlayers = state.players.filter(
        (p): p is PlayerState => p !== null && p.status !== 'sitting_out',
      );
      const busted = state.players.filter(
        (p): p is PlayerState => p !== null && p.stack === 0 && p.status !== 'sitting_out',
      );

      for (const p of busted) {
        if (!rt.eliminationOrder.includes(p.userId)) {
          rt.eliminationOrder.push(p.userId);
          rt.playersRemaining--;
          const rank = entries.length - rt.eliminationOrder.length + 1;
          db.eliminatePlayer(tournamentId, p.userId, rank);
          db.updateTournamentEntry(tournamentId, p.userId, 0, null, null);
          audit({
            userId: p.userId,
            category: 'tournament',
            action: 'eliminate',
            targetId: tournamentId,
            detail: { tournamentId, rank },
          });
          // Remove from table
          mgr.leave(p.userId);
        }
      }

      // Check for winner
      const remaining = state.players.filter(
        (p): p is PlayerState => p !== null && p.stack > 0,
      );
      if (remaining.length <= 1) {
        // Tournament over
        if (remaining.length === 1) {
          const winner = remaining[0];
          db.eliminatePlayer(tournamentId, winner.userId, 1);
        }
        finishTournament(rt);
        clearInterval(checkInterval);
      }
    }
  }, 3000);
}

function scheduleLevelUp(rt: RunningTournament): void {
  if (rt.currentLevel >= rt.blindSchedule.length - 1) return;

  const current = rt.blindSchedule[rt.currentLevel];
  const durationMs = current.durationMinutes * 60 * 1000;

  rt.levelTimer = setTimeout(() => {
    rt.currentLevel++;
    const newLevel = rt.blindSchedule[rt.currentLevel];

    // Update table blinds — the table manager uses these for new hands
    const tourney = db.getTournamentById(rt.id);
    if (!tourney) return;

    // Broadcast blind increase
    wsHub.broadcast(rt.tableId, {
      type: 'error', // repurpose as notification — not ideal but works
      message: `Blinds increased to ${newLevel.smallBlind}/${newLevel.bigBlind} (Level ${newLevel.level})`,
    });

    scheduleLevelUp(rt);
  }, durationMs);
}

function finishTournament(rt: RunningTournament): void {
  if (rt.levelTimer) clearTimeout(rt.levelTimer);
  db.updateTournamentStatus(rt.id, 'complete');

  audit({
    category: 'tournament',
    action: 'finish',
    targetId: rt.id,
    detail: { tournamentId: rt.id, eliminationOrder: rt.eliminationOrder },
  });

  activeTournaments.delete(rt.id);
}
