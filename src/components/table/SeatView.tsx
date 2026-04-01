'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import PlayingCard from '@/components/PlayingCard';
import type { ClientPlayerState, Card } from '@/lib/types';
import { ACTION_LABELS } from '@/components/table/constants';
import { cn } from '@/lib/utils';
import { Star } from 'lucide-react';

interface SeatViewProps {
  player: ClientPlayerState;
  holeCards: [Card, Card] | null;
  isActive: boolean;
  isMe: boolean;
  isWinner?: boolean;
  initialStack?: number;
  compact?: boolean;
}

export default function SeatView({
  player,
  holeCards,
  isActive,
  isMe,
  isWinner,
  initialStack = 1000,
  compact,
}: SeatViewProps) {
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

  const winnerAnimate = isWinner
    ? { scale: [1, 1.03, 1] as number[] }
    : { scale: 1 };
  const winnerTransition = isWinner
    ? { duration: 0.4, type: 'spring' as const, stiffness: 300 }
    : { duration: 0.3 };

  // ── Mobile compact: 90px hero, 64px others ──────────────────────────────────
  // ── Desktop: 200px hero, 130px others ───────────────────────────────────────
  const seatWidth = compact
    ? isMe ? 100 : 72
    : isMe ? 220 : 140;

  return (
    <motion.div
      animate={{
        scale: winnerAnimate.scale,
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
          : winnerTransition
      }
      className={cn(
        'flex flex-col rounded-lg bg-bg-surface transition-all duration-300',
        shaking && 'shake',
        isMe && !isWinner && !isAllIn && 'shadow-[0_0_0_1px_var(--amber-dim)]',
        isMe && 'edge-light-amber',
        isFolded && 'opacity-30',
      )}
      style={{
        filter: isFolded ? 'grayscale(0.5)' : undefined,
        border: `${compact ? 1.5 : 2}px solid ${isWinner ? 'var(--win)' : isAllIn ? 'var(--amber)' : isActive ? 'var(--teal)' : 'var(--border)'}`,
        borderLeftColor: player.kind === 'bot'
          ? 'var(--teal)'
          : isWinner ? 'var(--win)' : isAllIn ? 'var(--amber)' : isActive ? 'var(--teal)' : 'var(--border)',
        borderLeftWidth: player.kind === 'bot' ? (compact ? 2 : 4) : (compact ? 1.5 : 2),
        padding: compact ? '3px 4px' : '0.5rem 0.625rem',
        width: seatWidth,
        gap: compact ? 1 : 4,
        animation: isActive && !isAllIn ? 'pulse-border 1.5s ease-in-out infinite' : undefined,
      }}
    >
      {/* Name row */}
      <div className="flex justify-between items-center">
        <span
          className={cn(
            'font-semibold overflow-hidden text-ellipsis whitespace-nowrap leading-tight',
            compact ? 'text-[0.5rem]' : 'text-xs',
            isMe ? 'text-amber' : 'text-text-primary',
            compact ? (isMe ? 'max-w-[52px]' : 'max-w-[32px]') : (isMe ? 'max-w-[120px]' : 'max-w-[70px]'),
          )}
        >
          {player.displayName}
        </span>
        <div className="flex gap-px items-center">
          {player.isButton && (
            <span className={cn(compact ? 'text-[0.4rem]' : 'text-[0.6rem]', 'bg-[rgba(245,158,11,0.25)] text-amber px-0.5 rounded-[2px] font-bold leading-tight')}>
              D
            </span>
          )}
          {player.isSB && !compact && (
            <span className="text-[0.6rem] bg-[rgba(0,180,216,0.2)] text-teal px-0.5 rounded-[2px] font-bold leading-tight">
              S
            </span>
          )}
          {player.isBB && !compact && (
            <span className="text-[0.6rem] bg-[rgba(100,116,139,0.25)] text-text-secondary px-0.5 rounded-[2px] font-bold leading-tight">
              B
            </span>
          )}
        </div>
      </div>

      {/* Health bar — hero only */}
      {isMe && (
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: compact ? 2 : 3, background: 'rgba(255,255,255,0.08)' }}
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
      )}

      {/* Hole cards */}
      <div className={cn('flex justify-center', compact ? 'gap-px' : 'gap-[3px] my-[0.15rem]')}>
        {holeCards ? (
          <>
            <PlayingCard card={holeCards[0]} size={compact ? (isMe ? 'md' : 'sm') : (isMe ? 'xl' : 'md')} />
            <PlayingCard card={holeCards[1]} size={compact ? (isMe ? 'md' : 'sm') : (isMe ? 'xl' : 'md')} />
          </>
        ) : player.status !== 'folded' && player.status !== 'sitting_out' ? (
          <>
            <PlayingCard faceDown size={compact ? (isMe ? 'md' : 'sm') : (isMe ? 'xl' : 'md')} />
            <PlayingCard faceDown size={compact ? (isMe ? 'md' : 'sm') : (isMe ? 'xl' : 'md')} />
          </>
        ) : null}
      </div>

      {/* Stack + action */}
      <div className="flex justify-between items-center">
        <span className={cn('chip-count mono', compact ? 'text-[0.5rem]' : 'text-[0.85rem]')}>
          {player.stack}
        </span>
        {player.lastAction && !compact && (
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
        {/* On mobile compact, show single-letter action */}
        {player.lastAction && compact && (
          <span
            className="text-[0.55rem] px-0.5 rounded-[2px] font-bold leading-tight"
            style={{
              color: actionColors[player.lastAction] ?? 'var(--text-muted)',
            }}
          >
            {player.lastAction === 'fold' ? '弃' : player.lastAction === 'check' ? '过' : player.lastAction === 'call' ? '跟' : player.lastAction === 'raise' ? '加' : player.lastAction === 'allin' ? '全' : ''}
          </span>
        )}
      </div>
    </motion.div>
  );
}
