import { getDb, TOTAL_SUPPLY } from './index';
import { audit } from './audit';
import type { DbUser, DbBot, DbTable, DbHand, DbHandAction, DbHandPlayer, DbChipCode } from '@/lib/types';

// ─── Treasury ────────────────────────────────────────────────────────────────

export { TOTAL_SUPPLY };

export function getTreasuryBalance(): number {
  const row = getDb().prepare('SELECT balance FROM treasury WHERE id = 1').get() as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/**
 * Deduct chips from treasury. Returns false if insufficient balance.
 * Used for: new user registration, daily refresh, chip code redemption, admin grants.
 */
export function deductTreasury(amount: number): boolean {
  if (amount <= 0) return true;
  const result = getDb().prepare(
    'UPDATE treasury SET balance = balance - ?, updated_at = unixepoch() WHERE id = 1 AND balance >= ?'
  ).run(amount, amount);
  return result.changes > 0;
}

/**
 * Credit chips to treasury. Used for: rake collection, admin deductions.
 */
export function creditTreasury(amount: number): void {
  if (amount <= 0) return;
  getDb().prepare(
    'UPDATE treasury SET balance = balance + ?, updated_at = unixepoch() WHERE id = 1'
  ).run(amount);
}

/** Sum of all user chips (excluding system bots). */
export function sumPlayerChips(): number {
  return (getDb().prepare(
    "SELECT COALESCE(SUM(chips), 0) as total FROM users WHERE id NOT LIKE 'system:%'"
  ).get() as { total: number }).total;
}

/** Sum of system bot chips. */
export function sumSystemBotChips(): number {
  return (getDb().prepare(
    "SELECT COALESCE(SUM(chips), 0) as total FROM users WHERE id LIKE 'system:%'"
  ).get() as { total: number }).total;
}

/** Record a rake deduction for a hand. */
export function recordRake(handId: string, tableId: string, amount: number, potBefore: number): void {
  getDb().prepare(
    'INSERT INTO rake_history (hand_id, table_id, amount, pot_before) VALUES (?, ?, ?, ?)'
  ).run(handId, tableId, amount, potBefore);
}

/** Total rake collected. */
export function totalRakeCollected(): number {
  return (getDb().prepare('SELECT COALESCE(SUM(amount), 0) as total FROM rake_history').get() as { total: number }).total;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const NEW_USER_CHIPS = 10_000;

/**
 * Create a user and fund their initial chips from the treasury.
 * If treasury is insufficient, user is created with 0 chips.
 */
export function createUser(id: string, username: string, passwordHash: string, role: 'admin' | 'user' = 'user'): void {
  const funded = deductTreasury(NEW_USER_CHIPS);
  const chips = funded ? NEW_USER_CHIPS : 0;
  getDb().prepare(
    'INSERT INTO users (id, username, password_hash, role, chips) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username, passwordHash, role, chips);
}

export function getUserById(id: string): DbUser | null {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | null;
}

export function getUserByUsername(username: string): DbUser | null {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as DbUser | null;
}

export function updateUserChips(userId: string, chips: number): void {
  getDb().prepare('UPDATE users SET chips = ? WHERE id = ?').run(chips, userId);
}

export function updateUserElo(userId: string, elo: number, gamesPlayed: number): void {
  getDb().prepare('UPDATE users SET elo = ?, games_played = ? WHERE id = ?').run(elo, gamesPlayed, userId);
}

export function recordUserElo(userId: string, elo: number, handId: string): void {
  getDb().prepare(
    'INSERT INTO elo_history (user_id, elo, hand_id) VALUES (?, ?, ?)'
  ).run(userId, elo, handId);
}

export function getUserEloHistory(userId: string, limit = 50): Array<{ elo: number; recorded_at: number }> {
  return getDb().prepare(
    'SELECT elo, recorded_at FROM elo_history WHERE user_id=? ORDER BY recorded_at DESC LIMIT ?'
  ).all(userId, limit) as Array<{ elo: number; recorded_at: number }>;
}

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
}

// ─── Invite codes ─────────────────────────────────────────────────────────────

export function getInviteCode(code: string): { code: string; used_by: string | null; expires_at: number | null } | null {
  return getDb().prepare('SELECT * FROM invite_codes WHERE code = ?').get(code) as {
    code: string; used_by: string | null; expires_at: number | null
  } | null;
}

export function consumeInviteCode(code: string, userId: string): void {
  getDb().prepare('UPDATE invite_codes SET used_by = ? WHERE code = ?').run(userId, code);
}

// ─── Bots ─────────────────────────────────────────────────────────────────────

export function createBot(bot: Omit<DbBot, 'elo' | 'games_played' | 'created_at'>): void {
  getDb().prepare(
    'INSERT INTO poker_bots (id, user_id, name, description, binary_path, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(bot.id, bot.user_id, bot.name, bot.description, bot.binary_path, bot.status);
}

export function getBotById(id: string): DbBot | null {
  return getDb().prepare('SELECT * FROM poker_bots WHERE id = ?').get(id) as DbBot | null;
}

export function getBotsByUser(userId: string): DbBot[] {
  return getDb().prepare('SELECT * FROM poker_bots WHERE user_id = ? ORDER BY created_at DESC').all(userId) as DbBot[];
}

export function listActiveBots(): DbBot[] {
  return getDb().prepare("SELECT * FROM poker_bots WHERE status = 'active' ORDER BY elo DESC").all() as DbBot[];
}

export function updateBotStatus(id: string, status: DbBot['status']): void {
  getDb().prepare('UPDATE poker_bots SET status = ? WHERE id = ?').run(status, id);
}

export function updateBotElo(id: string, elo: number, gamesPlayed: number): void {
  getDb().prepare('UPDATE poker_bots SET elo = ?, games_played = ? WHERE id = ?').run(elo, gamesPlayed, id);
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export function createTable(t: Omit<DbTable, 'created_at'>): void {
  getDb().prepare(
    'INSERT INTO poker_tables (id, name, small_blind, big_blind, min_buyin, max_buyin, max_seats, level, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(t.id, t.name, t.small_blind, t.big_blind, t.min_buyin, t.max_buyin, t.max_seats, t.level ?? '', t.created_by);
}

export function getTableById(id: string): DbTable | null {
  return getDb().prepare('SELECT * FROM poker_tables WHERE id = ?').get(id) as DbTable | null;
}

export interface TableWithPlayerCount extends DbTable {
  player_count: number;
}

export function listOpenTables(): TableWithPlayerCount[] {
  return getDb().prepare(`
    SELECT t.*, COALESCE(s.cnt, 0) as player_count
    FROM poker_tables t
    LEFT JOIN (
      SELECT table_id, COUNT(*) as cnt FROM table_seats GROUP BY table_id
    ) s ON s.table_id = t.id
    WHERE t.status = 'open'
    ORDER BY t.created_at DESC
  `).all() as TableWithPlayerCount[];
}

/** List open tables for a specific stake level. */
export function listTablesForLevel(level: string): DbTable[] {
  return getDb().prepare(
    "SELECT * FROM poker_tables WHERE level = ? AND status = 'open' ORDER BY created_at ASC"
  ).all(level) as DbTable[];
}

/**
 * Daily chip refresh: if balance < 2000, set to 5000.
 * Idempotent per UTC calendar day via last_chip_refresh timestamp.
 */
export function maybeRefreshChips(userId: string): { refreshed: boolean; newBalance: number } {
  const user = getUserById(userId);
  if (!user) return { refreshed: false, newBalance: 0 };

  const now = Math.floor(Date.now() / 1000);
  const todayStart = now - (now % 86400); // UTC day boundary

  // Already refreshed today
  if (user.last_chip_refresh >= todayStart) {
    return { refreshed: false, newBalance: user.chips };
  }

  // Update timestamp regardless (so we don't re-check all day)
  if (user.chips >= 2000) {
    getDb().prepare('UPDATE users SET last_chip_refresh = ? WHERE id = ?').run(now, userId);
    return { refreshed: false, newBalance: user.chips };
  }

  // Actually refresh: top up to 5000 from treasury
  const needed = 5000 - user.chips;
  const funded = deductTreasury(needed);
  if (!funded) {
    // Treasury depleted — can't refresh
    getDb().prepare('UPDATE users SET last_chip_refresh = ? WHERE id = ?').run(now, userId);
    return { refreshed: false, newBalance: user.chips };
  }
  const newBalance = 5000;
  getDb().prepare('UPDATE users SET chips = ?, last_chip_refresh = ? WHERE id = ?').run(newBalance, now, userId);
  audit({
    userId,
    category: 'chips',
    action: 'daily_refresh',
    detail: { amount: needed, balanceBefore: user.chips, balanceAfter: newBalance },
  });
  return { refreshed: true, newBalance };
}

// ─── Player Stats ────────────────────────────────────────────────────────────

export interface PlayerStats {
  total_hands: number;
  win_count: number;
  loss_count: number;
  total_profit: number;
}

export function getPlayerStats(userId: string): PlayerStats {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) as total_hands,
      SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as win_count,
      SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as loss_count,
      SUM(COALESCE(stack_end, 0) - stack_start) as total_profit
    FROM hand_players
    WHERE user_id = ?
  `).get(userId) as { total_hands: number; win_count: number; loss_count: number; total_profit: number } | undefined;
  return row ?? { total_hands: 0, win_count: 0, loss_count: 0, total_profit: 0 };
}

// ─── Hands ────────────────────────────────────────────────────────────────────

export function createHand(h: {
  id: string;
  table_id: string;
  hand_number: number;
  button_seat: number;
  status: string;
}): void {
  getDb().prepare(
    'INSERT INTO poker_hands (id, table_id, hand_number, button_seat, status) VALUES (?, ?, ?, ?, ?)'
  ).run(h.id, h.table_id, h.hand_number, h.button_seat, h.status);
}

export function finishHand(id: string, board: string, pot: number): void {
  getDb().prepare(
    "UPDATE poker_hands SET status='complete', board=?, pot=?, ended_at=unixepoch() WHERE id=?"
  ).run(board, pot, id);
}

export function getHandsByTable(tableId: string, limit = 20): DbHand[] {
  return getDb().prepare(
    "SELECT * FROM poker_hands WHERE table_id=? AND status='complete' ORDER BY hand_number DESC LIMIT ?"
  ).all(tableId, limit) as DbHand[];
}

// ─── User hand history ───────────────────────────────────────────────────────

export interface UserHandRow {
  id: string;
  hand_number: number;
  table_name: string;
  pot: number;
  ended_at: number;
  hole_cards: string | null;
  result: string | null;
  stack_start: number;
  stack_end: number | null;
  amount_won: number;
}

export function getHandsByUserId(userId: string, params: { page?: number; pageSize?: number }): { rows: UserHandRow[]; total: number } {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const offset = (page - 1) * pageSize;

  const db = getDb();

  const total = (db.prepare(`
    SELECT COUNT(*) as n
    FROM hand_players hp
    JOIN poker_hands h ON hp.hand_id = h.id
    WHERE hp.user_id = ? AND h.status = 'complete'
  `).get(userId) as { n: number }).n;

  const rows = db.prepare(`
    SELECT h.id, h.hand_number, t.name AS table_name, h.pot, h.ended_at,
           hp.hole_cards, hp.result, hp.stack_start, hp.stack_end, hp.amount_won
    FROM hand_players hp
    JOIN poker_hands h ON hp.hand_id = h.id
    JOIN poker_tables t ON h.table_id = t.id
    WHERE hp.user_id = ? AND h.status = 'complete'
    ORDER BY h.ended_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset) as UserHandRow[];

  return { rows, total };
}

export function getHandById(id: string): DbHand | null {
  return getDb().prepare('SELECT * FROM poker_hands WHERE id=?').get(id) as DbHand | null;
}

// ─── Hand players ─────────────────────────────────────────────────────────────

export function insertHandPlayer(p: {
  hand_id: string;
  seat_index: number;
  user_id: string;
  bot_id: string | null;
  stack_start: number;
  hole_cards: string | null;
}): void {
  getDb().prepare(
    'INSERT INTO hand_players (hand_id, seat_index, user_id, bot_id, stack_start, hole_cards) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(p.hand_id, p.seat_index, p.user_id, p.bot_id ?? null, p.stack_start, p.hole_cards ?? null);
}

export function updateHandPlayer(handId: string, seatIndex: number, stackEnd: number, result: string, amountWon: number, holeCards: string | null): void {
  getDb().prepare(
    'UPDATE hand_players SET stack_end=?, result=?, amount_won=?, hole_cards=? WHERE hand_id=? AND seat_index=?'
  ).run(stackEnd, result, amountWon, holeCards, handId, seatIndex);
}

/** Update only hole cards (used at deal time; result/stack set at hand_complete) */
export function updateHandPlayerHoleCards(handId: string, seatIndex: number, holeCards: string): void {
  getDb().prepare(
    'UPDATE hand_players SET hole_cards=? WHERE hand_id=? AND seat_index=?'
  ).run(holeCards, handId, seatIndex);
}

export function getHandPlayers(handId: string): DbHandPlayer[] {
  return getDb().prepare('SELECT * FROM hand_players WHERE hand_id=?').all(handId) as DbHandPlayer[];
}

// ─── Hand actions ─────────────────────────────────────────────────────────────

export function insertHandAction(a: {
  hand_id: string;
  seat_index: number;
  user_id: string;
  street: string;
  action: string;
  amount: number;
  stack_after: number;
}): void {
  getDb().prepare(
    'INSERT INTO hand_actions (hand_id, seat_index, user_id, street, action, amount, stack_after) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(a.hand_id, a.seat_index, a.user_id, a.street, a.action, a.amount, a.stack_after);
}

export function getHandActions(handId: string): DbHandAction[] {
  return getDb().prepare('SELECT * FROM hand_actions WHERE hand_id=? ORDER BY id').all(handId) as DbHandAction[];
}

// ─── Elo ──────────────────────────────────────────────────────────────────────

export function recordElo(botId: string, elo: number, handId: string): void {
  getDb().prepare(
    'INSERT INTO elo_history (bot_id, elo, hand_id) VALUES (?, ?, ?)'
  ).run(botId, elo, handId);
}

export function getEloHistory(botId: string, limit = 50): Array<{ elo: number; recorded_at: number }> {
  return getDb().prepare(
    'SELECT elo, recorded_at FROM elo_history WHERE bot_id=? ORDER BY recorded_at DESC LIMIT ?'
  ).all(botId, limit) as Array<{ elo: number; recorded_at: number }>;
}

// ─── Tournaments ──────────────────────────────────────────────────────────────

export interface DbTournamentEntry {
  tournament_id: string;
  user_id: string;
  bot_id: string | null;
  chips: number;
  table_id: string | null;
  seat_index: number | null;
  eliminated_at: number | null;
  final_rank: number | null;
}

export function createTournament(t: {
  id: string;
  name: string;
  buyin: number;
  starting_chips: number;
  max_players: number;
  blind_schedule: string;
  created_by: string;
}): void {
  getDb().prepare(
    'INSERT INTO tournaments (id, name, buyin, starting_chips, max_players, blind_schedule, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(t.id, t.name, t.buyin, t.starting_chips, t.max_players, t.blind_schedule, t.created_by);
}

export function getTournamentById(id: string) {
  return getDb().prepare('SELECT * FROM tournaments WHERE id=?').get(id) as {
    id: string; name: string; buyin: number; starting_chips: number; max_players: number;
    status: string; blind_schedule: string; created_by: string; created_at: number;
    started_at: number | null; ended_at: number | null;
  } | null;
}

export function listTournaments() {
  return getDb().prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all() as Array<{
    id: string; name: string; buyin: number; starting_chips: number; max_players: number;
    status: string; blind_schedule: string; created_by: string; created_at: number;
    started_at: number | null; ended_at: number | null;
  }>;
}

export function registerForTournament(tournamentId: string, userId: string, botId: string | null, chips: number): void {
  getDb().prepare(
    'INSERT INTO tournament_entries (tournament_id, user_id, bot_id, chips) VALUES (?, ?, ?, ?)',
  ).run(tournamentId, userId, botId, chips);
}

export function getTournamentEntries(tournamentId: string): DbTournamentEntry[] {
  return getDb().prepare(
    'SELECT * FROM tournament_entries WHERE tournament_id=? ORDER BY final_rank ASC NULLS LAST',
  ).all(tournamentId) as DbTournamentEntry[];
}

export function updateTournamentStatus(id: string, status: string): void {
  if (status === 'running') {
    getDb().prepare("UPDATE tournaments SET status=?, started_at=unixepoch() WHERE id=?").run(status, id);
  } else if (status === 'complete') {
    getDb().prepare("UPDATE tournaments SET status=?, ended_at=unixepoch() WHERE id=?").run(status, id);
  } else {
    getDb().prepare("UPDATE tournaments SET status=? WHERE id=?").run(status, id);
  }
}

export function eliminatePlayer(tournamentId: string, userId: string, finalRank: number): void {
  getDb().prepare(
    'UPDATE tournament_entries SET eliminated_at=unixepoch(), final_rank=?, chips=0 WHERE tournament_id=? AND user_id=?',
  ).run(finalRank, tournamentId, userId);
}

export function updateTournamentEntry(tournamentId: string, userId: string, chips: number, tableId: string | null, seatIndex: number | null): void {
  getDb().prepare(
    'UPDATE tournament_entries SET chips=?, table_id=?, seat_index=? WHERE tournament_id=? AND user_id=?',
  ).run(chips, tableId, seatIndex, tournamentId, userId);
}

export function countTournamentEntries(tournamentId: string): number {
  return (getDb().prepare('SELECT COUNT(*) as n FROM tournament_entries WHERE tournament_id=?').get(tournamentId) as { n: number }).n;
}

// ─── Admin: Users ────────────────────────────────────────────────────────────

export function listAllUsers(search?: string): DbUser[] {
  if (search) {
    return getDb().prepare(
      "SELECT * FROM users WHERE id NOT LIKE 'system:%' AND username LIKE ? ORDER BY created_at DESC"
    ).all(`%${search}%`) as DbUser[];
  }
  return getDb().prepare(
    "SELECT * FROM users WHERE id NOT LIKE 'system:%' ORDER BY created_at DESC"
  ).all() as DbUser[];
}

export function updateUserRole(userId: string, role: 'admin' | 'user'): void {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

export function updateUserBanned(userId: string, banned: number): void {
  getDb().prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned, userId);
}

export function sumAllChips(): number {
  return (getDb().prepare(
    "SELECT COALESCE(SUM(chips), 0) as total FROM users WHERE id NOT LIKE 'system:%'"
  ).get() as { total: number }).total;
}

// ─── Admin: Stats ────────────────────────────────────────────────────────────

export function recentCompletedHands(limit: number = 10): DbHand[] {
  return getDb().prepare(
    "SELECT * FROM poker_hands WHERE status = 'complete' ORDER BY ended_at DESC LIMIT ?"
  ).all(limit) as DbHand[];
}

// ─── Admin: Bots ─────────────────────────────────────────────────────────────

export interface BotWithOwner extends DbBot {
  owner_username: string;
  owner_chips: number;
}

export function listAllBotsWithOwner(): BotWithOwner[] {
  return getDb().prepare(`
    SELECT b.*, u.username as owner_username, u.chips as owner_chips
    FROM poker_bots b
    JOIN users u ON u.id = b.user_id
    ORDER BY b.created_at DESC
  `).all() as BotWithOwner[];
}

// ─── Chip Codes ──────────────────────────────────────────────────────────────

export function createChipCode(
  code: string, chips: number, createdBy: string,
  maxUses: number, expiresAt: number | null,
): void {
  getDb().prepare(
    'INSERT INTO chip_codes (code, chips, created_by, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(code, chips, createdBy, maxUses, expiresAt);
}

export function listChipCodes(): DbChipCode[] {
  return getDb().prepare('SELECT * FROM chip_codes ORDER BY created_at DESC').all() as DbChipCode[];
}

export function revokeChipCode(code: string): void {
  getDb().prepare('DELETE FROM chip_codes WHERE code = ?').run(code);
}

export function redeemChipCode(code: string, userId: string): { ok: boolean; chips?: number; error?: string } {
  const database = getDb();
  const txn = database.transaction(() => {
    const c = database.prepare('SELECT * FROM chip_codes WHERE code = ?').get(code) as DbChipCode | null;
    if (!c) return { ok: false, error: '无效的兑换码' };
    if (c.expires_at && c.expires_at < Math.floor(Date.now() / 1000)) {
      return { ok: false, error: '兑换码已过期' };
    }
    if (c.use_count >= c.max_uses) {
      return { ok: false, error: '兑换码已用完' };
    }
    const already = database.prepare(
      'SELECT 1 FROM chip_code_redemptions WHERE code = ? AND user_id = ?'
    ).get(code, userId);
    if (already) return { ok: false, error: '你已经使用过该兑换码' };

    // Deduct from treasury
    const treasuryRow = database.prepare('SELECT balance FROM treasury WHERE id = 1').get() as { balance: number } | undefined;
    if (!treasuryRow || treasuryRow.balance < c.chips) {
      return { ok: false, error: '国库余额不足，无法兑换' };
    }
    database.prepare('UPDATE treasury SET balance = balance - ?, updated_at = unixepoch() WHERE id = 1').run(c.chips);

    database.prepare('UPDATE chip_codes SET use_count = use_count + 1 WHERE code = ?').run(code);
    database.prepare('UPDATE users SET chips = chips + ? WHERE id = ?').run(c.chips, userId);
    database.prepare(
      'INSERT INTO chip_code_redemptions (code, user_id) VALUES (?, ?)'
    ).run(code, userId);

    return { ok: true, chips: c.chips };
  });
  return txn();
}
