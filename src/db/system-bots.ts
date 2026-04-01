import type Database from 'better-sqlite3';
import { SYSTEM_BOTS } from '@/lib/system-bots';

const SYSTEM_BOT_INITIAL_CHIPS = 1_000_000;

export function ensureSystemBots(db: Database.Database): void {
  const checkUser = db.prepare('SELECT id FROM users WHERE id = ?');
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, chips)
    VALUES (?, ?, ?, 'user', ?)
  `);
  const syncUser = db.prepare(`
    UPDATE users
    SET username = ?, password_hash = ?, role = 'user'
    WHERE id = ?
  `);
  const insertBot = db.prepare(`
    INSERT OR IGNORE INTO poker_bots (id, user_id, name, description, binary_path, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `);
  const syncBot = db.prepare(`
    UPDATE poker_bots
    SET user_id = ?, name = ?, description = ?, binary_path = ?, status = 'active'
    WHERE id = ?
  `);
  const deductTreasury = db.prepare(
    'UPDATE treasury SET balance = balance - ?, updated_at = unixepoch() WHERE id = 1 AND balance >= ?'
  );

  for (const bot of SYSTEM_BOTS) {
    const passwordHash = `!${bot.userId}`;
    const existing = checkUser.get(bot.userId);

    if (!existing) {
      // New bot — try to fund from treasury, fall back to 0
      let chips = SYSTEM_BOT_INITIAL_CHIPS;
      const treasuryRow = db.prepare('SELECT balance FROM treasury WHERE id = 1').get() as { balance: number } | undefined;
      if (treasuryRow && treasuryRow.balance >= chips) {
        deductTreasury.run(chips, chips);
      } else {
        chips = 0; // Treasury not yet initialized or insufficient
      }
      insertUser.run(bot.userId, bot.username, passwordHash, chips);
    } else {
      syncUser.run(bot.username, passwordHash, bot.userId);
    }

    insertBot.run(bot.botId, bot.userId, bot.name, bot.description, bot.binaryPath);
    syncBot.run(bot.userId, bot.name, bot.description, bot.binaryPath, bot.botId);
  }
}
