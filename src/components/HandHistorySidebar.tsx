'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { DbHand } from '@/lib/types';
import { withBasePath } from '@/lib/runtime-config';
import { ChevronUp, ChevronDown, Copy, Check } from 'lucide-react';
import { formatHandHistory } from '@/lib/hand-history-format';

interface Props {
  tableId: string;
}

export default function HandHistorySidebar({ tableId }: Props) {
  const [hands, setHands] = useState<DbHand[]>([]);
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = () => {
    fetch(withBasePath(`/api/hands?tableId=${tableId}`))
      .then(r => r.json())
      .then((data: DbHand[]) => setHands(data))
      .catch(() => {});
  };

  useEffect(() => { refresh(); }, [tableId]);
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [open, tableId]);

  async function handleCopy(handId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(withBasePath(`/api/hands/${handId}`));
      if (!res.ok) return;
      const data = await res.json();
      const text = formatHandHistory({
        hand: data.hand,
        players: data.players,
        actions: data.actions,
        nameMap: data.nameMap,
        kindMap: data.kindMap,
      });
      await navigator.clipboard.writeText(text);
      setCopiedId(handId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-[var(--border)] bg-bg-surface">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2.5 text-[0.85rem] font-semibold text-text-primary"
      >
        <span>牌局记录</span>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          {hands.length} 局 {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="max-h-[300px] overflow-y-auto border-t border-[var(--border)]">
          {hands.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">
              暂无已完成的牌局
            </div>
          ) : (
            hands.map(h => (
              <div
                key={h.id}
                className="flex items-center border-b border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-bg-hover"
              >
                <Link
                  href={`/hand/${h.id}`}
                  className="flex flex-1 items-center justify-between no-underline"
                >
                  <span className="mono text-text-secondary">第 {h.hand_number} 局</span>
                  <span className="chip-count mono text-sm">底池 {h.pot}</span>
                </Link>
                <button
                  onClick={(e) => handleCopy(h.id, e)}
                  className="ml-2 shrink-0 cursor-pointer border-none bg-transparent p-0.5 text-text-muted transition-colors hover:text-teal"
                  title="复制牌局记录"
                >
                  {copiedId === h.id
                    ? <Check className="h-3.5 w-3.5 text-win" />
                    : <Copy className="h-3.5 w-3.5" />
                  }
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
