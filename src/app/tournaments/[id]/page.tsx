'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { withBasePath } from '@/lib/runtime-config';
import type { BlindLevel, DbBot } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

interface TourneyData {
  id: string;
  name: string;
  buyin: number;
  starting_chips: number;
  max_players: number;
  status: string;
  blindSchedule: BlindLevel[];
  entries: Array<{
    user_id: string;
    bot_id: string | null;
    chips: number;
    final_rank: number | null;
    eliminated_at: number | null;
  }>;
  currentLevel: number | null;
  playersRemaining: number | null;
  tableId: string | null;
}

export default function TournamentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<TourneyData | null>(null);
  const [bots, setBots] = useState<DbBot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    fetch(withBasePath(`/api/tournaments/${id}`))
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    load();
    fetch(withBasePath('/api/bots?scope=seatable'))
      .then(r => r.json())
      .then(setBots)
      .catch(() => {});
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [id]);

  async function handleRegister(asHuman: boolean) {
    setRegistering(true);
    setError('');
    try {
      const res = await fetch(withBasePath(`/api/tournaments/${id}/register`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asHuman ? {} : { botId: selectedBotId }),
      });
      const result = await res.json() as { error?: string; started?: boolean };
      if (!res.ok) { setError(result.error ?? '操作失败'); return; }
      load();
      if (result.started && data?.tableId) {
        router.push(`/table/${data.tableId}`);
      }
    } finally { setRegistering(false); }
  }

  if (!data) {
    return (
      <div className="py-12 text-center text-text-muted">加载中...</div>
    );
  }

  const STATUS_LABELS: Record<string, string> = {
    registering: '报名中',
    running: '进行中',
    complete: '已结束',
  };

  const slotsRemaining = data.max_players - data.entries.length;

  return (
    <div className="py-8 max-w-[800px] mx-auto">
      <Link href="/tournaments" className="text-text-muted text-[0.85rem] no-underline hover:text-text-secondary">
        <ArrowLeft className="inline h-4 w-4" /> 锦标赛
      </Link>

      <h1 className="mt-2 mb-1 text-2xl font-bold tracking-tight">
        {data.name}
      </h1>
      <div className="flex gap-6 mb-6 text-[0.85rem] text-text-secondary">
        <span>买入: <span className="chip-count mono">{data.buyin}</span></span>
        <span>初始筹码: <span className="mono">{data.starting_chips}</span></span>
        <span>{data.max_players}人桌</span>
        <span className={cn(
          'font-semibold',
          data.status === 'registering' && 'text-win',
          data.status === 'running' && 'text-amber',
          data.status === 'complete' && 'text-text-muted',
        )}>
          {STATUS_LABELS[data.status] ?? data.status}
        </span>
      </div>

      {/* Registration area */}
      {data.status === 'registering' && (
        <Card className="mb-6 bg-bg-surface border border-border-bright rounded-lg">
          <CardContent className="pt-4">
            <div className="font-semibold mb-3">
              报名（剩余 {slotsRemaining} 个名额）
            </div>

            <div className="flex gap-3 items-end flex-wrap">
              <Button variant="teal" onClick={() => handleRegister(true)} disabled={registering}>
                以玩家身份报名
              </Button>

              {bots.length > 0 && (
                <div className="flex gap-2 items-center">
                  <select
                    value={selectedBotId}
                    onChange={e => setSelectedBotId(e.target.value)}
                    className="rounded-md border border-input bg-bg-base px-3 py-2 text-sm text-text-primary outline-none"
                  >
                    <option value="">— 选择 Bot —</option>
                    {bots.map(b => <option key={b.id} value={b.id}>{b.name} ({b.elo.toFixed(0)})</option>)}
                  </select>
                  <Button variant="amber" onClick={() => handleRegister(false)} disabled={registering || !selectedBotId}>
                    报名 Bot
                  </Button>
                </div>
              )}
            </div>

            {error && <div className="text-loss text-[0.85rem] mt-2">{error}</div>}
          </CardContent>
        </Card>
      )}

      {/* Link to active table */}
      {data.status === 'running' && data.tableId && (
        <div className="mb-6 flex items-center gap-4">
          <Link href={`/table/${data.tableId}`}>
            <Button variant="teal">观看直播 →</Button>
          </Link>
          {data.currentLevel !== null && data.currentLevel < data.blindSchedule.length && (
            <span className="text-[0.85rem] text-text-secondary">
              第 {data.blindSchedule[data.currentLevel].level} 级:
              <span className={cn('mono', 'text-amber')}>
                {' '}{data.blindSchedule[data.currentLevel].smallBlind}/{data.blindSchedule[data.currentLevel].bigBlind}
              </span>
              {data.playersRemaining !== null && ` · 剩余 ${data.playersRemaining} 名选手`}
            </span>
          )}
        </div>
      )}

      {/* Participants / Results */}
      <div className="bg-bg-surface border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border)] font-semibold text-[0.85rem]">
          {data.status === 'complete' ? '最终排名' : '参赛选手'}
        </div>
        {data.entries.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-[0.85rem]">
            暂无参赛者
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {['#', '选手', '筹码', '状态'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr key={e.user_id} className="border-b border-[var(--border)]">
                  <td className="px-4 py-2 font-mono text-text-muted">
                    {e.final_rank ?? (i + 1)}
                  </td>
                  <td className="px-4 py-2 font-medium">
                    {e.user_id.slice(0, 12)}
                    {e.bot_id && (
                      <span className="ml-1.5 text-[0.7rem] text-teal uppercase">bot</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="mono chip-count">{e.chips}</span>
                  </td>
                  <td className="px-4 py-2">
                    {e.eliminated_at ? (
                      <span className="text-loss text-[0.85rem]">已淘汰</span>
                    ) : (
                      <span className="text-win text-[0.85rem]">存活</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Blind schedule */}
      <div className="bg-bg-surface border border-[var(--border)] rounded-lg overflow-hidden mt-6">
        <div className="px-4 py-2.5 border-b border-[var(--border)] font-semibold text-[0.85rem]">
          盲注级别
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {['级别', '小盲', '大盲', '时长'].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.blindSchedule.map((bl, i) => (
              <tr
                key={bl.level}
                className={cn(
                  'border-b border-[var(--border)]',
                  data.currentLevel === i && 'bg-teal-glow',
                )}
              >
                <td className={cn(
                  'px-4 py-2 font-mono',
                  data.currentLevel === i ? 'font-bold text-teal' : 'font-normal text-text-secondary',
                )}>
                  {bl.level}
                </td>
                <td className="mono px-4 py-2 text-amber">{bl.smallBlind}</td>
                <td className="mono px-4 py-2 text-amber">{bl.bigBlind}</td>
                <td className="px-4 py-2 text-text-muted text-[0.85rem]">{bl.durationMinutes} 分钟</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
