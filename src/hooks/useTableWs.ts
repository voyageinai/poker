'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  ClientTableState,
  ClientPlayerState,
  WsServerMessage,
  WsClientMessage,
  PokerAction,
  ActionType,
  Card,
  ShowdownResult,
  WinnerEntry,
} from '@/lib/types';
import { getWsUrl, withBasePath } from '@/lib/runtime-config';
import type { LogEntry } from '@/components/table/constants';

export type { ClientPlayerState };

// ─── WebSocket hook ───────────────────────────────────────────────────────────

export function useTableWs(tableId: string) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);
  const [tableState, setTableState] = useState<ClientTableState | null>(null);
  const [myHoleCards, setMyHoleCards] = useState<[Card, Card] | null>(null);
  const [actionRequest, setActionRequest] = useState<{ toCall: number; minRaise: number; timeoutMs: number } | null>(null);
  const [showdown, setShowdown] = useState<ShowdownResult[] | null>(null);
  const [lastWinners, setLastWinners] = useState<WinnerEntry[] | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [busted, setBusted] = useState<{ canRebuy: boolean; timeoutSec: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  /** Track the last locally-pushed action to deduplicate WS echoes */
  const lastLocalAction = useRef<{ seat: number; action: string; amount: number } | null>(null);

  const pushLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    const id = ++logIdRef.current;
    setActionLog(prev => [...prev.slice(-80), { ...entry, id }]);
  }, []);

  const sendMsg = useCallback((msg: WsClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  // HTTP fallback: fetch state via REST API
  const fetchStateHttp = useCallback(() => {
    fetch(withBasePath(`/api/tables/${tableId}`))
      .then(r => r.ok ? r.json() : null)
      .then((data: { state?: ClientTableState | null } | null) => {
        if (data?.state) {
          setTableState(data.state);
        }
      })
      .catch(() => {});
  }, [tableId]);

  // Start polling when WS is disconnected
  const startPolling = useCallback(() => {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(fetchStateHttp, 3000);
  }, [fetchStateHttp]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    unmounted.current = false;

    function connect() {
      if (unmounted.current) return;
      const socket = new WebSocket(getWsUrl());
      ws.current = socket;

      socket.onopen = () => {
        setError(null);
        setConnected(true);
        reconnectAttempt.current = 0;
        stopPolling();
        socket.send(JSON.stringify({ type: 'join_table', tableId } satisfies WsClientMessage));
      };

      socket.onclose = () => {
        if (unmounted.current) return;
        setConnected(false);
        // Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 15s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 15000);
        reconnectAttempt.current++;
        reconnectTimer.current = setTimeout(connect, delay);
        // Start HTTP polling while WS is down
        startPolling();
      };

      socket.onerror = () => {
        setError('WebSocket 连接失败 — 重试中...');
      };

      socket.onmessage = (e: MessageEvent) => {
        const msg = JSON.parse(e.data as string) as WsServerMessage;
        switch (msg.type) {
          case 'table_state': {
            setTableState(prev => {
              // New hand started → clear stale state from previous hand
              if (msg.state.handNumber > 0 && (!prev || msg.state.handNumber !== prev.handNumber)) {
                setActionLog([]);
                pushLog({ kind: 'new_hand', text: `第 ${msg.state.handNumber} 局开始` });
                setShowdown(null);
                setLastWinners(null);
                setIsReady(false);
                setBusted(null);
              }
              return msg.state;
            });
            setActionRequest(null);
            break;
          }
          case 'deal_hole_cards':
            setMyHoleCards(msg.cards);
            break;
          case 'action_request':
            setActionRequest({ toCall: msg.toCall, minRaise: msg.minRaise, timeoutMs: msg.timeoutMs });
            break;
          case 'showdown':
            setShowdown(msg.results);
            break;
          case 'hand_complete':
            setLastWinners(msg.winners);
            setActionRequest(null);
            // Keep showdown visible — cleared when next hand starts
            for (const w of msg.winners) {
              pushLog({ kind: 'winner', seat: w.seat, amount: w.amountWon, text: w.displayName });
            }
            break;
          case 'error':
            setError(msg.message);
            break;
          case 'busted':
            setBusted({ canRebuy: msg.canRebuy, timeoutSec: msg.timeoutSec });
            break;
          case 'rebuy_success':
            setBusted(null);
            break;
          case 'player_action': {
            // Deduplicate: skip if this is the WS echo of our own action we already logged locally
            const local = lastLocalAction.current;
            if (local && local.seat === msg.seat && local.action === msg.action && local.amount === (msg.amount ?? 0)) {
              lastLocalAction.current = null; // consumed
            } else {
              pushLog({ kind: 'action', seat: msg.seat, action: msg.action as ActionType, amount: msg.amount });
            }
            break;
          }
          case 'deal_board':
            pushLog({ kind: 'street', street: msg.street, cards: msg.cards });
            break;
          case 'player_joined':
          case 'player_left':
            break;
        }
      };
    }

    connect();

    // Initial HTTP fallback if WS is slow
    const initialFallback = setTimeout(() => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        fetchStateHttp();
      }
    }, 1500);

    return () => {
      unmounted.current = true;
      clearTimeout(initialFallback);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      stopPolling();
      ws.current?.close();
      ws.current = null;
    };
  }, [tableId, fetchStateHttp, startPolling, stopPolling]);

  const sendAction = useCallback((action: PokerAction) => {
    sendMsg({ type: 'action', action: action.action, amount: action.amount });
    setActionRequest(null);
    // Immediately log own action so it appears without waiting for WS echo
    setTableState(current => {
      if (current) {
        const mySeat = current.players.findIndex(p => p !== null && p.userId !== '__spectator__' && current.activeSeat === p.seatIndex);
        if (mySeat >= 0) {
          lastLocalAction.current = { seat: mySeat, action: action.action, amount: action.amount ?? 0 };
          pushLog({ kind: 'action', seat: mySeat, action: action.action as ActionType, amount: action.amount });
        }
      }
      return current;
    });
  }, [sendMsg, pushLog]);

  return { tableState, setTableState, myHoleCards, actionRequest, showdown, lastWinners, busted, connected, error, sendAction, sendMsg, actionLog, isReady, setIsReady };
}
