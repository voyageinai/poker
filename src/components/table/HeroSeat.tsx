// src/components/table/HeroSeat.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import PlayingCard from '@/components/PlayingCard';
import type { ClientPlayerState, Card } from '@/lib/types';
import { ACTION_LABELS } from '@/components/table/constants';
import { cn } from '@/lib/utils';

interface HeroSeatProps {
  player: ClientPlayerState;
  holeCards: [Card, Card] | null;
  isActive: boolean;
  isWinner?: boolean;
  initialStack?: number;
}

export default function HeroSeat({
  player,
  holeCards,
  isActive,
  isWinner,
  initialStack = 1000,
}: HeroSeatProps) {
  const actionColors: Record<string, string> = {
    fold: 'var(--fold)',
    check: '#10b981',
    call: 'var(--teal)',
    raise: 'var(--amber)',
    allin: '#f87171',
  };

  const isAllIn = player.lastAction === 'allin';
  const isFolded = player.status === 'folded' || player.status === 'sitting_out';

  const prevAllInRef = useRef(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (isAllIn && !prevAllInRef.current) {
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 400);
      prevAllInRef.current = true;
      return () => clearTimeout(t);
    }
    if (!isAllIn) {
      prevAllInRef.current = false;
    }
  }, [isAllIn]);

  const stackRatio = Math.min(1, Math.max(0, player.stack / initialStack));
  const healthColor =
    stackRatio > 0.5
      ? 'var(--teal)'
      : stackRatio > 0.25
      ? 'var(--amber)'
      : 'var(--loss)';

  return (
    <motion.div
      animate={{
        ...(isAllIn
          ? {
              boxShadow: [
                '0 0 6px rgba(245,158,11,0.3)',
                '0 0 14px rgba(245,158,11,0.5)',
                '0 0 6px rgba(245,158,11,0.3)',
              ],
            }
          : isWinner
          ? { boxShadow: '0 0 12px rgba(34,197,94,0.4)' }
          : {}),
      }}
      transition={
        isAllIn
          ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.3 }
      }
      className={cn(
        'flex items-center gap-3 rounded-lg bg-bg-surface px-3 shrink-0',
        shaking && 'shake',
        'shadow-[0_0_0_1px_var(--amber-dim)] edge-light-amber',
        isFolded && 'opacity-30',
      )}
      style={{
        filter: isFolded ? 'grayscale(0.5)' : undefined,
        height: 72,
        border: `2px solid ${isWinner ? 'var(--win)' : isAllIn ? 'var(--amber)' : isActive ? 'var(--teal)' : 'var(--amber-dim)'}`,
        animation: isActive && !isAllIn ? 'pulse-border 1.5s ease-in-out infinite' : undefined,
      }}
    >
      {/* Left: name + stack + health bar */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.75rem] font-semibold text-amber truncate max-w-[100px]">
            {player.displayName}
          </span>
          {player.isButton && (
            <span className="text-[0.5rem] bg-[rgba(245,158,11,0.25)] text-amber px-0.5 rounded-[2px] font-bold leading-tight">
              D
            </span>
          )}
          {player.isSB && (
            <span className="text-[0.5rem] bg-[rgba(0,180,216,0.2)] text-teal px-0.5 rounded-[2px] font-bold leading-tight">
              S
            </span>
          )}
          {player.isBB && (
            <span className="text-[0.5rem] bg-[rgba(100,116,139,0.25)] text-text-secondary px-0.5 rounded-[2px] font-bold leading-tight">
              B
            </span>
          )}
          {player.lastAction && (
            <span
              className="text-[0.6rem] px-1 py-0 rounded-[3px] font-bold"
              style={{
                color: actionColors[player.lastAction] ?? 'var(--text-muted)',
                background: `${actionColors[player.lastAction] ?? 'var(--text-muted)'}22`,
              }}
            >
              {ACTION_LABELS[player.lastAction] ?? player.lastAction}
            </span>
          )}
        </div>

        {/* Health bar */}
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: 3, background: 'rgba(255,255,255,0.08)' }}
        >
          <div
            style={{
              height: '100%',
              width: `${stackRatio * 100}%`,
              background: healthColor,
              transition: 'width 0.4s ease, background 0.4s ease',
              borderRadius: 9999,
            }}
          />
        </div>

        {/* Stack */}
        <span className="chip-count mono text-[0.85rem] font-bold">
          {player.stack}
        </span>
      </div>

      {/* Right: hole cards */}
      <div className="flex gap-1 shrink-0">
        {holeCards ? (
          <>
            <PlayingCard card={holeCards[0]} size="sm" />
            <PlayingCard card={holeCards[1]} size="sm" />
          </>
        ) : player.status !== 'folded' && player.status !== 'sitting_out' ? (
          <>
            <PlayingCard faceDown size="sm" />
            <PlayingCard faceDown size="sm" />
          </>
        ) : null}
      </div>
    </motion.div>
  );
}
