'use client';
import { useState, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { DbBot } from '@/lib/types';
import { withBasePath } from '@/lib/runtime-config';
import { Hexagon, User, Plus } from 'lucide-react';

interface EmptySeatProps {
  seatIndex: number;
  tableId: string;
  isSeated: boolean;
  onSitDown: (seatIndex: number) => void;
  compact?: boolean;
}

export default function EmptySeat({ seatIndex, tableId, isSeated, onSitDown, compact }: EmptySeatProps) {
  const [bots, setBots] = useState<DbBot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Lazy-load bots when popover opens
  useEffect(() => {
    if (!open || bots !== null) return;
    fetch(withBasePath('/api/bots?scope=seatable'))
      .then(r => r.json())
      .then((data: DbBot[]) => setBots(data.filter(b => b.status === 'active')))
      .catch(() => setBots([]));
  }, [open, bots]);

  async function addBot(botId: string) {
    setLoading(true);
    try {
      const res = await fetch(withBasePath(`/api/tables/${tableId}/add-bot`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        alert(data.error ?? '添加失败');
        return;
      }
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-gold-dim/40 bg-bg-surface/30 text-text-muted transition-all hover:border-gold/60 hover:bg-bg-surface/60 hover:text-gold hover:shadow-[0_0_12px_rgba(212,165,116,0.1)]"
        style={{ width: compact ? 44 : 52, height: compact ? 44 : 52 }}
      >
        <Plus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} className="w-[180px] border-border-bright bg-bg-surface p-2">
        <div className="flex flex-col gap-1">
          {/* Sit down as human — only show if not already seated */}
          {!isSeated && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-xs"
                onClick={() => { onSitDown(seatIndex); setOpen(false); }}
              >
                <User className="h-3.5 w-3.5 text-amber" />
                入座
              </Button>
              <div className="my-0.5 h-px bg-[var(--border)]" />
            </>
          )}

          {/* Bot list */}
          <div className="text-[0.65rem] font-semibold text-text-muted uppercase tracking-wider px-2 py-0.5">
            添加 Bot
          </div>
          {bots === null ? (
            <div className="px-2 py-1 text-[0.7rem] text-text-muted">加载中...</div>
          ) : bots.length === 0 ? (
            <div className="px-2 py-1 text-[0.7rem] text-text-muted">无可用 Bot</div>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-[160px] overflow-y-auto">
              {bots.map(bot => (
                <Button
                  key={bot.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between gap-2 text-xs"
                  disabled={loading}
                  onClick={() => addBot(bot.id)}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Hexagon className="h-3 w-3 shrink-0 text-teal" />
                    {bot.name}
                  </span>
                  <span className="mono text-[0.65rem] text-teal shrink-0">
                    {bot.elo.toFixed(0)}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
