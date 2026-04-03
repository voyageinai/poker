'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { withBasePath } from '@/lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface Tournament {
  id: string;
  name: string;
  buyin: number;
  starting_chips: number;
  max_players: number;
  status: 'registering' | 'running' | 'complete';
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

const STATUS_DOT_CLASS: Record<string, string> = {
  registering: 'bg-win',
  running: 'bg-amber',
  complete: 'bg-text-muted',
};

const STATUS_LABELS: Record<string, string> = {
  registering: '报名中',
  running: '进行中',
  complete: '已结束',
};

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', buyin: 100, startingChips: 3000, maxPlayers: 6 });
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();

  const load = () => {
    fetch(withBasePath('/api/tournaments'))
      .then(r => r.json())
      .then(setTournaments)
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(withBasePath('/api/tournaments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) { setShowCreate(false); load(); }
    } finally { setLoading(false); }
  }

  return (
    <div className="py-4 md:py-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h1 className="m-0 text-xl md:text-2xl font-heading font-bold tracking-wider text-text-primary">锦标赛</h1>
          <p className="mt-1 text-sm text-text-secondary">
            SNG 赛制：报名满员后自动开赛。
          </p>
        </div>
        <Button variant="teal" onClick={() => setShowCreate(v => !v)} className="shrink-0">
          {showCreate ? '取消' : '+ 创建 SNG'}
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="mb-6 border border-border-bright bg-bg-surface">
          <CardContent className="pt-2">
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block mb-1 text-xs text-text-muted">锦标赛名称</label>
                <Input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="我的 SNG"
                />
              </div>
              <div>
                <label className="block mb-1 text-xs text-text-muted">买入</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.buyin}
                  onChange={e => setForm({ ...form, buyin: Number(e.target.value) })}
                  min={0}
                />
              </div>
              <div>
                <label className="block mb-1 text-xs text-text-muted">初始筹码</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.startingChips}
                  onChange={e => setForm({ ...form, startingChips: Number(e.target.value) })}
                  min={100}
                />
              </div>
              <div>
                <label className="block mb-1 text-xs text-text-muted">最大人数</label>
                <select
                  value={form.maxPlayers}
                  onChange={e => setForm({ ...form, maxPlayers: Number(e.target.value) })}
                  className="w-full rounded-md border border-input bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:ring-1 focus:ring-teal/50"
                >
                  {[2, 3, 4, 5, 6, 8, 9].map(n => <option key={n} value={n}>{n}人桌</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={loading} variant="teal" className="w-full h-11 md:h-auto">
                  {loading ? '创建中...' : '创建锦标赛'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tournament list */}
      {tournaments.length === 0 ? (
        <Card className="border border-[var(--border)] bg-bg-surface">
          <CardContent className="py-12 text-center text-text-muted">
            暂无锦标赛。创建一个开始吧。
          </CardContent>
        </Card>
      ) : isMobile ? (
          /* Mobile: card list */
          <div className="flex flex-col gap-3">
            {tournaments.map(t => (
              <Link key={t.id} href={`/tournaments/${t.id}`} className="no-underline">
                <Card className="border border-[var(--border)] bg-bg-surface active:bg-bg-hover transition-colors">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-text-primary truncate">{t.name}</div>
                      <div className="flex items-center gap-3 mt-1 text-[0.8rem] text-text-secondary">
                        <span>买入 <span className="mono chip-count">{t.buyin}</span></span>
                        <span className="mono">{t.max_players}人</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <span className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS[t.status] ?? 'bg-text-muted'}`} />
                      <span className="text-sm text-text-secondary">{STATUS_LABELS[t.status] ?? t.status}</span>
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          /* Desktop: table */
          <Card className="border border-[var(--border)] bg-bg-surface overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['名称', '买入', '初始筹码', '人数', '状态', ''].map(h => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tournaments.map(t => (
                    <tr key={t.id} className="border-b border-[var(--border)]">
                      <td className="px-4 py-3 font-medium text-text-primary">{t.name}</td>
                      <td className="px-4 py-3">
                        <span className="mono chip-count">{t.buyin}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-text-secondary">
                        {t.starting_chips}
                      </td>
                      <td className="px-4 py-3 font-mono text-text-secondary">
                        {t.max_players}人桌
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS[t.status] ?? 'bg-text-muted'}`} />
                          <span className="text-sm text-text-secondary">{STATUS_LABELS[t.status] ?? t.status}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/tournaments/${t.id}`}>
                          <Button variant="ghost" size="sm">
                            查看
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )
      }
    </div>
  );
}
