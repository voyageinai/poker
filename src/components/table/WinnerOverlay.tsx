'use client';
import { motion } from 'framer-motion';
import { useState, useEffect, useMemo } from 'react';
import type { ClientPlayerState, WinnerEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

interface WinnerOverlayProps {
  lastWinners: WinnerEntry[];
  myPlayer: ClientPlayerState | null;
  compact?: boolean;
}

const CONFETTI_COLORS = ['var(--teal)', 'var(--amber)', 'var(--win)', '#ffffff'];

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export default function WinnerOverlay({ lastWinners, myPlayer, compact }: WinnerOverlayProps) {
  const myWin = myPlayer ? lastWinners.find(w => w.seat === myPlayer.seatIndex) : null;
  const isWin = !!myWin;
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (isWin) {
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 400);
      return () => clearTimeout(t);
    }
  }, [isWin]);

  const confettiParticles = useMemo(() => {
    return Array.from({ length: compact ? 8 : 12 }, (_, i) => ({
      id: i,
      left: `${randomBetween(15, 85).toFixed(1)}%`,
      animationDelay: `${randomBetween(0, 600).toFixed(0)}ms`,
      animationDuration: `${randomBetween(800, 1400).toFixed(0)}ms`,
      backgroundColor: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    }));
  }, [compact]);

  const textSize = compact ? 'text-[0.75rem]' : 'text-[0.9rem]';
  const textSizeSm = compact ? 'text-[0.65rem]' : 'text-[0.85rem]';
  const textSizeXs = compact ? 'text-[0.6rem]' : 'text-[0.8rem]';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 15 }}
      className={cn(
        'rounded-lg text-center relative overflow-hidden',
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
        shaking && 'shake',
      )}
      style={{
        background: isWin ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)',
        border: `1px solid ${isWin ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.3)'}`,
        boxShadow: isWin ? 'var(--glow-win-lg)' : undefined,
      }}
    >
      {isWin && confettiParticles.map(p => (
        <div
          key={p.id}
          className="confetti-particle"
          style={{
            position: 'absolute',
            left: p.left,
            animationDelay: p.animationDelay,
            animationDuration: p.animationDuration,
            backgroundColor: p.backgroundColor,
          }}
        />
      ))}

      {myPlayer ? (
        isWin ? (
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className={cn('mono font-bold text-win glow-text-win relative z-10', textSize)}
          >
            你赢得了 {myWin!.amountWon} 筹码！
          </motion.div>
        ) : lastWinners.length === 1 ? (
          <div className={cn('mono font-bold text-loss', textSizeSm)}>
            {lastWinners[0].displayName} 赢得 {lastWinners[0].amountWon} 筹码
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 relative z-10">
            {lastWinners.map(w => (
              <div key={`${w.seat}-${w.amountWon}`} className={cn('mono font-bold text-loss', textSizeXs)}>
                {w.displayName} +{w.amountWon}
              </div>
            ))}
          </div>
        )
      ) : (
        lastWinners.length === 1 ? (
          <div className={cn('mono font-bold text-win relative z-10', textSizeSm)}>
            {lastWinners[0].displayName} 赢得 {lastWinners[0].amountWon} 筹码
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 relative z-10">
            {lastWinners.map(w => (
              <div key={`${w.seat}-${w.amountWon}`} className={cn('mono font-bold text-win', textSizeXs)}>
                {w.displayName} +{w.amountWon}
              </div>
            ))}
          </div>
        )
      )}
    </motion.div>
  );
}
