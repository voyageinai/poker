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

  const sizeClass = compact
    ? isBigPot
      ? 'text-[1.1rem] glow-text-crimson'
      : 'text-[0.9rem]'
    : isBigPot
    ? 'text-[1.5rem] glow-text-crimson'
    : isMedPot
    ? 'text-[1.3rem]'
    : 'text-[1.15rem]';

  return (
    <motion.div
      className="text-center flex flex-col items-center gap-0.5 md:gap-1"
      animate={isBigPot ? {
        filter: ['drop-shadow(0 0 8px rgba(220,38,38,0.3))', 'drop-shadow(0 0 16px rgba(220,38,38,0.5))', 'drop-shadow(0 0 8px rgba(220,38,38,0.3))'],
      } : {}}
      transition={isBigPot ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
    >
      {/* Decorative gold lines around pot */}
      {!compact && (
        <div className="flex items-center gap-2 mb-0.5">
          <div className="w-6 h-px bg-gradient-to-r from-transparent to-gold-dim/50" />
          <span className="text-[0.55rem] text-gold-dim tracking-[0.2em] uppercase">pot</span>
          <div className="w-6 h-px bg-gradient-to-l from-transparent to-gold-dim/50" />
        </div>
      )}

      <motion.span
        key={pot.total}
        initial={{ scale: 1.1, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className={cn('mono chip-count font-extrabold', sizeClass, isBigPot && 'text-crimson')}
      >
        {pot.total}
      </motion.span>

      {/* Side pot pills */}
      {pot.sides.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center mt-0.5">
          <span className={cn('mono rounded-full px-2 py-0.5 bg-crimson/10 text-crimson border border-crimson/20', compact ? 'text-[0.5rem]' : 'text-[0.6rem]')}>
            主 {pot.main}
          </span>
          {pot.sides.map((side, i) => (
            <span
              key={i}
              className={cn('mono rounded-full px-2 py-0.5 bg-gold/10 text-gold border border-gold/20', compact ? 'text-[0.5rem]' : 'text-[0.6rem]')}
            >
              边 {side.amount}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
