'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { withBasePath } from '@/lib/runtime-config';
import type { StakeLevel } from '@/lib/stake-levels';
import { Button } from '@/components/ui/button';
import { Lock, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { refreshNavChips } from '@/components/Nav';

interface LevelInfo extends StakeLevel {
  playerCount: number;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

/* ─── Tier visual config ──────────────────────────────────────────────────── */

interface TierStyle {
  py: string;
  nameClass: string;
  blindClass: string;
}

const TIERS: Record<string, TierStyle> = {
  micro: {
    py: 'py-5 md:py-6',
    nameClass: 'text-lg md:text-xl text-text-secondary',
    blindClass: 'text-sm text-text-muted',
  },
  low: {
    py: 'py-5 md:py-7',
    nameClass: 'text-lg md:text-xl text-text-primary/80',
    blindClass: 'text-sm text-gold-dim/70',
  },
  mid: {
    py: 'py-6 md:py-8',
    nameClass: 'text-xl md:text-2xl text-text-primary',
    blindClass: 'text-sm text-gold-dim',
  },
  high: {
    py: 'py-7 md:py-9',
    nameClass: 'text-2xl md:text-3xl text-text-primary',
    blindClass: 'text-base text-gold/80',
  },
  elite: {
    py: 'py-8 md:py-11',
    nameClass: 'text-3xl md:text-4xl text-gold',
    blindClass: 'text-base text-gold',
  },
};

/* ─── Level Row ───────────────────────────────────────────────────────────── */

function LevelRow({
  level,
  canAfford,
  isJoining,
  onJoin,
  index,
}: {
  level: LevelInfo;
  canAfford: boolean;
  isJoining: boolean;
  onJoin: () => void;
  index: number;
}) {
  const tier = TIERS[level.id] ?? TIERS.micro;
  const isElite = level.id === 'elite';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div
        className={cn(
          'group relative flex items-center gap-4 md:gap-8 px-5 md:px-8 transition-all duration-200 cursor-pointer',
          tier.py,
          canAfford
            ? 'hover:bg-[var(--bg-surface)]'
            : 'opacity-30 pointer-events-none',
        )}
        onClick={() => canAfford && !isJoining && onJoin()}
      >
        {/* Elite: shimmer top border */}
        {isElite && (
          <div
            className="absolute top-0 left-8 right-8 h-px pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--gold-dim), var(--gold), var(--gold-dim), transparent)',
              backgroundSize: '200% 100%',
              animation: 'rim-shimmer 4s linear infinite',
            }}
          />
        )}

        {/* Left: name + meta */}
        <div className="flex-1 min-w-0">
          <h2 className={cn(
            'font-heading font-bold tracking-[0.12em] leading-tight m-0 transition-colors duration-200',
            tier.nameClass,
            canAfford && 'group-hover:text-gold',
          )}>
            {level.name}
          </h2>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-muted">
            <span>买入 <span className="mono text-text-secondary">{fmtNum(level.minBuyin)}–{fmtNum(level.maxBuyin)}</span></span>
            <span className="opacity-30">·</span>
            <span>验资 <span className="mono text-text-secondary">{fmtNum(level.minBalance)}+</span></span>
          </div>
        </div>

        {/* Center: blind */}
        <div className="hidden sm:block shrink-0 text-right">
          <div className={cn('mono font-bold tracking-wide', tier.blindClass)}>
            {level.smallBlind}/{level.bigBlind}
          </div>
        </div>

        {/* Blind on mobile: show below name */}
        <div className="sm:hidden shrink-0">
          <div className={cn('mono font-bold text-sm', tier.blindClass)}>
            {level.smallBlind}/{level.bigBlind}
          </div>
        </div>

        {/* Right: player count + action */}
        <div className="flex items-center gap-3 md:gap-5 shrink-0">
          {level.playerCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-win/80">
              <span className="w-1.5 h-1.5 rounded-full bg-win animate-pulse" />
              {level.playerCount}
            </span>
          )}

          {canAfford ? (
            <Button
              variant="ivory"
              size="sm"
              disabled={isJoining}
              className={cn(
                'tracking-wider gap-1',
                isElite && 'h-9 px-5 text-sm',
              )}
              onClick={(e) => { e.stopPropagation(); onJoin(); }}
            >
              {isJoining ? '...' : '入局'}
              <ArrowRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </Button>
          ) : (
            <span className="text-xs text-text-muted flex items-center gap-1">
              <Lock className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>

      {/* Divider — gold gradient for elite, subtle for others */}
      <div className={cn(
        'h-px mx-5 md:mx-8',
        isElite
          ? 'bg-gradient-to-r from-transparent via-gold-dim/40 to-transparent'
          : 'bg-[var(--border)]',
      )} />
    </motion.div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export default function LobbyPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ chips: number; username: string; refreshed?: boolean } | null>(null);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(r => r.ok ? r.json() : null)
      .then(setUser)
      .catch(() => {});

    fetch(withBasePath('/api/tables'))
      .then(r => r.json())
      .then(setLevels)
      .catch(() => {});

    const iv = setInterval(() => {
      fetch(withBasePath('/api/tables'))
        .then(r => r.json())
        .then(setLevels)
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  async function handleJoin(levelId: string) {
    if (!user) { router.push('/login'); return; }
    setJoining(levelId);
    try {
      const res = await fetch(withBasePath('/api/tables'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: levelId }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) return;

      const joinRes = await fetch(withBasePath(`/api/tables/${data.id}/join`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!joinRes.ok) {
        const err = await joinRes.json() as { error?: string };
        alert(err.error ?? '入座失败');
        return;
      }

      refreshNavChips();
      router.push(`/table/${data.id}`);
    } finally {
      setJoining(null);
    }
  }

  return (
    <div className="max-w-[860px] mx-auto">

      {/* Header — generous top space, editorial feel */}
      <div className="pt-10 md:pt-16 pb-8 md:pb-12 px-5 md:px-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="m-0 text-3xl md:text-[2.75rem] font-heading font-bold tracking-[0.2em] text-text-primary leading-none">
            天下牌局
          </h1>
          <p className="mt-4 text-sm text-text-muted tracking-[0.08em]">
            择一方桌，与群英一较高下
          </p>
        </div>
        {user && (
          <div className="flex items-baseline gap-2 self-start sm:self-auto">
            <span className="mono text-2xl font-bold text-gold tracking-tight">{user.chips.toLocaleString()}</span>
            <span className="text-xs text-text-muted">筹码</span>
            {user.refreshed && (
              <span className="text-xs text-win ml-1">+俸禄</span>
            )}
          </div>
        )}
      </div>

      {/* Top divider */}
      <div className="h-px mx-5 md:mx-8 bg-gradient-to-r from-gold-dim/40 via-gold-dim/20 to-transparent" />

      {/* Level list */}
      {levels.length > 0 && (
        <div>
          {levels.map((level, i) => (
            <LevelRow
              key={level.id}
              level={level}
              canAfford={user ? user.chips >= level.minBalance : true}
              isJoining={joining === level.id}
              onJoin={() => handleJoin(level.id)}
              index={i}
            />
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {levels.length === 0 && (
        <div className="px-5 md:px-8 py-6 space-y-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {/* Not logged in */}
      {!user && levels.length > 0 && (
        <div className="py-10 text-center text-sm text-text-muted">
          <Button variant="link" onClick={() => router.push('/login')} className="text-gold">
            登录
          </Button>
          {' '}后方可入局
        </div>
      )}
    </div>
  );
}
