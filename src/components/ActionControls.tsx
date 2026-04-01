'use client';
import { useState, useEffect, useRef } from 'react';
import type { PokerAction } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  const [raiseAmount, setRaiseAmount] = useState(currentBet + minRaise);

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
  const canRaise = stack > toCall && raiseAmount <= stack + (currentBet - toCall);
  const callAmount = Math.min(toCall, stack);
  const isAllIn = stack <= toCall;

  const minRaiseTotal = currentBet + minRaise;
  const maxRaiseTotal = currentBet + stack - toCall;
  const canShowSlider = stack > toCall;

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
              className="mobile-slider flex-1 appearance-none accent-amber cursor-pointer h-8"
              style={{ touchAction: 'none' }}
            />
            <span className="mono text-sm font-bold text-amber min-w-[48px] text-right">{raiseAmount}</span>
          </div>
        )}

        {/* Quick-bet presets — smaller pills */}
        {canShowSlider && (
          <div className="flex gap-1">
            {QUICK_BETS.map(({ label, mult }) => (
              <Button
                key={label}
                variant="ghost"
                size="xs"
                className="flex-1 text-[0.65rem] h-9 active:translate-y-px active:brightness-90"
                onClick={() => {
                  const raiseSize = Math.round(pot * mult);
                  const raiseTo = currentBet + raiseSize;
                  setRaiseAmount(Math.min(Math.max(raiseTo, minRaiseTotal), maxRaiseTotal));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        {/* Action buttons — full width row */}
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

          {isAllIn ? (
            <Button
              variant="amber"
              className="flex-1 h-11 text-sm font-extrabold uppercase tracking-wide glow-text-amber active:translate-y-px active:brightness-90"
              style={{ boxShadow: 'var(--glow-amber)' }}
              onClick={() => onAction({ action: 'allin' })}
            >
              ALL-IN {stack}
            </Button>
          ) : (
            <Button
              variant="amber"
              className="flex-1 h-11 text-sm font-bold active:translate-y-px active:brightness-90"
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

  // ─── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div className="flex items-stretch gap-2">
      {/* Left: raise slider area */}
      {canShowSlider && (
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] text-text-muted">加注到</span>
            <span className="mono text-[0.85rem] font-bold text-amber">{raiseAmount}</span>
          </div>
          {/* Range input with amber glow wrapper */}
          <div className="rounded bg-amber/5 p-1">
            <input
              type="range"
              min={minRaiseTotal}
              max={maxRaiseTotal > minRaiseTotal ? maxRaiseTotal : minRaiseTotal}
              value={raiseAmount}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="w-full appearance-none accent-amber cursor-pointer"
            />
          </div>
          {/* 5 quick-bet presets */}
          <div className="flex gap-1">
            {QUICK_BETS.map(({ label, mult }) => (
              <Button
                key={label}
                variant="ghost"
                size="xs"
                className="flex-1 text-[0.6rem] active:translate-y-px active:brightness-90"
                onClick={() => {
                  const raiseSize = Math.round(pot * mult);
                  const raiseTo = currentBet + raiseSize;
                  setRaiseAmount(Math.min(Math.max(raiseTo, minRaiseTotal), maxRaiseTotal));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          {/* Timer bar */}
          <TimerBar pct={pct} urgent={urgent} remaining={remaining} />
        </div>
      )}

      {/* Right: action buttons */}
      <div className={cn('flex flex-col gap-1', canShowSlider ? 'w-[130px] shrink-0' : 'w-full')}>
        {!canShowSlider && <TimerBar pct={pct} urgent={urgent} remaining={remaining} />}

        {/* Fold — left accent bar */}
        <Button
          variant="destructive"
          size="sm"
          className="border-l-2 border-loss text-xs active:translate-y-px active:brightness-90"
          onClick={() => onAction({ action: 'fold' })}
        >
          弃牌
        </Button>

        {canCheck ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs active:translate-y-px active:brightness-90"
            onClick={() => onAction({ action: 'check' })}
          >
            过牌
          </Button>
        ) : (
          <Button
            variant="teal"
            size="sm"
            className="text-xs active:translate-y-px active:brightness-90"
            disabled={!canCall}
            onClick={() => onAction({ action: 'call' })}
          >
            跟注 {callAmount}
          </Button>
        )}

        {isAllIn ? (
          <Button
            variant="amber"
            size="sm"
            className="glow-text-amber text-xs font-extrabold uppercase tracking-wide active:translate-y-px active:brightness-90"
            style={{ boxShadow: 'var(--glow-amber)' }}
            onClick={() => onAction({ action: 'allin' })}
          >
            ALL-IN {stack}
          </Button>
        ) : (
          <Button
            variant="amber"
            size="sm"
            className="text-xs active:translate-y-px active:brightness-90"
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
    <div className="mt-0.5 flex items-center gap-1.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-bg-base">
        <div
          className={cn(
            'h-full rounded-sm transition-[width] duration-100 ease-linear',
            urgent ? 'bg-loss' : 'bg-teal'
          )}
          style={{
            width: `${pct}%`,
            boxShadow: urgent ? '0 0 6px var(--loss)' : undefined,
          }}
        />
      </div>
      <span className={cn('mono min-w-[24px] text-right text-[0.65rem] font-bold', urgent ? 'text-loss' : 'text-text-muted')}>
        {Math.ceil(remaining / 1000)}s
      </span>
    </div>
  );
}
