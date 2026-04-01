export const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  chips       INTEGER NOT NULL DEFAULT 10000,
  last_chip_refresh INTEGER NOT NULL DEFAULT 0,
  banned      INTEGER NOT NULL DEFAULT 0,
  elo         REAL NOT NULL DEFAULT 1200,
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT REFERENCES users(id),
  used_by     TEXT REFERENCES users(id),
  expires_at  INTEGER
);

CREATE TABLE IF NOT EXISTS poker_bots (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  binary_path TEXT NOT NULL,
  elo         REAL NOT NULL DEFAULT 1200,
  games_played INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'validating' CHECK(status IN ('validating','active','disabled','invalid')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS poker_tables (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  small_blind INTEGER NOT NULL DEFAULT 10,
  big_blind   INTEGER NOT NULL DEFAULT 20,
  min_buyin   INTEGER NOT NULL DEFAULT 200,
  max_buyin   INTEGER NOT NULL DEFAULT 2000,
  max_seats   INTEGER NOT NULL DEFAULT 6,
  level       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS table_seats (
  table_id    TEXT NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seat_index  INTEGER NOT NULL,
  user_id     TEXT REFERENCES users(id),
  bot_id      TEXT REFERENCES poker_bots(id),
  stack       INTEGER NOT NULL DEFAULT 0,
  is_sitting_out INTEGER NOT NULL DEFAULT 0,
  joined_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (table_id, seat_index)
);

CREATE TABLE IF NOT EXISTS poker_hands (
  id          TEXT PRIMARY KEY,
  table_id    TEXT NOT NULL REFERENCES poker_tables(id),
  hand_number INTEGER NOT NULL,
  button_seat INTEGER NOT NULL,
  board       TEXT NOT NULL DEFAULT '[]',
  pot         INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','complete')),
  started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hands_table ON poker_hands(table_id, hand_number DESC);

CREATE TABLE IF NOT EXISTS hand_players (
  hand_id     TEXT NOT NULL REFERENCES poker_hands(id),
  seat_index  INTEGER NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  bot_id      TEXT REFERENCES poker_bots(id),
  stack_start INTEGER NOT NULL,
  stack_end   INTEGER,
  hole_cards  TEXT,
  result      TEXT CHECK(result IN ('won','lost','push',NULL)),
  amount_won  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hand_id, seat_index)
);

CREATE TABLE IF NOT EXISTS hand_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id     TEXT NOT NULL REFERENCES poker_hands(id),
  seat_index  INTEGER NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  street      TEXT NOT NULL CHECK(street IN ('preflop','flop','turn','river')),
  action      TEXT NOT NULL CHECK(action IN ('fold','check','call','raise','allin')),
  amount      INTEGER NOT NULL DEFAULT 0,
  stack_after INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_actions_hand ON hand_actions(hand_id);

CREATE TABLE IF NOT EXISTS tournaments (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  buyin           INTEGER NOT NULL DEFAULT 100,
  starting_chips  INTEGER NOT NULL DEFAULT 5000,
  max_players     INTEGER NOT NULL DEFAULT 9,
  status          TEXT NOT NULL DEFAULT 'registering' CHECK(status IN ('registering','running','complete')),
  blind_schedule  TEXT NOT NULL DEFAULT '[]',
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at      INTEGER,
  ended_at        INTEGER
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  bot_id        TEXT REFERENCES poker_bots(id),
  chips         INTEGER NOT NULL,
  table_id      TEXT REFERENCES poker_tables(id),
  seat_index    INTEGER,
  eliminated_at INTEGER,
  final_rank    INTEGER,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS elo_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id      TEXT REFERENCES poker_bots(id),
  user_id     TEXT REFERENCES users(id),
  elo         REAL NOT NULL,
  hand_id     TEXT NOT NULL REFERENCES poker_hands(id),
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_elo_history_bot ON elo_history(bot_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_elo_history_user ON elo_history(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hand_players_user ON hand_players(user_id);

CREATE TABLE IF NOT EXISTS chip_codes (
  code        TEXT PRIMARY KEY,
  chips       INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  max_uses    INTEGER NOT NULL DEFAULT 1,
  use_count   INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS chip_code_redemptions (
  code        TEXT NOT NULL REFERENCES chip_codes(code) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  redeemed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS treasury (
  id          INTEGER PRIMARY KEY CHECK(id = 1),
  balance     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS rake_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hand_id     TEXT NOT NULL REFERENCES poker_hands(id),
  table_id    TEXT NOT NULL REFERENCES poker_tables(id),
  amount      INTEGER NOT NULL,
  pot_before  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_rake_history_table ON rake_history(table_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT REFERENCES users(id),
  category    TEXT NOT NULL CHECK(category IN ('admin','chips','account','tournament','system')),
  action      TEXT NOT NULL,
  target_id   TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target   ON audit_log(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_log(action, created_at DESC);
`;
