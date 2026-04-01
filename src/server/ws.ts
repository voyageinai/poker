/**
 * WebSocket Hub — personalized push per connection.
 *
 * Critical: NEVER broadcast raw game state. Each connection gets a filtered
 * view that only includes their own hole cards. Other players' hole cards
 * are scrubbed to null until showdown.
 *
 * Connection lifecycle:
 *   1. Client connects and sends { type: 'join_table', tableId }
 *   2. Hub registers connection under tableId + userId
 *   3. On any table event, sendToTable() fans out personalized states
 *   4. Client sends { type: 'action', ... } → forwarded to HumanAgent
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import type { WsServerMessage, WsClientMessage } from '@/lib/types';
import { verifyToken } from '@/lib/auth';
import { AUTH_COOKIE_NAME, readCookieValue, withBasePath } from '@/lib/runtime-config';

export interface WsConnection {
  ws: WebSocket;
  userId: string;
  tableId: string;
}

// Per-table action listener registered by TableManager
export type ActionListener = (userId: string, msg: WsClientMessage) => void;

class WsHub {
  private wss: WebSocketServer | null = null;
  // tableId → Set of connections
  private tables = new Map<string, Set<WsConnection>>();
  // tableId → action listener (set by TableManager)
  private actionListeners = new Map<string, ActionListener>();

  init(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });
    const wsPath = withBasePath('/ws');

    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const pathname = req.url?.split('?')[0];
      if (pathname !== wsPath) return;
      this.wss!.handleUpgrade(req, socket as import('net').Socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      let conn: WsConnection | null = null;
      const upgradeToken = this.getTokenFromUpgradeRequest(req);

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WsClientMessage;

          if (msg.type === 'join_table') {
            // Authenticate — allow anonymous spectators (userId = '__spectator__')
            const payload = (msg.token ? verifyToken(msg.token) : null) ?? verifyToken(upgradeToken ?? '');
            const userId = payload?.userId ?? '__spectator__';

            // Register
            conn = { ws, userId, tableId: msg.tableId };
            if (!this.tables.has(msg.tableId)) {
              this.tables.set(msg.tableId, new Set());
            }
            this.tables.get(msg.tableId)!.add(conn);
            void this.sendInitialState(msg.tableId, userId, ws);
            return;
          }

          // Forward action / sit-out / sit-in to TableManager
          if (conn) {
            const listener = this.actionListeners.get(conn.tableId);
            listener?.(conn.userId, msg);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        if (conn) {
          this.tables.get(conn.tableId)?.delete(conn);
          // Auto-leave: if this was the player's only connection to this table,
          // trigger leave so their chips get credited back.
          const remaining = this.tables.get(conn.tableId);
          const stillConnected = remaining && [...remaining].some(c => c.userId === conn!.userId);
          if (!stillConnected) {
            import('./table-manager').then(({ getTableManager }) => {
              const mgr = getTableManager(conn!.tableId);
              mgr?.leave(conn!.userId);
            }).catch(() => {});
          }
        }
      });

      ws.on('error', () => ws.close());
    });
  }

  private getTokenFromUpgradeRequest(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const cookieHeader = req.headers.cookie ?? '';
    return readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  }

  private async sendInitialState(tableId: string, userId: string, ws: WebSocket): Promise<void> {
    try {
      const [{ getOrCreateTableManager }, { toClientState }] = await Promise.all([
        import('./table-manager'),
        import('./poker/state-machine'),
      ]);

      // Auto-create manager if table exists but no active manager (e.g. after server restart)
      const mgr = getOrCreateTableManager(tableId);
      const state = mgr?.getState();

      if (ws.readyState !== WebSocket.OPEN) return;

      if (!state) {
        ws.send(JSON.stringify({ type: 'error', message: 'no_active_game' } satisfies WsServerMessage));
        return;
      }

      ws.send(JSON.stringify({
        type: 'table_state',
        state: toClientState(state, userId),
      } satisfies WsServerMessage));

      // If it's this user's turn, resend action_request so they can act after reconnect
      if (state.activeSeat >= 0) {
        const activePlayer = state.players[state.activeSeat];
        if (activePlayer && activePlayer.userId === userId) {
          ws.send(JSON.stringify({
            type: 'action_request',
            seat: state.activeSeat,
            toCall: state.currentBet - activePlayer.streetBet,
            minRaise: state.minRaise,
            timeoutMs: 30000,
          } satisfies WsServerMessage));
        }
      }
    } catch (err) {
      console.error('[ws] sendInitialState error:', err);
    }
  }

  /** Register an action listener for a table (called by TableManager on startup) */
  onTableAction(tableId: string, listener: ActionListener): void {
    this.actionListeners.set(tableId, listener);
  }

  /** Remove action listener when table closes */
  offTableAction(tableId: string): void {
    this.actionListeners.delete(tableId);
  }

  /**
   * Send a personalized message to one specific user at a table.
   * Used for deal_hole_cards (only that player sees their own cards).
   */
  sendToUser(tableId: string, userId: string, msg: WsServerMessage): void {
    const conns = this.tables.get(tableId);
    if (!conns) return;
    const payload = JSON.stringify(msg);
    for (const conn of conns) {
      if (conn.userId === userId && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast a message to ALL connections at a table.
   * Must NOT contain hole cards — use sendToUser for those.
   */
  broadcast(tableId: string, msg: WsServerMessage): void {
    const conns = this.tables.get(tableId);
    if (!conns) return;
    const payload = JSON.stringify(msg);
    const dead: WsConnection[] = [];
    for (const conn of conns) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(payload);
      } else {
        dead.push(conn);
      }
    }
    for (const conn of dead) conns.delete(conn);
  }

  /** Get all connected userIds for a table (for reconnect awareness) */
  connectedUsers(tableId: string): string[] {
    const conns = this.tables.get(tableId);
    if (!conns) return [];
    return [...conns]
      .filter(c => c.ws.readyState === WebSocket.OPEN)
      .map(c => c.userId);
  }
}

// Use globalThis to share the singleton across Next.js webpack bundles and tsx runtime
export const wsHub: WsHub =
  (globalThis as Record<string, unknown>).__pokerWsHub as WsHub
  ?? ((globalThis as Record<string, unknown>).__pokerWsHub = new WsHub());
