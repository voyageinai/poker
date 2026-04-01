# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server (Next.js + WebSocket on port 3001)
npm run build        # Production build
npm run start        # Production server
npm run lint         # ESLint
npm run test         # Vitest (one-shot)
npm run test:watch   # Vitest (watch mode)
npx vitest run src/server/poker/__tests__/pot.test.ts  # Run a single test file
```

## Architecture

Self-hosted Texas Hold'em poker platform with Human/Bot mixed play. Next.js 16 full-stack with custom HTTP server (`server.ts`) that binds Next.js + WebSocket on the same port via `tsx`.

### Core game engine (`src/server/poker/`)

- **state-machine.ts** — Pure Texas Hold'em state machine: WAITING → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → HAND_COMPLETE. No I/O, all side effects are emitted as `TableEvent` objects consumed by `TableManager`
- **pot.ts** — Main pot / side pot calculation. Critical financial logic with 15+ test cases
- **agents.ts** — `PlayerAgent` interface with `HumanAgent` (WebSocket) and `BotAgent` (subprocess stdin/stdout). System bots use a built-in strategy engine (no subprocess), selected by `SystemBotStyle`
- **hand-eval.ts** — Wraps `pokersolver` for hand evaluation + Monte Carlo equity calculation
- **deck.ts** — Fisher-Yates shuffle, draw, burn, card utilities

### Server-side systems (`src/server/`)

- **table-manager.ts** — Bridges state machine with DB/WebSocket/Agents. Per-table async action queue (Promise chain) serializes all mutations. Auto-fills empty seats with system bots from the stake level's bot pool
- **ws.ts** — WebSocket Hub with **personalized push**: each connection receives filtered state. Hole cards are NEVER broadcast to other players
- **tournament-runner.ts** — SNG (Sit-and-Go) tournament engine with escalating blind schedules. Auto-starts when `max_players` register. Tracks elimination order for final rankings
- **bot-validator.ts** — Upload validation: spawns bot, sends probe hand, verifies PBP protocol compliance
- **elo.ts** — Pairwise Elo rating for multi-player hands (K=32)

### Database (`src/db/`)

SQLite via `better-sqlite3` with WAL mode. Schema in `schema.ts`, queries in `queries.ts`.

- **system-bots.ts** — Ensures built-in house bots exist in DB on startup, funded from treasury
- **audit.ts** — Fire-and-forget audit logging for admin/chips/account/tournament/system actions

**Key tables:** `users`, `poker_tables`, `table_seats`, `poker_hands`, `hand_players`, `hand_actions`, `poker_bots`, `tournaments`, `tournament_entries`, `elo_history`, `audit_log`, `treasury`, `invite_codes`

### Stake levels & system bots (`src/lib/`)

- **stake-levels.ts** — Four tiers (micro/low/mid/high) with Chinese Three Kingdoms themed names. Each tier defines blinds, buy-in range, min balance, rake, and a bot pool of house bots to auto-fill tables
- **system-bots.ts** — 11 built-in house bots with distinct play styles (`nit`, `tag`, `lag`, `station`, `maniac`, `trapper`, `bully`, `tilter`, `shortstack`, `adaptive`, `gto`). Each has a Three Kingdoms character identity (e.g. 司马懿 = nit, 吕布 = maniac)
- **runtime-config.ts** — `BASE_PATH` support for reverse proxy deployments, cookie config, WebSocket URL derivation

### Frontend (`src/app/`)

Next.js App Router. Pages: lobby (table list), table/[id] (live play), bots (upload/manage), tournaments, hand/[id] (replay), login/register, admin (user/bot/invite management), activity log.

### Bot Protocol (PBP) — stdin/stdout newline-delimited JSON

**Server → Bot:**
```json
{"type":"new_hand","handId":"...","seat":0,"stack":1000,"players":[...],"smallBlind":10,"bigBlind":20,"buttonSeat":0}
{"type":"hole_cards","cards":["Ah","Kd"]}
{"type":"action_request","street":"preflop","board":[],"pot":30,"toCall":20,"minRaise":20,"stack":980,"history":[]}
{"type":"player_action","seat":1,"action":"call","amount":20}
{"type":"street","name":"flop","board":["2h","7d","Jc"]}
{"type":"hand_over","winners":[{"seat":0,"amount":60}],"board":["2h","7d","Jc","Ks","4d"]}
```

**Bot → Server:**
```json
{"action":"call"}
{"action":"raise","amount":60,"debug":{"equity":0.72,"ev":14.2,"reasoning":"Value bet AK"}}
```

The `debug` field is optional — if present, the UI displays AI reasoning in the BotDebugPanel.

## Critical Conventions

### WebSocket privacy (SECURITY)

Hole cards are NEVER included in broadcast messages. Each player receives personalized state via `sendToUser()`. Showdown reveals cards to all only after hand concludes. Spectators see no hole cards until showdown.

### Card format

`Rank + Suit` — e.g. `"Ah"` (Ace of hearts), `"Td"` (Ten of diamonds), `"2c"` (Two of clubs). Suits: `h d c s`. Ranks: `2 3 4 5 6 7 8 9 T J Q K A`.

### Pot calculation

Side pots are built from per-player total bets sorted by all-in amounts. The `buildPotsWithEligible()` function returns eligible seats per pot level. Chip conservation is enforced: sum of all pots always equals sum of all bets. Folded players contribute chips but are never eligible to win.

### State machine purity

`state-machine.ts` has NO side effects — no DB, no WebSocket, no timers. It takes state + action, returns new state + events. All I/O is handled by `TableManager` which processes the events.

### Action queue

Every table has a per-table action queue (`Promise` chain) that serializes all mutations. This prevents concurrent WebSocket messages from corrupting the state machine.

### Bot lifecycle

Bots are spawned as subprocesses (one process per table session). They receive PBP messages on stdin, respond on stdout. Timeout = 5s per action (auto-fold). Process killed on table leave/dispose.

### Elo rating

Pairwise comparison among all bots in a hand. K=32 scaled by opponent count. Higher chip result = win, equal = draw. Updates recorded in `elo_history` table.

## Path alias

`@/*` maps to `./src/*` (configured in tsconfig.json and vitest.config.ts).

## Environment variables

See `.env.example`: `JWT_SECRET`, `INVITE_CODE`, `MAX_CONCURRENT_TABLES`, `BOT_UPLOAD_MAX_SIZE_MB`, `BOT_ACTION_TIMEOUT_MS`, `HUMAN_ACTION_TIMEOUT_MS`.

## Gotchas

1. **Hole card leakage** — If you add a new WebSocket message type, ensure it does NOT include other players' hole cards. Use `sendToUser()` for private data, `broadcast()` only for public state.
2. **Side pot edge cases** — `pot.ts` has 15+ tests. If you modify pot logic, run the full test suite. Chip conservation must hold.
3. **isStreetOver bug was already fixed** — The original implementation returned `true` when `bettable.length <= 1`, which skipped BB's response to all-in. Now correctly checks that all bettable players have acted AND matched the current bet.
4. **pokersolver has no @types** — Type declarations are in `src/types/pokersolver.d.ts`. Uses `[key: string]: unknown` index signature for dynamic properties (_seat, _idx).
5. **auth.ts uses dynamic import for cookies** — `getCurrentUser()` uses `await import('next/headers')` to avoid triggering AsyncLocalStorage errors when `server.ts` imports the auth module at startup.
6. **BB option** — Pre-flop, the big blind is removed from `streetActed` after posting, so they get a chance to raise even if no one else has.
