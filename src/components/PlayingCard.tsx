'use client';
import { motion, AnimatePresence } from 'framer-motion';
import type { Card, Suit } from '@/lib/types';
import { cn } from '@/lib/utils';

const SUIT_SYMBOLS: Record<Suit, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RED_SUITS = new Set<Suit>(['h', 'd']);

const SUIT_GLOW: Record<Suit, string> = {
  h: '0 0 12px rgba(239,68,68,0.4)',
  d: '0 0 12px rgba(239,68,68,0.4)',
  c: '0 0 12px rgba(226,234,243,0.2)',
  s: '0 0 12px rgba(226,234,243,0.2)',
};

interface Props {
  card?: Card | null;
  faceDown?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  animate3D?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const SIZE_CLASSES = {
  xs: 'w-7 h-10 text-[0.55rem]',
  sm: 'w-11 h-[60px] text-sm',
  md: 'w-14 h-[76px] text-base',
  lg: 'w-[72px] h-[100px] text-2xl',
  xl: 'w-[88px] h-[122px] text-3xl',
} as const;

const WATERMARK_SIZES = {
  xs: 'text-[0.9rem]',
  sm: 'text-[1.6rem]',
  md: 'text-[2.2rem]',
  lg: 'text-[3rem]',
  xl: 'text-[3.8rem]',
} as const;

/** Card back with branded crosshatch pattern */
function CardBack({ sizeClass, className, style }: { sizeClass: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn(
        sizeClass,
        'relative inline-flex items-center justify-center overflow-hidden rounded-md',
        'border border-teal-dim',
        'shadow-[0_2px_8px_rgba(0,0,0,0.5)]',
        'transition-transform duration-150 hover:-translate-y-0.5',
        className,
      )}
      style={{
        background: `
          repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,119,168,0.12) 4px, rgba(0,119,168,0.12) 5px),
          repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,119,168,0.12) 4px, rgba(0,119,168,0.12) 5px),
          linear-gradient(135deg, #0d2a44 0%, #1a3a5c 100%)
        `,
        ...style,
      }}
    >
      {/* Center brand diamond */}
      <div className="text-teal-dim/40 font-mono text-[0.7rem] font-black">◆</div>
    </div>
  );
}

/** Card face with dark theme + suit watermark */
function CardFace({ card, sizeClass, watermarkSize, className, style }: {
  card: Card; sizeClass: string; watermarkSize: string; className?: string; style?: React.CSSProperties;
}) {
  const rank = card[0];
  const suit = card[1] as Suit;
  const red = RED_SUITS.has(suit);
  const symbol = SUIT_SYMBOLS[suit];

  return (
    <div
      className={cn(
        sizeClass,
        'relative inline-flex flex-col items-start justify-between overflow-hidden rounded-md',
        'font-mono font-bold select-none',
        'edge-light',
        red ? 'text-[#ff5555]' : 'text-[#e8f0f8]',
        className,
      )}
      style={{
        background: 'linear-gradient(135deg, #1e2d42 0%, #141f30 100%)',
        border: `1px solid ${red ? 'rgba(239,68,68,0.2)' : 'rgba(200,214,229,0.12)'}`,
        padding: '0.15rem 0.25rem',
        ...style,
      }}
    >
      {/* Suit watermark */}
      <div className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center',
        watermarkSize, 'opacity-[0.12]',
      )}>
        {symbol}
      </div>
      {/* Top rank+suit */}
      <div className="relative z-[1] leading-none">{rank}{symbol}</div>
      {/* Bottom rank+suit (rotated) */}
      <div className="relative z-[1] rotate-180 self-end leading-none">{rank}{symbol}</div>
    </div>
  );
}

export default function PlayingCard({ card, faceDown = false, size = 'md', animate3D = false, className, style }: Props) {
  const sizeClass = SIZE_CLASSES[size];
  const watermarkSize = WATERMARK_SIZES[size];
  const isRevealed = !faceDown && !!card;

  // Non-animated path (default)
  if (!animate3D) {
    if (!isRevealed) {
      return <CardBack sizeClass={sizeClass} className={className} style={style} />;
    }
    return <CardFace card={card!} sizeClass={sizeClass} watermarkSize={watermarkSize} className={className} style={style} />;
  }

  // 3D animated path
  const suit = card ? (card[1] as Suit) : null;
  return (
    <div className={cn('card-3d-container inline-block', sizeClass)} style={style}>
      <AnimatePresence mode="wait">
        {isRevealed ? (
          <motion.div
            key={`face-${card}`}
            initial={{ rotateY: 180, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="card-3d"
          >
            <motion.div
              initial={{ boxShadow: suit ? SUIT_GLOW[suit] : 'none' }}
              animate={{ boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
              transition={{ duration: 0.6 }}
              className="rounded-md"
            >
              <CardFace card={card!} sizeClass={sizeClass} watermarkSize={watermarkSize} className={className} />
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="back"
            initial={{ opacity: 0.8 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ rotateY: 90, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="card-3d"
          >
            <CardBack sizeClass={sizeClass} className={className} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
