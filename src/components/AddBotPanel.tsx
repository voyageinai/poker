'use client';
import { useState, useEffect } from 'react';
import type { DbBot } from '@/lib/types';
import { withBasePath } from '@/lib/runtime-config';
import { isSystemBotPath } from '@/lib/system-bots';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  tableId: string;
  onAdded: () => void;
}

export default function AddBotPanel({ tableId, onAdded }: Props) {
  const [bots, setBots] = useState<DbBot[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(withBasePath('/api/bots?scope=seatable'))
      .then(r => r.json())
      .then((data: DbBot[]) => setBots(data.filter(b => b.status === 'active')))
      .catch(() => {});
  }, [open]);

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
        alert(data.error ?? '添加 Bot 失败');
        return;
      }
      onAdded();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        + 添加 Bot
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border-bright bg-bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.85rem] font-semibold">选择 Bot</span>
        <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>取消</Button>
      </div>
      {bots.length === 0 ? (
        <div className="text-sm text-text-muted">暂无可用 Bot。</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {bots.map(bot => (
            <button
              key={bot.id}
              disabled={loading}
              onClick={() => addBot(bot.id)}
              className="flex w-full cursor-pointer items-center justify-between rounded-md border border-[var(--border)] bg-bg-base px-3 py-2 text-left text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              <div>
                <div className="flex items-center gap-1.5 text-[0.85rem] font-semibold">
                  <span>{bot.name}</span>
                  {isSystemBotPath(bot.binary_path) && (
                    <Badge variant="outline" className="border-amber/25 bg-amber/10 px-1.5 py-0 text-[0.65rem] text-amber">
                      系统
                    </Badge>
                  )}
                </div>
                {bot.description && <div className="text-[0.7rem] text-text-muted">{bot.description}</div>}
              </div>
              <span className="mono text-sm font-bold text-teal">
                {bot.elo.toFixed(0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
