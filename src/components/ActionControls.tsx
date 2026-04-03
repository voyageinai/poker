'use client';
import { useState, useEffect, useRef } from 'react';
import type { PokerAction } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Chip-shaped quick-bet button
function ChipButton({ label, onClick, compact }: { label: string; onClick: () => void; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-full',
        'bg-bg-card border border-gold-dim/30',
        'text-gold font-bold',
        'hover:border-gold/50 hover:bg-gold/8',
        'active:scale-95 transition-transform duration-75',
        compact ? 'w-9 h-9 text-[0.6rem]' : 'w-10 h-10 text-[0.65rem]'
      )}
    >
      {label}
    </button>
  );
}

interface Props {
  toCall: number;
  minRaise: number;
  stack: number;
  currentBet: number;
  pot: number;
  onAction: (action: PokerAction) => void;
  timeoutMs: number;
  compact?: boolean;
}

// Quick-bet presets: label, pot multiplier
const QUICK_BETS = [
  { label: '½', mult: 0.5 },
  { label: '¾', mult: 0.75 },
  { label: '1x', mult: 1 },
  { label: '1.5x', mult: 1.5 },
  { label: '2x', mult: 2 },
];

export default function ActionControls({ toCall, minRaise, stack, currentBet, pot, onAction, timeoutMs, compact }: Props) {
  // Cap minRaise: MAX_SAFE_INTEGER is a sentinel meaning "raise cap reached"
  const raiseCapped = minRaise > stack * 2;
  const effectiveMinRaise = raiseCapped ? stack : minRaise;

  const [raiseAmount, setRaiseAmount] = useState(currentBet + effectiveMinRaise);

  const [remaining, setRemaining] = useState(timeoutMs);
  const startTime = useRef(Date.now());

  useEffect(() => {
    startTime.current = Date.now();
    setRemaining(timeoutMs);
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime.current;
      setRemaining(Math.max(0, timeoutMs - elapsed));
    }, 100);
    return () => clearInterval(interval);
  }, [timeoutMs]);

  const pct = Math.max(0, remaining / timeoutMs) * 100;
  const urgent = remaining < 5000;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && toCall <= stack;
  const canRaise = !raiseCapped && stack > toCall && raiseAmount <= stack + (currentBet - toCall);
  const callAmount = Math.min(toCall, stack);
  const isAllIn = stack <= toCall;

  const minRaiseTotal = currentBet + effectiveMinRaise;
  const maxRaiseTotal = currentBet + stack - toCall;
  const canShowSlider = !raiseCapped && stack > toCall;

  // ─── Mobile compact layout: stacked vertically ──────────────────────────────
  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        {/* Timer bar */}
        <TimerBar pct={pct} urgent={urgent} remaining={remaining} />

        {/* Raise slider + amount — single row */}
        {canShowSlider && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={minRaiseTotal}
              max={maxRaiseTotal > minRaiseTotal ? maxRaiseTotal : minRaiseTotal}
              value={raiseAmount}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="mobile-slider flex-1 appearance-none cursor-pointer h-8"
              style={{ touchAction: 'none', accentColor: 'var(--gold)' }}
            />
            <span className="mono text-sm font-bold text-gold min-w-[48px] text-right">{raiseAmount}</span>
          </div>
        )}

        {/* Quick-bet presets — chip shaped, centered */}
        {canShowSlider && (
          <div className="flex justify-center gap-2">
            {QUICK_BETS.map(({ label, mult }) => (
              <ChipButton
                key={label}
                label={label}
                compact
                onClick={() => {
                  const raiseSize = Math.round(pot * mult);
                  const raiseTo = currentBet + raiseSize;
                  setRaiseAmount(Math.min(Math.max(raiseTo, minRaiseTotal), maxRaiseTotal));
                }}
              />
            ))}
          </div>
        )}

        {/* Action buttons — when ALL-IN, it takes full bottom row */}
        {isAllIn ? (
          <>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
                onClick={() => onAction({ action: 'fold' })}
              >
                弃牌
              </Button>
              {canCheck ? (
                <Button
                  variant="ghost"
                  className="flex-1 h-11 text-sm font-bold border border-[var(--border)] active:translate-y-px active:brightness-90"
                  onClick={() => onAction({ action: 'check' })}
                >
                  过牌
                </Button>
              ) : (
                <Button
                  variant="teal"
                  className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
                  disabled={!canCall}
                  onClick={() => onAction({ action: 'call' })}
                >
                  跟注 {callAmount}
                </Button>
              )}
            </div>
            <button
              className={cn(
                'w-full h-12 rounded-md',
                'bg-gradient-to-b from-[#ef4444] to-[#dc2626]',
                'text-white text-lg font-black tracking-widest',
                'shadow-[0_0_16px_rgba(220,38,38,0.3)]',
                'animate-pulse-subtle',
                'active:scale-[0.98] active:brightness-90 transition-transform duration-75'
              )}
              style={{ boxShadow: '0 0 16px rgba(220,38,38,0.3), 0 0 32px rgba(220,38,38,0.15)' }}
              onClick={() => onAction({ action: 'allin' })}
            >
              ALL-IN {stack}
            </button>
          </>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
              onClick={() => onAction({ action: 'fold' })}
            >
              弃牌
            </Button>
            {canCheck ? (
              <Button
                variant="ghost"
                className="flex-1 h-11 text-sm font-bold border border-[var(--border)] active:translate-y-px active:brightness-90"
                onClick={() => onAction({ action: 'check' })}
              >
                过牌
              </Button>
            ) : (
              <Button
                variant="teal"
                className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
                disabled={!canCall}
                onClick={() => onAction({ action: 'call' })}
              >
                跟注 {callAmount}
              </Button>
            )}
            <Button
              variant="amber"
              className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
              disabled={!canRaise}
              onClick={() => onAction({ action: 'raise', amount: raiseAmount })}
            >
              加注 {raiseAmount}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ─── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div className="flex items-stretch gap-2">
      {/* Left: raise slider area */}
      {canShowSlider && (
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] text-text-muted">加注到</span>
            <span className="mono font-heading text-[0.95rem] font-bold text-gold">{raiseAmount}</span>
          </div>
          {/* Range input with gold accent */}
          <div className="rounded bg-gold/5 p-1">
            <input
              type="range"
              min={minRaiseTotal}
              max={maxRaiseTotal > minRaiseTotal ? maxRaiseTotal : minRaiseTotal}
              value={raiseAmount}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="w-full appearance-none cursor-pointer"
              style={{ accentColor: 'var(--gold)' }}
            />
          </div>
          {/* 5 chip-shaped quick-bet presets */}
          <div className="flex justify-between px-0.5">
            {QUICK_BETS.map(({ label, mult }) => (
              <ChipButton
                key={label}
                label={label}
                onClick={() => {
                  const raiseSize = Math.round(pot * mult);
                  const raiseTo = currentBet + raiseSize;
                  setRaiseAmount(Math.min(Math.max(raiseTo, minRaiseTotal), maxRaiseTotal));
                }}
              />
            ))}
          </div>
          {/* Timer bar */}
          <TimerBar pct={pct} urgent={urgent} remaining={remaining} />
        </div>
      )}

      {/* Right: action buttons */}
      <div className={cn('flex flex-col gap-1', canShowSlider ? 'w-[130px] shrink-0' : 'w-full')}>
        {!canShowSlider && <TimerBar pct={pct} urgent={urgent} remaining={remaining} />}

        {/* Fold */}
        <Button
          variant="destructive"
          size="sm"
          className="h-8 border-l-2 border-loss text-xs active:translate-y-px active:brightness-90"
          onClick={() => onAction({ action: 'fold' })}
        >
          弃牌
        </Button>

        {canCheck ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs active:translate-y-px active:brightness-90"
            onClick={() => onAction({ action: 'check' })}
          >
            过牌
          </Button>
        ) : (
          <Button
            variant="teal"
            size="sm"
            className="h-8 text-xs active:translate-y-px active:brightness-90"
            disabled={!canCall}
            onClick={() => onAction({ action: 'call' })}
          >
            跟注 {callAmount}
          </Button>
        )}

        {isAllIn ? (
          <button
            className={cn(
              'w-full h-10 rounded-md',
              'bg-gradient-to-b from-[#ef4444] to-[#dc2626]',
              'text-white text-base font-black tracking-widest',
              'active:scale-[0.98] active:brightness-90 transition-transform duration-75'
            )}
            style={{ boxShadow: '0 0 16px rgba(220,38,38,0.3), 0 0 32px rgba(220,38,38,0.15)' }}
            onClick={() => onAction({ action: 'allin' })}
          >
            ALL-IN {stack}
          </button>
        ) : (
          <Button
            variant="amber"
            size="sm"
            className="h-8 text-xs active:translate-y-px active:brightness-90"
            disabled={!canRaise}
            onClick={() => onAction({ action: 'raise', amount: raiseAmount })}
          >
            加注 {raiseAmount}
          </Button>
        )}
      </div>
    </div>
  );
}

function TimerBar({ pct, urgent, remaining }: { pct: number; urgent: boolean; remaining: number }) {
  return (
    <div className="mt-0.5 flex items-center gap-2">
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-bg-base">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-100 ease-linear',
            urgent ? 'bg-gradient-to-r from-loss/80 to-loss' : 'bg-gradient-to-r from-crimson-dim to-crimson'
          )}
          style={{
            width: `${pct}%`,
            boxShadow: urgent ? '0 0 8px var(--loss), 2px 0 4px var(--loss)' : '2px 0 4px var(--crimson-glow)',
          }}
        />
      </div>
      <span className={cn('mono min-w-[24px] text-right text-[0.65rem] font-bold', urgent ? 'text-loss' : 'text-text-muted')}>
        {Math.ceil(remaining / 1000)}s
      </span>
    </div>
  );
}
