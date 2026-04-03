'use client';
import PlayingCard from '@/components/PlayingCard';
import type { ShowdownResult } from '@/lib/types';
import { translateHand } from '@/components/table/constants';
import { cn } from '@/lib/utils';

interface ShowdownPanelProps {
  showdown: ShowdownResult[];
  winnerSeats: Set<number>;
  compact?: boolean;
}

export default function ShowdownPanel({ showdown, winnerSeats, compact }: ShowdownPanelProps) {
  return (
    <div className={cn(
      'shrink-0 rounded-lg border border-gold-dim/30 bg-bg-surface',
      compact ? 'p-1.5 bg-bg-surface/95 backdrop-blur-sm' : 'p-2',
    )}>
      <div className={cn('font-heading font-bold text-gold tracking-wider', compact ? 'mb-1 text-[0.65rem]' : 'mb-[0.4rem] text-xs')}>摊牌</div>
      <div className={cn('flex flex-col', compact ? 'gap-[0.2rem]' : 'gap-[0.35rem]')}>
        {showdown.map(result => {
          const isResultWinner = winnerSeats.has(result.seat);
          return (
            <div
              key={result.seat}
              className={cn(
                'flex items-center rounded-[0.25rem]',
                compact ? 'gap-[0.25rem] px-[0.3rem] py-[0.2rem]' : 'gap-[0.35rem] px-[0.4rem] py-[0.3rem]',
              )}
              style={{
                background: isResultWinner ? 'rgba(34,197,94,0.08)' : 'var(--bg-card)',
                border: isResultWinner ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
                opacity: isResultWinner ? 1 : 0.55,
              }}
            >
              <span
                className={cn(
                  'overflow-hidden text-ellipsis whitespace-nowrap font-semibold',
                  compact ? 'min-w-[36px] text-[0.6rem]' : 'min-w-[50px] text-[0.7rem]',
                )}
                style={{ color: isResultWinner ? 'var(--win)' : 'var(--text-muted)' }}
              >
                {result.displayName}
              </span>
              <PlayingCard card={result.holeCards[0]} size={compact ? 'sm' : 'md'} />
              <PlayingCard card={result.holeCards[1]} size={compact ? 'sm' : 'md'} />
              <span
                className={cn(
                  'ml-auto whitespace-nowrap font-mono',
                  compact ? 'text-[0.5rem]' : 'text-[0.6rem]',
                )}
                style={{
                  color: isResultWinner ? 'var(--win)' : 'var(--text-muted)',
                  fontWeight: isResultWinner ? 700 : 400,
                }}
              >
                {translateHand(result.bestHand)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
