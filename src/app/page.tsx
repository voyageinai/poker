'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/runtime-config';
import type { StakeLevel } from '@/lib/stake-levels';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Coins, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { refreshNavChips } from '@/components/Nav';

interface LevelInfo extends StakeLevel {
  playerCount: number;
}

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

    // Refresh level stats every 10s
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
      // 1. Find or create a table for this level
      const res = await fetch(withBasePath('/api/tables'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: levelId }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) return;

      // 2. Auto-join the table so the player is seated on arrival
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

      // 3. Update chip display and navigate
      refreshNavChips();
      router.push(`/table/${data.id}`);
    } finally {
      setJoining(null);
    }
  }

  return (
    <div className="py-5 md:py-8">
      {/* Header with balance */}
      <div className="mb-5 md:mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="m-0 text-xl md:text-2xl font-bold tracking-tight text-text-primary">天下牌局</h1>
          <p className="mt-1 text-xs md:text-sm text-text-secondary">
            择一方桌，与群英一较高下
          </p>
        </div>
        {user && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-bg-surface px-3 py-1.5 md:px-4 md:py-2 self-start sm:self-auto">
            <Coins className="h-4 w-4 text-amber" />
            <span className="mono text-base md:text-lg font-bold text-amber">{user.chips.toLocaleString()}</span>
            {user.refreshed && (
              <span className="text-xs text-win">+每日俸禄</span>
            )}
          </div>
        )}
      </div>

      {/* Stake level grid */}
      <div className="grid grid-cols-1 gap-3 md:gap-4 md:grid-cols-2">
        {levels.map(level => {
          const canAfford = user ? user.chips >= level.minBalance : true;
          const isJoining = joining === level.id;

          return (
            <Card
              key={level.id}
              className={cn(
                'edge-light border border-[var(--border)] bg-bg-surface transition-all',
                canAfford
                  ? 'hover:border-teal/40 hover:shadow-[var(--glow-teal)]'
                  : 'opacity-60',
              )}
            >
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 md:p-5">
                {/* Level info */}
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-base md:text-lg font-bold text-text-primary">{level.name}</span>
                    {level.playerCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-win">
                        <Users className="h-3 w-3" />
                        {level.playerCount}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs md:text-sm">
                    <span className="text-text-muted">
                      盲注 <span className="mono font-semibold text-amber">{level.smallBlind}/{level.bigBlind}</span>
                    </span>
                    <span className="text-text-muted">
                      入局 <span className="mono font-semibold text-text-secondary">{level.minBuyin.toLocaleString()}—{level.maxBuyin.toLocaleString()}</span>
                    </span>
                    <span className="text-text-muted">
                      验资 <span className="mono font-semibold text-text-secondary">{level.minBalance.toLocaleString()}+</span>
                    </span>
                  </div>
                </div>

                {/* Join button */}
                {canAfford ? (
                  <Button
                    variant="teal"
                    onClick={() => handleJoin(level.id)}
                    disabled={isJoining}
                    className="h-11 w-full text-base font-bold sm:h-auto sm:w-auto sm:min-w-[80px] sm:text-sm"
                  >
                    {isJoining ? '...' : '入局'}
                  </Button>
                ) : (
                  <Button variant="ghost" disabled className="h-11 w-full gap-1 sm:h-auto sm:w-auto sm:min-w-[80px]">
                    <Lock className="h-3.5 w-3.5" />
                    银两不足
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Not logged in hint */}
      {!user && levels.length > 0 && (
        <div className="mt-6 text-center text-sm text-text-muted">
          <Button variant="link" onClick={() => router.push('/login')}>
            登录
          </Button>
          后方可入局
        </div>
      )}
    </div>
  );
}
