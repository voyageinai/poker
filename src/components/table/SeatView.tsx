'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import PlayingCard from '@/components/PlayingCard';
import type { ClientPlayerState, Card } from '@/lib/types';
import { ACTION_LABELS } from '@/components/table/constants';
import { cn } from '@/lib/utils';
import { Star, Hexagon } from 'lucide-react';

interface SeatViewProps {
  player: ClientPlayerState;
  holeCards: [Card, Card] | null;
  isActive: boolean;
  isMe: boolean;
  isWinner?: boolean;
  initialStack?: number;
  compact?: boolean;
  totalSeats?: number;
}

export default function SeatView({
  player,
  holeCards,
  isActive,
  isMe,
  isWinner,
  initialStack = 1000,
  compact,
  totalSeats,
}: SeatViewProps) {
  const actionColors: Record<string, string> = {
    fold: 'var(--fold)',
    check: '#10b981',
    call: 'var(--crimson)',
    raise: 'var(--gold)',
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
  const is9Max = totalSeats !== undefined && totalSeats > 6;
  const seatWidth = compact ? (is9Max ? 68 : 80) : isMe ? 220 : 140;

  return (
    <motion.div
      animate={{
        scale: winnerAnimate.scale,
        ...(isAllIn
          ? {
              boxShadow: [
                '0 0 6px rgba(220,38,38,0.3)',
                '0 0 14px rgba(220,38,38,0.5)',
                '0 0 6px rgba(220,38,38,0.3)',
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
      {/* Name row — compact: plain text + inline badges; desktop: avatar circle + overlaid position dot */}
      {compact ? (
        <div className="flex justify-between items-center">
          <span
            className={cn(
              'font-semibold overflow-hidden text-ellipsis whitespace-nowrap leading-tight',
              is9Max ? 'text-[0.55rem]' : 'text-[0.6rem]',
              isMe ? 'text-amber' : 'text-text-primary',
              is9Max ? 'max-w-[36px]' : 'max-w-[48px]',
            )}
          >
            {player.displayName}
          </span>
          <div className="flex gap-px items-center">
            {player.isButton && (
              <span className="text-[0.4rem] bg-[rgba(212,165,116,0.2)] text-amber px-0.5 rounded-[2px] font-bold leading-tight">
                D
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {/* Avatar circle with position badge overlay */}
          <div className="relative shrink-0" style={{ width: 24, height: 24 }}>
            <div
              className={cn(
                'w-full h-full rounded-full flex items-center justify-center',
                player.kind === 'bot'
                  ? 'bg-[rgba(220,38,38,0.12)] border border-[rgba(220,38,38,0.25)]'
                  : isMe
                  ? 'bg-[rgba(212,165,116,0.10)] border-2 border-[rgba(212,165,116,0.40)]'
                  : 'bg-[rgba(212,165,116,0.10)] border border-[rgba(212,165,116,0.25)]',
              )}
            >
              {player.kind === 'bot' ? (
                <Hexagon
                  size={11}
                  className="text-[var(--crimson)] opacity-70"
                  strokeWidth={2}
                />
              ) : (
                <span
                  className={cn(
                    'text-[0.5rem] font-bold leading-none select-none',
                    isMe ? 'text-[var(--gold)]' : 'text-[var(--gold)]',
                  )}
                >
                  {player.displayName.charAt(0)}
                </span>
              )}
            </div>
            {/* Position badge — D > S > B, single dot overlaid bottom-right */}
            {player.isButton ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full font-black leading-none"
                style={{
                  width: 12,
                  height: 12,
                  fontSize: '0.4rem',
                  background: 'var(--gold)',
                  color: 'var(--bg-base)',
                }}
              >
                D
              </span>
            ) : player.isSB ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full font-black leading-none"
                style={{
                  width: 12,
                  height: 12,
                  fontSize: '0.4rem',
                  background: 'rgba(220,38,38,0.80)',
                  color: 'white',
                }}
              >
                S
              </span>
            ) : player.isBB ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full font-black leading-none"
                style={{
                  width: 12,
                  height: 12,
                  fontSize: '0.4rem',
                  background: 'var(--text-muted)',
                  color: 'var(--bg-base)',
                }}
              >
                B
              </span>
            ) : null}
          </div>
          {/* Name */}
          <span
            className={cn(
              'font-semibold overflow-hidden text-ellipsis whitespace-nowrap leading-tight text-xs',
              isMe ? 'text-amber' : 'text-text-primary',
              isMe ? 'max-w-[120px]' : 'max-w-[70px]',
            )}
          >
            {player.displayName}
          </span>
        </div>
      )}

      {/* Health bar — hero only */}
      {isMe && (
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: compact ? 2 : 4, background: 'rgba(255,255,255,0.06)' }}
        >
          <div
            style={{
              height: '100%',
              width: `${stackRatio * 100}%`,
              background: `linear-gradient(90deg, ${healthColor}88, ${healthColor})`,
              transition: 'width 0.4s ease, background 0.4s ease',
              borderRadius: 9999,
              boxShadow: `1px 0 4px ${healthColor}`,
            }}
          />
        </div>
      )}

      {/* Hole cards */}
      <div className={cn('flex justify-center', compact ? 'gap-px' : 'gap-[3px] my-[0.15rem]')}>
        {holeCards ? (
          <>
            <PlayingCard card={holeCards[0]} size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
            <PlayingCard card={holeCards[1]} size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
          </>
        ) : player.status !== 'folded' && player.status !== 'sitting_out' ? (
          <>
            <PlayingCard faceDown size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
            <PlayingCard faceDown size={compact ? (is9Max ? 'xs' : 'sm') : (isMe ? 'xl' : 'md')} />
          </>
        ) : null}
      </div>

      {/* Stack + action */}
      <div className="flex justify-between items-center">
        <span className={cn('chip-count mono', compact ? 'text-[0.6rem]' : 'text-[0.85rem]')}>
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
