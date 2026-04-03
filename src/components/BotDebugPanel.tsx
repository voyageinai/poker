'use client';
import { motion } from 'framer-motion';
import type { BotDebugInfo } from '@/lib/types';
import ProbBar from './ProbBar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Hexagon, TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  info: BotDebugInfo | null;
  botName: string;
}

/** Infer a strategy badge from reasoning text */
function inferStrategy(reasoning: string): { label: string; color: string; borderColor: string; bgColor: string } | null {
  const r = reasoning.toLowerCase();
  if (r.includes('bluff') || r.includes('诈唬'))
    return { label: 'BLUFF', color: 'text-loss', borderColor: 'rgba(239,68,68,0.4)', bgColor: 'rgba(239,68,68,0.12)' };
  if (r.includes('value') || r.includes('价值'))
    return { label: 'VALUE', color: 'text-win', borderColor: 'rgba(34,197,94,0.4)', bgColor: 'rgba(34,197,94,0.12)' };
  if (r.includes('fold equity') || r.includes('弃牌权益'))
    return { label: 'FOLD EQ', color: 'text-amber', borderColor: 'rgba(212,165,116,0.4)', bgColor: 'rgba(212,165,116,0.12)' };
  if (r.includes('semi-bluff') || r.includes('半诈唬'))
    return { label: 'SEMI-BLUFF', color: 'text-amber', borderColor: 'rgba(212,165,116,0.4)', bgColor: 'rgba(212,165,116,0.12)' };
  if (r.includes('check') || r.includes('过牌'))
    return { label: 'CHECK', color: 'text-fold', borderColor: 'rgba(100,116,139,0.4)', bgColor: 'rgba(100,116,139,0.12)' };
  return null;
}

// RGB values for heatmap cells (no alpha, applied separately)
const ACTION_COLOR_RGB: Record<string, string> = {
  '弃牌': '107,101,112',  // fold warm gray
  '跟注': '220,38,38',    // crimson
  '加注': '212,165,116',  // gold
};

const ACTION_CSS_VAR: Record<string, string> = {
  '弃牌': 'var(--fold)',
  '跟注': 'var(--teal)',
  '加注': 'var(--amber)',
};

export default function BotDebugPanel({ info, botName }: Props) {
  const strategy = info?.reasoning ? inferStrategy(info.reasoning) : null;

  return (
    <div className="scanlines rounded-md border border-[rgba(220,38,38,0.15)] bg-[#0c0c10] p-3 font-mono text-sm">
      {/* Header with strategy badge */}
      <div className="mb-2 flex items-center justify-between">
        <span className="glow-text-teal flex items-center gap-1 font-semibold text-teal">
          <Hexagon className="h-3.5 w-3.5" /> {botName}
        </span>
        {strategy && (
          <span
            className={cn('text-[0.65rem] font-extrabold tracking-[0.1em] rounded px-1.5 py-0.5 border', strategy.color)}
            style={{ background: strategy.bgColor, borderColor: strategy.borderColor }}
          >
            {strategy.label}
          </span>
        )}
      </div>

      {!info ? (
        <div className="text-text-muted">---</div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Equity + Pot odds */}
          {info.equity !== undefined && (
            <motion.div
              key={`eq-${info.equity.toFixed(2)}`}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <ProbBar value={info.equity} label="胜率" color={info.equity > 0.5 ? 'var(--win)' : 'var(--loss)'} />
            </motion.div>
          )}
          {info.potOdds !== undefined && (
            <ProbBar value={info.potOdds} label="底池赔率" color="var(--amber)" />
          )}

          {/* Action frequency heatmap matrix */}
          {(info.foldFreq !== undefined || info.callFreq !== undefined || info.raiseFreq !== undefined) && (
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {[
                { label: '弃牌', value: info.foldFreq ?? 0 },
                { label: '跟注', value: info.callFreq ?? 0 },
                { label: '加注', value: info.raiseFreq ?? 0 },
              ].map(({ label, value }) => {
                const rgb = ACTION_COLOR_RGB[label];
                const cssColor = ACTION_CSS_VAR[label];
                return (
                  <div
                    key={label}
                    className="relative flex flex-col items-center justify-center rounded px-1 pt-2 pb-1.5 text-center"
                    style={{ background: `rgba(${rgb}, ${value * 0.35})` }}
                  >
                    {/* Large percentage inside the rectangle */}
                    <motion.div
                      key={`${label}-${Math.round(value * 100)}`}
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      className="mono text-[1rem] font-extrabold leading-none"
                      style={{ color: cssColor }}
                    >
                      {Math.round(value * 100)}%
                    </motion.div>
                    <div className="mt-0.5 text-[0.6rem] tracking-wide text-text-muted">
                      {label}
                    </div>
                    {/* Fill bar with leading-edge glow */}
                    <div className="mt-1 h-[3px] w-full rounded-full bg-[var(--border)]">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          background: cssColor,
                          boxShadow: `2px 0 6px ${cssColor}`,
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${value * 100}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* EV */}
          {info.ev !== undefined && (
            <div className="mt-0.5 flex items-center justify-between border-t border-[var(--border)] pt-1.5">
              <span className="tracking-wide text-text-muted">EV</span>
              <motion.span
                key={info.ev.toFixed(1)}
                initial={{ opacity: 0.5, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'mono flex items-center gap-1 text-[1.1rem] font-extrabold',
                  info.ev >= 0 ? 'glow-text-win text-win' : 'text-loss'
                )}
              >
                {info.ev >= 0
                  ? <TrendingUp className="h-4 w-4" />
                  : <TrendingDown className="h-4 w-4" />
                }
                {info.ev >= 0 ? '+' : ''}{info.ev.toFixed(1)} bb
              </motion.span>
            </div>
          )}

          {/* Reasoning — terminal style with blinking cursor */}
          {info.reasoning && (
            <div
              className="blink-cursor rounded-r bg-[#0c0c10] border-l-2 border-teal px-2 py-1.5 text-xs text-text-secondary"
            >
              {info.reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
