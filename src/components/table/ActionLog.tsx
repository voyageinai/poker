'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import PlayingCard from '@/components/PlayingCard';
import type { ClientPlayerState } from '@/lib/types';
import { ACTION_LABELS, ACTION_LOG_COLORS, STREET_NAMES, type LogEntry } from '@/components/table/constants';
import { Hexagon, Trophy } from 'lucide-react';

interface ActionLogProps {
  entries: LogEntry[];
  players: (ClientPlayerState | null)[];
}

const ACTION_ABBREV: Record<string, string> = {
  fold: 'F',
  check: 'K',
  call: 'C',
  raise: 'R',
  allin: 'A',
};

export default function ActionLog({ entries, players }: ActionLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries.length]);

  const getName = (seat?: number) => {
    if (seat === undefined) return '?';
    const p = players[seat];
    return p?.displayName ?? `座位 ${seat}`;
  };

  const getKind = (seat?: number) => {
    if (seat === undefined) return 'human';
    return players[seat]?.kind ?? 'human';
  };

  return (
    <div className="scanlines bg-[#0c0c10] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="relative px-3 py-2 font-semibold text-xs text-text-primary flex justify-between items-center shrink-0">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-crimson/30 via-crimson/10 to-transparent" />
        <span className="tracking-wider">实时操作</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompact(c => !c)}
            className={`text-[0.6rem] px-1.5 py-0.5 rounded border transition-colors ${
              compact
                ? 'border-teal/60 text-teal bg-teal/10'
                : 'border-[var(--border)] text-text-muted hover:text-text-primary'
            }`}
          >
            紧凑
          </button>
          <span className="text-text-muted text-[0.65rem] font-normal">{entries.length} 条</span>
        </div>
      </div>

      {/* Log entries */}
      <div ref={logRef} className="flex-1 overflow-y-auto text-xs">
        {/* Scroll-fade overlay at top */}
        <div className="pointer-events-none sticky top-0 z-10 h-4 bg-gradient-to-b from-[#0c0c10] to-transparent" />

        {entries.map(entry => {
          if (entry.kind === 'new_hand') {
            const handNum = entry.text?.match(/\d+/)?.[0];
            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                key={entry.id}
                className="px-3 py-[0.35rem] flex flex-col gap-0.5"
              >
                <div className="h-px bg-crimson/30" />
                <div className="text-center">
                  <span className="text-[0.65rem] text-crimson font-semibold font-heading tracking-wider">
                    {handNum ? `HAND #${handNum}` : entry.text}
                  </span>
                </div>
                <div className="h-px bg-crimson/30" />
              </motion.div>
            );
          }

          if (entry.kind === 'street') {
            return (
              <div
                key={entry.id}
                className="px-3 py-[0.2rem] bg-bg-base border-b border-[var(--border)] flex items-center gap-2"
              >
                <span className="text-gold font-semibold text-xs">
                  {STREET_NAMES[entry.street ?? ''] ?? entry.street}
                </span>
                <div className="flex gap-[3px]">
                  {entry.cards?.map((c, i) => (
                    <PlayingCard key={i} card={c} size="xs" />
                  ))}
                </div>
              </div>
            );
          }

          if (entry.kind === 'winner') {
            return (
              <div
                key={entry.id}
                className="px-3 py-[0.2rem] border-b border-[var(--border)] text-win font-semibold"
              >
                <Trophy className="inline h-3.5 w-3.5" /> {entry.text || getName(entry.seat)} 赢得 <span className="mono">{entry.amount}</span> 筹码
              </div>
            );
          }

          // kind === 'action'
          const kind = getKind(entry.seat);
          const actionLabel = ACTION_LABELS[entry.action ?? ''] ?? entry.action;
          const actionColor = ACTION_LOG_COLORS[entry.action ?? ''] ?? 'var(--text-secondary)';
          const abbrev = ACTION_ABBREV[entry.action ?? ''] ?? (entry.action ?? '?').charAt(0).toUpperCase();

          if (compact) {
            return (
              <div
                key={entry.id}
                className="flex items-center border-b border-[var(--border)] px-3 py-[0.2rem] gap-1"
              >
                {kind === 'bot' && <Hexagon className="h-2.5 w-2.5 text-teal shrink-0" />}
                <span className="text-text-muted text-[0.7rem] font-mono">
                  {entry.seat ?? '?'}:{' '}
                  <span style={{ color: actionColor }} className="font-bold">{abbrev}</span>
                  {entry.amount !== undefined && entry.amount > 0 && (
                    <span className="text-amber ml-0.5">{entry.amount}</span>
                  )}
                </span>
              </div>
            );
          }

          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-[0.2rem]"
            >
              {kind === 'bot' && (
                <Hexagon className="h-3 w-3 text-teal" />
              )}
              <span className="min-w-[55px] font-semibold text-text-primary">
                {getName(entry.seat)}
              </span>
              <span
                className="text-xs font-bold"
                style={{ color: actionColor }}
              >
                {actionLabel}
              </span>
              {entry.amount !== undefined && entry.amount > 0 && (
                <span className="mono text-[0.8rem] font-semibold text-amber">
                  {entry.amount}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
