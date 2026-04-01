'use client';
import { motion } from 'framer-motion';
import type { PotState } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PotDisplayProps {
  pot: PotState;
  bigBlind?: number;
  compact?: boolean;
}

export default function PotDisplay({ pot, bigBlind = 20, compact }: PotDisplayProps) {
  if (pot.total <= 0) return null;

  const isBigPot = bigBlind > 0 && pot.total > bigBlind * 50;
  const isMedPot = bigBlind > 0 && pot.total > bigBlind * 20;

  // Number of decorative stack bars: clamp(1, floor(pot / bigBlind / 20), 5)
  const numBars = bigBlind > 0
    ? Math.min(5, Math.max(1, Math.floor(pot.total / bigBlind / 20)))
    : 1;

  // Bar color function: bottom bars teal, middle amber, top bar(s) loss-red for huge pots
  const getBarColor = (barIndex: number): string => {
    if (isBigPot && barIndex === numBars - 1) return 'var(--loss)';
    if (barIndex >= Math.floor(numBars / 2)) return 'var(--amber)';
    return 'var(--teal)';
  };

  const sizeClass = compact
    ? isBigPot
      ? 'text-[1rem] glow-text-teal'
      : 'text-[0.9rem]'
    : isBigPot
    ? 'text-[1.4rem] glow-text-teal'
    : isMedPot
    ? 'text-[1.2rem]'
    : 'text-[1.1rem]';

  return (
    <motion.div
      className="text-center flex flex-col items-center gap-0.5 md:gap-1"
      animate={isBigPot ? {
        filter: ['drop-shadow(0 0 8px rgba(0,180,216,0.3))', 'drop-shadow(0 0 16px rgba(0,180,216,0.5))', 'drop-shadow(0 0 8px rgba(0,180,216,0.3))'],
      } : {}}
      transition={isBigPot ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
    >
      <motion.span
        key={pot.total}
        initial={{ scale: 1.1, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className={cn('mono chip-count font-extrabold', sizeClass, isBigPot && 'text-teal')}
      >
        {pot.total}
      </motion.span>

      {/* Decorative stacked bars below the number */}
      {!compact && (
        <div className="flex flex-col-reverse gap-[2px] items-start" style={{ minHeight: numBars * 5 }}>
          {Array.from({ length: numBars }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 20,
                height: 3,
                background: getBarColor(i),
                borderRadius: 2,
                marginLeft: i * 1,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      )}

      {/* Side pot pills */}
      {pot.sides.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center mt-0.5">
          <span className={cn('mono rounded-full px-2 py-0.5 bg-teal/15 text-teal', compact ? 'text-[0.5rem]' : 'text-[0.6rem]')}>
            主 {pot.main}
          </span>
          {pot.sides.map((side, i) => (
            <span
              key={i}
              className={cn('mono rounded-full px-2 py-0.5 bg-amber/15 text-amber', compact ? 'text-[0.5rem]' : 'text-[0.6rem]')}
            >
              边 {side.amount}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
