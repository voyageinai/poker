'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import HandHistorySidebar from '@/components/HandHistorySidebar';
import { Button } from '@/components/ui/button';
import type { ClientTableState, ClientPlayerState } from '@/lib/types';
import { withBasePath } from '@/lib/runtime-config';
import { useTableWs } from '@/hooks/useTableWs';
import { useIsMobile } from '@/hooks/useMediaQuery';
import TableHeader from '@/components/table/TableHeader';
import TableFelt from '@/components/table/TableFelt';
import ActionBar from '@/components/table/ActionBar';
import ActionLog from '@/components/table/ActionLog';
import ShowdownPanel from '@/components/table/ShowdownPanel';
import HeroSeat from '@/components/table/HeroSeat';
import { refreshNavChips } from '@/components/Nav';
import { MessageSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Main table page ──────────────────────────────────────────────────────────

export default function TablePage() {
  const params = useParams();
  const tableId = params.id as string;
  const isMobile = useIsMobile();
  const {
    tableState,
    setTableState,
    myHoleCards,
    actionRequest,
    showdown,
    lastWinners,
    showBluff,
    busted,
    connected,
    error,
    sendAction,
    sendMsg,
    actionLog,
    isReady,
    setIsReady,
  } = useTableWs(tableId);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isSeated, setIsSeated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [tableInfo, setTableInfo] = useState<{ min_buyin: number; max_buyin: number } | null>(null);
  const [sitDownError, setSitDownError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(async (res) => {
        if (!res.ok) return null;
        return await res.json() as { userId?: string };
      })
      .then((data) => setCurrentUserId(data?.userId ?? null))
      .catch(() => setCurrentUserId(null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    fetch(withBasePath(`/api/tables/${tableId}`))
      .then(r => r.ok ? r.json() : null)
      .then((data: { table?: { min_buyin: number; max_buyin: number } } | null) => {
        if (data?.table) setTableInfo({ min_buyin: data.table.min_buyin, max_buyin: data.table.max_buyin });
      })
      .catch(() => {});
  }, [tableId]);

  useEffect(() => {
    if (tableState && currentUserId) {
      const seated = tableState.players.some(p => p !== null && p.userId === currentUserId);
      setIsSeated(seated);
    }
  }, [tableState, currentUserId]);

  async function handleLeave() {
    try {
      await fetch(withBasePath(`/api/tables/${tableId}/leave`), { method: 'POST' });
      setIsSeated(false);
      refreshNavChips();
    } catch {}
  }

  async function handleSitDown(seatIndex?: number) {
    if (!currentUserId) {
      window.location.href = withBasePath('/login');
      return;
    }
    setSitDownError(null);
    const buyin = tableInfo?.min_buyin ?? 1000;
    try {
      const res = await fetch(withBasePath(`/api/tables/${tableId}/join`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyin, seatIndex }),
      });
      if (res.ok) {
        setIsSeated(true);
        refreshNavChips();
        const stateRes = await fetch(withBasePath(`/api/tables/${tableId}`));
        if (stateRes.ok) {
          const data = await stateRes.json() as { state?: ClientTableState | null };
          if (data?.state) setTableState(data.state);
        }
      } else {
        const data = await res.json() as { error?: string };
        setSitDownError(data?.error ?? `Failed to sit down (${res.status})`);
      }
    } catch {
      setSitDownError('网络错误 — 请重试');
    }
  }

  if (!tableState) {
    return (
      <div className="p-8 md:p-16 text-center">
        <div className="text-xl md:text-2xl mb-3 font-mono text-teal">
          {connected ? '加载桌子中...' : '等待游戏...'}
        </div>
        <div className="text-text-muted text-[0.85rem] md:text-[0.9rem] mb-6">
          等待玩家入座...点击空座位入座或添加 Bot。
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="teal" onClick={() => handleSitDown()} disabled={authLoading} className="h-11 px-6 text-base md:h-auto md:px-4 md:text-sm">
            {authLoading ? '加载中...' : currentUserId ? '入座' : '登录游玩'}
          </Button>
        </div>
        {(error || sitDownError) && (
          <div className="text-[0.85rem] text-loss mt-4">
            {sitDownError ?? error}
          </div>
        )}
      </div>
    );
  }

  const myPlayer = tableState.players.find(
    (p): p is ClientPlayerState => p !== null && p.userId === currentUserId
  ) ?? null;
  const isMyTurn = myPlayer !== null && tableState.activeSeat === myPlayer.seatIndex && actionRequest !== null;
  const heroSeat = myPlayer?.seatIndex ?? null;
  const winnerSeats = new Set(lastWinners?.map(w => w.seat) ?? []);

  // ─── Mobile Layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col mx-[-0.5rem] overflow-x-hidden" style={{ height: 'calc(100dvh - 2.75rem)' }}>
        {/* Compact mobile header */}
        <TableHeader
          tableId={tableId}
          tableState={tableState}
          connected={connected}
          isSeated={isSeated}
          authLoading={authLoading}
          currentUserId={currentUserId}
          sitDownError={sitDownError}
          onSitDown={() => handleSitDown()}
          onLeave={handleLeave}
          compact
        />

        {/* Table area — opponents only in the ellipse */}
        <div className="flex-1 min-h-0 relative overflow-visible">
          <TableFelt
            tableId={tableId}
            tableState={tableState}
            myHoleCards={myHoleCards}
            showdown={showdown}
            lastWinners={lastWinners}
            showBluff={showBluff}
            currentUserId={currentUserId}
            isSeated={isSeated}
            heroSeat={heroSeat}
            winnerSeats={winnerSeats}
            onSitDown={handleSitDown}
            compact
          />
        </div>

        {/* Hero street bet — displayed above hero bar */}
        {myPlayer && myPlayer.streetBet > 0 && (
          <div className="flex justify-center -mt-1 mb-1">
            <span className="mono text-amber font-bold bg-black/50 rounded-[0.25rem] inline-flex items-center gap-[0.2rem] text-[0.75rem] px-[0.4rem] py-[0.15rem]">
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #f5d080, #b8860b)',
                  flexShrink: 0,
                }}
              />
              {myPlayer.streetBet}
            </span>
          </div>
        )}

        {/* Hero seat — fixed above action bar */}
        {myPlayer && (
          <div className="shrink-0 px-2">
            <HeroSeat
              player={myPlayer}
              holeCards={myHoleCards}
              isActive={tableState.activeSeat === myPlayer.seatIndex}
              isWinner={winnerSeats.has(myPlayer.seatIndex)}
            />
          </div>
        )}

        {/* Showdown overlay on mobile */}
        {showdown && (
          <div className="shrink-0 px-2 py-1">
            <ShowdownPanel
              showdown={showdown}
              winnerSeats={winnerSeats}
              compact
            />
          </div>
        )}

        {/* Fixed bottom action bar */}
        <ActionBar
          isMyTurn={isMyTurn}
          isSeated={isSeated}
          isReady={isReady}
          myPlayer={myPlayer}
          tableState={tableState}
          actionRequest={actionRequest}
          busted={busted}
          sendAction={sendAction}
          sendMsg={sendMsg}
          setIsReady={setIsReady}
          compact
        />

        {/* Action log toggle button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-bg-surface text-text-muted shadow-lg active:bg-bg-hover"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 52px)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
        >
          <MessageSquare className="h-4 w-4" />
          {actionLog.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-teal text-[0.5rem] font-bold text-white">
              {Math.min(actionLog.length, 99)}
            </span>
          )}
        </button>

        {/* Mobile sidebar panel */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mobile-panel-backdrop"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="mobile-panel safe-bottom"
              >
                <div className="mobile-panel-handle" />
                <div className="flex items-center justify-between px-4 pb-2">
                  <span className="text-sm font-semibold text-text-primary">牌局详情</span>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded border-none bg-transparent text-text-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                  <div className="mb-2">
                    <ActionLog entries={actionLog} players={tableState.players} />
                  </div>
                  <HandHistorySidebar tableId={tableId} />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ─── Desktop Layout ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden px-0 py-2" style={{ height: 'calc(100vh - 3rem)' }}>
      <TableHeader
        tableId={tableId}
        tableState={tableState}
        connected={connected}
        isSeated={isSeated}
        authLoading={authLoading}
        currentUserId={currentUserId}
        sitDownError={sitDownError}
        onSitDown={() => handleSitDown()}
        onLeave={handleLeave}
      />

      <div className="flex flex-1 gap-2 mt-2 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <TableFelt
            tableId={tableId}
            tableState={tableState}
            myHoleCards={myHoleCards}
            showdown={showdown}
            lastWinners={lastWinners}
            showBluff={showBluff}
            currentUserId={currentUserId}
            isSeated={isSeated}
            heroSeat={heroSeat}
            winnerSeats={winnerSeats}
            onSitDown={handleSitDown}
          />

          <ActionBar
            isMyTurn={isMyTurn}
            isSeated={isSeated}
            isReady={isReady}
            myPlayer={myPlayer}
            tableState={tableState}
            actionRequest={actionRequest}
            busted={busted}
            sendAction={sendAction}
            sendMsg={sendMsg}
            setIsReady={setIsReady}
          />
        </div>

        <div className="w-[280px] shrink-0 flex flex-col gap-2 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <ActionLog entries={actionLog} players={tableState.players} />
          </div>

          {showdown && (
            <ShowdownPanel
              showdown={showdown}
              winnerSeats={winnerSeats}
            />
          )}

          <HandHistorySidebar tableId={tableId} />
        </div>
      </div>
    </div>
  );
}
