'use client';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import ActionControls from '@/components/ActionControls';
import { Button } from '@/components/ui/button';
import { refreshNavChips } from '@/components/Nav';
import type { ClientPlayerState, ClientTableState, PokerAction, WsClientMessage } from '@/lib/types';

interface ActionBarProps {
  isMyTurn: boolean;
  isSeated: boolean;
  isReady: boolean;
  myPlayer: ClientPlayerState | null;
  tableState: ClientTableState;
  actionRequest: { toCall: number; minRaise: number; timeoutMs: number } | null;
  busted: { canRebuy: boolean; timeoutSec: number } | null;
  sendAction: (action: PokerAction) => void;
  sendMsg: (msg: WsClientMessage) => void;
  setIsReady: (ready: boolean) => void;
  compact?: boolean;
}

export default function ActionBar({
  isMyTurn,
  isSeated,
  isReady,
  myPlayer,
  tableState,
  actionRequest,
  busted,
  sendAction,
  sendMsg,
  setIsReady,
  compact,
}: ActionBarProps) {
  // Countdown timer for bust timeout
  const [bustCountdown, setBustCountdown] = useState(0);
  useEffect(() => {
    if (!busted) { setBustCountdown(0); return; }
    setBustCountdown(busted.timeoutSec);
    const iv = setInterval(() => {
      setBustCountdown(prev => {
        if (prev <= 1) { clearInterval(iv); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [busted]);

  const expanded = isMyTurn || !!busted;

  return (
    <motion.div
      animate={{ height: compact ? (expanded ? 176 : 44) : (expanded ? 120 : 48) }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={`shrink-0 overflow-hidden border-t border-[var(--border)] bg-bg-surface safe-bottom ${
        compact ? 'px-2 rounded-none' : 'px-3 rounded-b-lg'
      }`}
    >
      <div className="flex h-full items-center justify-center">
        {/* Busted — rebuy prompt */}
        {busted ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[0.9rem] font-semibold text-loss">
              筹码已用完！{bustCountdown > 0 && <span className="mono text-text-muted ml-1">{bustCountdown}s</span>}
            </span>
            {busted.canRebuy ? (
              <Button
                variant="amber"
                className={compact ? 'h-11 px-8 text-base font-bold' : 'px-6 font-bold'}
                onClick={() => {
                  sendMsg({ type: 'rebuy' });
                  refreshNavChips();
                }}
              >
                补充牌资
              </Button>
            ) : (
              <span className="text-[0.8rem] text-text-muted">余额不足，将自动离桌...</span>
            )}
          </div>
        ) : isMyTurn && myPlayer && actionRequest ? (
          <div className={compact ? 'w-full' : 'w-full max-w-[520px]'}>
            <ActionControls
              toCall={actionRequest.toCall}
              minRaise={actionRequest.minRaise}
              stack={myPlayer.stack}
              currentBet={tableState.currentBet}
              pot={tableState.pot.total}
              onAction={sendAction}
              timeoutMs={actionRequest.timeoutMs}
              compact={compact}
            />
          </div>
        ) : isSeated && !isReady && (tableState.status === 'hand_complete' || tableState.status === 'waiting') ? (
          <Button
            variant="teal"
            className={compact ? 'h-11 w-full text-base font-bold' : 'px-8 text-[0.85rem] font-bold'}
            onClick={() => { sendMsg({ type: 'ready' }); setIsReady(true); }}
          >
            {tableState.handNumber === 0 ? '准备开始' : '准备下一手'}
          </Button>
        ) : isSeated && isReady && (tableState.status === 'hand_complete' || tableState.status === 'waiting') ? (
          <span className="text-[0.8rem] text-text-muted">等待其他玩家准备...</span>
        ) : (
          <span className="text-[0.75rem] text-text-muted">
            {isSeated ? (tableState.status === 'waiting' ? '等待更多玩家加入...' : '') : '观战中'}
          </span>
        )}
      </div>
    </motion.div>
  );
}
