'use client';
import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PlayingCard from '@/components/PlayingCard';
import type { Card } from '@/lib/types';

interface BoardCardsProps {
  cards: Card[];
  compact?: boolean;
}

export default function BoardCards({ cards, compact }: BoardCardsProps) {
  const slots = [0, 1, 2, 3, 4];
  const prevCount = useRef(0);
  const isNewStreet = cards.length > prevCount.current;
  prevCount.current = cards.length;

  // Determine stagger delay: flop cards get stagger, turn/river don't
  function getDelay(i: number): number {
    if (cards.length <= 3 && i < 3) return i * 0.12; // flop stagger
    return 0;
  }

  const cardSize = compact ? 'md' as const : 'lg' as const;

  return (
    <div className={`relative flex items-center justify-center ${compact ? 'gap-1' : 'gap-2'}`}>
      {/* Flop flash overlay */}
      <AnimatePresence>
        {isNewStreet && cards.length === 3 && (
          <motion.div
            key="flop-flash"
            initial={{ opacity: 0.1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-none absolute inset-0 z-10 rounded-lg bg-white"
          />
        )}
      </AnimatePresence>

      {slots.map(i => (
        <AnimatePresence key={i} mode="wait">
          {cards[i] ? (
            <motion.div
              key={`card-${cards[i]}`}
              initial={{ opacity: 0, scale: 0.8, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{
                duration: 0.45,
                delay: getDelay(i),
                ease: [0.4, 0, 0.2, 1],
              }}
            >
              <PlayingCard card={cards[i]} size={cardSize} animate3D />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0.6 }} animate={{ opacity: 0.8 }}>
              <PlayingCard faceDown size={cardSize} />
            </motion.div>
          )}
        </AnimatePresence>
      ))}
    </div>
  );
}
