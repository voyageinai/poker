import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, initDb } from '@/db';
import { getHandsByUserId, getPlayerStats } from '@/db/queries';

// Seed test data directly — no table-manager needed
function seed() {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, chips) VALUES ('u1', 'testuser', 'x', 1000)").run();
  db.prepare("INSERT OR IGNORE INTO poker_tables (id, name, small_blind, big_blind, min_buyin, max_buyin, max_seats, level, created_by) VALUES ('t1', '测试桌', 10, 20, 200, 2000, 6, 'micro', 'u1')").run();
  for (let i = 1; i <= 5; i++) {
    db.prepare(
      "INSERT OR IGNORE INTO poker_hands (id, table_id, hand_number, button_seat, board, pot, status, started_at, ended_at) VALUES (?, 't1', ?, 0, '[\"Ah\",\"Kd\",\"Qc\",\"Js\",\"Th\"]', ?, 'complete', unixepoch() - ?, unixepoch() - ?)"
    ).run(`h${i}`, i, i * 100, (6 - i) * 60, (6 - i) * 60);
    db.prepare(
      "INSERT OR IGNORE INTO hand_players (hand_id, seat_index, user_id, stack_start, stack_end, result, amount_won, hole_cards) VALUES (?, 0, 'u1', 500, ?, ?, ?, '[\"Ah\",\"Kd\"]')"
    ).run(`h${i}`, i % 2 === 0 ? 600 : 400, i % 2 === 0 ? 'won' : 'lost', i % 2 === 0 ? 100 : 0);
  }
  db.prepare(
    "INSERT OR IGNORE INTO poker_hands (id, table_id, hand_number, button_seat, status) VALUES ('h-active', 't1', 99, 0, 'active')"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO hand_players (hand_id, seat_index, user_id, stack_start) VALUES ('h-active', 0, 'u1', 500)"
  ).run();
}

describe('getHandsByUserId', () => {
  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    initDb();
    seed();
  });

  it('returns completed hands for the user, ordered by ended_at DESC', () => {
    const result = getHandsByUserId('u1', { page: 1, pageSize: 10 });
    expect(result.total).toBe(5);
    expect(result.rows.length).toBe(5);
    expect(result.rows[0].hand_number).toBe(5);
    expect(result.rows[4].hand_number).toBe(1);
  });

  it('includes table_name, my profit fields, and hole_cards', () => {
    const result = getHandsByUserId('u1', { page: 1, pageSize: 10 });
    const row = result.rows[0];
    expect(row.table_name).toBe('测试桌');
    expect(row).toHaveProperty('stack_start');
    expect(row).toHaveProperty('stack_end');
    expect(row).toHaveProperty('hole_cards');
    expect(row).toHaveProperty('result');
    expect(row).toHaveProperty('amount_won');
  });

  it('paginates correctly', () => {
    const p1 = getHandsByUserId('u1', { page: 1, pageSize: 2 });
    expect(p1.rows.length).toBe(2);
    expect(p1.total).toBe(5);
    const p2 = getHandsByUserId('u1', { page: 2, pageSize: 2 });
    expect(p2.rows.length).toBe(2);
    const p3 = getHandsByUserId('u1', { page: 3, pageSize: 2 });
    expect(p3.rows.length).toBe(1);
  });

  it('returns empty for unknown user', () => {
    const result = getHandsByUserId('nobody', { page: 1, pageSize: 10 });
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });
});
