import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA } from './schema';
import { ensureSystemBots } from './system-bots';

export const TOTAL_SUPPLY = 21_000_000;

function resolveDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), 'poker.db');
}

// Use globalThis to share across Next.js webpack bundles and tsx runtime
const G = globalThis as Record<string, unknown>;

/** Migrate existing DB columns before SCHEMA creates new indexes */
function runMigrations(db: Database.Database): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  const tableNames = new Set(tables.map(t => t.name));

  // Skip on fresh DB — SCHEMA will create everything from scratch
  if (!tableNames.has('users')) return;

  // Add elo/games_played to users if missing (added 2026-03-31)
  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const userColNames = new Set(userCols.map(c => c.name));
  if (!userColNames.has('elo')) {
    db.exec('ALTER TABLE users ADD COLUMN elo REAL NOT NULL DEFAULT 1200');
  }
  if (!userColNames.has('games_played')) {
    db.exec('ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0');
  }

  // Add banned to users
  if (!userColNames.has('banned')) {
    db.exec('ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
  }

  // Add last_chip_refresh to users (added 2026-03-31)
  if (!userColNames.has('last_chip_refresh')) {
    db.exec('ALTER TABLE users ADD COLUMN last_chip_refresh INTEGER NOT NULL DEFAULT 0');
  }

  // Add level to poker_tables (added 2026-03-31)
  if (tableNames.has('poker_tables')) {
    const tableCols = db.prepare("PRAGMA table_info(poker_tables)").all() as Array<{ name: string }>;
    const tableColNames = new Set(tableCols.map(c => c.name));
    if (!tableColNames.has('level')) {
      db.exec("ALTER TABLE poker_tables ADD COLUMN level TEXT NOT NULL DEFAULT ''");
    }
  }

  // Rebuild elo_history to make bot_id nullable and add user_id (added 2026-03-31)
  if (tableNames.has('elo_history')) {
    const eloCols = db.prepare("PRAGMA table_info(elo_history)").all() as Array<{ name: string; notnull: number }>;
    const botIdCol = eloCols.find(c => c.name === 'bot_id');
    const hasUserId = eloCols.some(c => c.name === 'user_id');
    // Rebuild if bot_id is still NOT NULL or user_id is missing
    if ((botIdCol && botIdCol.notnull === 1) || !hasUserId) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS elo_history_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          bot_id      TEXT REFERENCES poker_bots(id),
          user_id     TEXT REFERENCES users(id),
          elo         REAL NOT NULL,
          hand_id     TEXT NOT NULL REFERENCES poker_hands(id),
          recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT INTO elo_history_new (id, bot_id, elo, hand_id, recorded_at)
          SELECT id, bot_id, elo, hand_id, recorded_at FROM elo_history;
        DROP TABLE elo_history;
        ALTER TABLE elo_history_new RENAME TO elo_history;
      `);
    }
  }
}

/** Initialize treasury: 21M - all existing user chips (only on first run). */
function initTreasury(db: Database.Database): void {
  const existing = db.prepare('SELECT balance FROM treasury WHERE id = 1').get() as { balance: number } | undefined;
  if (existing) return; // Already initialized

  const totalUserChips = (db.prepare('SELECT COALESCE(SUM(chips), 0) as total FROM users').get() as { total: number }).total;
  const treasuryBalance = TOTAL_SUPPLY - totalUserChips;
  db.prepare('INSERT INTO treasury (id, balance) VALUES (1, ?)').run(treasuryBalance);
  console.log(`[Treasury] Initialized: ${treasuryBalance.toLocaleString()} chips (${TOTAL_SUPPLY.toLocaleString()} - ${totalUserChips.toLocaleString()} existing)`);
}

export function getDb(): Database.Database {
  if (!G.__pokerDb) {
    const dbPath = resolveDbPath();
    const db = new Database(dbPath);
    runMigrations(db);  // migrate BEFORE schema so new indexes can reference new columns
    db.exec(SCHEMA);
    initTreasury(db);       // Treasury must exist before bots deduct from it
    ensureSystemBots(db);
    G.__pokerDb = db;
  }
  return G.__pokerDb as Database.Database;
}

/** Force-(re)initialize the database. Useful for tests with :memory: DBs. */
export function initDb(): void {
  // Close existing connection if any
  if (G.__pokerDb) {
    (G.__pokerDb as Database.Database).close();
    G.__pokerDb = undefined;
  }
  getDb();
}
