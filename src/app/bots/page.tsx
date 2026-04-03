'use client';
import { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import type { DbBot } from '@/lib/types';
import { withBasePath } from '@/lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  validating: '验证中',
  invalid: '无效',
  disabled: '已禁用',
};

function EloSparkline({ botId }: { botId: string }) {
  const [data, setData] = useState<Array<{ elo: number }>>([]);

  useEffect(() => {
    fetch(withBasePath(`/api/bots/${botId}`))
      .then(r => r.ok ? r.json() : null)
      .then((d: { eloHistory?: Array<{ elo: number; recorded_at: number }> } | null) => {
        if (d?.eloHistory && d.eloHistory.length >= 2) {
          setData([...d.eloHistory].reverse().map(h => ({ elo: h.elo })));
        }
      })
      .catch(() => {});
  }, [botId]);

  if (data.length < 2) return null;

  const latest = data[data.length - 1].elo;
  const first = data[0].elo;
  const color = latest >= first ? '#22c55e' : '#ef4444';

  return (
    <div className="w-full h-9" style={{ filter: `drop-shadow(0 0 2px ${color})` }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis domain={['dataMin - 10', 'dataMax + 10']} hide />
          <Line type="monotone" dataKey="elo" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  active: 'text-win border-win/30 bg-win/10',
  validating: 'text-amber border-amber/30 bg-amber/10',
  invalid: 'text-loss border-loss/30 bg-loss/10',
  disabled: 'text-text-muted border-border bg-bg-hover',
};

function BotHexAvatar({ name }: { name: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const color = `hsl(${hue}, 60%, 50%)`;
  return (
    <div className="flex-shrink-0 flex items-center justify-center w-10 h-10">
      <Hexagon
        className="w-9 h-9"
        style={{ color, fill: color, opacity: 0.85 }}
      />
    </div>
  );
}

function BotCard({ bot }: { bot: DbBot }) {
  const badgeClass = STATUS_BADGE_CLASSES[bot.status] ?? STATUS_BADGE_CLASSES.disabled;

  const eloClass =
    bot.elo > 1500
      ? 'glow-text-teal'
      : bot.elo > 1200
        ? 'text-amber'
        : 'text-text-secondary';

  return (
    <Card className="bg-bg-surface ring-0 border border-[var(--border)] rounded-lg py-0 gap-0">
      <CardContent className="flex flex-col gap-2 p-4">
        {/* Top row: avatar + name/description + badge */}
        <div className="flex items-start gap-3">
          <BotHexAvatar name={bot.name} />
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start">
              <div className="min-w-0">
                <div className="font-semibold text-text-primary truncate">{bot.name}</div>
                {bot.description && (
                  <div className="text-[0.8rem] text-text-muted mt-0.5 truncate">{bot.description}</div>
                )}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'text-[0.7rem] font-bold uppercase tracking-[0.05em] rounded flex-shrink-0 ml-2',
                  badgeClass
                )}
              >
                {STATUS_LABELS[bot.status] ?? bot.status}
              </Badge>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-6 pl-[52px]">
          <div>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-[0.05em]">Elo</div>
            <div className={cn('mono font-extrabold text-[1.3rem]', eloClass)}>
              {bot.elo.toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-[0.7rem] text-text-muted uppercase tracking-[0.05em]">对局数</div>
            <div className="mono text-text-secondary font-semibold text-[1.3rem]">
              {bot.games_played}
            </div>
          </div>
        </div>

        {/* Elo trend sparkline */}
        {bot.games_played >= 2 && (
          <div className="pl-[52px]">
            <EloSparkline botId={bot.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name) return;
    setUploading(true);
    setError('');

    const form = new FormData();
    form.append('name', name);
    form.append('description', description);
    form.append('file', file);

    try {
      const res = await fetch(withBasePath('/api/bots'), { method: 'POST', body: form });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '上传失败');
      setName('');
      setDescription('');
      setFile(null);
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="block text-[0.8rem] text-text-muted mb-1">Bot 名称 *</label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          required
          placeholder="MyBot v1.0"
          className="bg-bg-base border-[var(--border)] text-text-primary"
        />
      </div>
      <div>
        <label className="block text-[0.8rem] text-text-muted mb-1">描述</label>
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="策略描述..."
          className="bg-bg-base border-[var(--border)] text-text-primary"
        />
      </div>
      <div>
        <label className="block text-[0.8rem] text-text-muted mb-1">可执行文件 *</label>
        <Input
          type="file"
          required
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="bg-bg-base border-[var(--border)] text-text-primary py-1"
        />
      </div>
      {error && <div className="text-loss text-[0.85rem]">{error}</div>}
      <Button type="submit" variant="teal" disabled={uploading || !file || !name}>
        {uploading ? '上传验证中...' : '上传 Bot'}
      </Button>
    </form>
  );
}

export default function BotsPage() {
  const [bots, setBots] = useState<DbBot[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  const loadBots = async () => {
    const res = await fetch(withBasePath('/api/bots?scope=mine'));
    if (res.ok) setBots(await res.json() as DbBot[]);
  };

  useEffect(() => { loadBots(); }, []);

  return (
    <div className="py-5 md:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-5 md:mb-8">
        <div>
          <h1 className="m-0 text-xl md:text-2xl font-heading font-bold tracking-wider">我的 Bot</h1>
          <p className="mt-1 text-text-secondary text-xs md:text-sm">
            上传实现了 PBP 协议的可执行文件
          </p>
        </div>
        <Button variant="teal" onClick={() => setShowUpload(v => !v)} className="self-start sm:self-auto">
          {showUpload ? '取消' : '+ 上传 Bot'}
        </Button>
      </div>

      {showUpload && (
        <div className="edge-light bg-bg-surface border border-border-bright rounded-lg p-6 mb-6">
          <h2 className="m-0 mb-4 text-base font-semibold">上传新 Bot</h2>
          <UploadForm onUploaded={() => { setShowUpload(false); loadBots(); }} />
        </div>
      )}

      {/* PBP protocol hint */}
      <div className="scanlines font-mono text-xs md:text-sm bg-bg-surface border border-[var(--border)] rounded-lg p-3 md:p-4 mb-6 text-text-secondary overflow-x-auto">
        <div className="text-teal font-semibold mb-1.5">PBP 协议 — stdin/stdout 换行分隔 JSON</div>
        <div className="text-text-muted"># 服务器 → Bot</div>
        <div>{'{"type":"action_request","street":"preflop","pot":30,"toCall":20,"minRaise":20,"stack":980,...}'}</div>
        <div className="text-text-muted mt-1"># Bot → 服务器</div>
        <div>{'{"action":"raise","amount":60,"debug":{"equity":0.72,"ev":14.2,"reasoning":"Value bet AK"}}'}</div>
      </div>

      {bots.length === 0 ? (
        <div className="text-center text-text-muted py-12">
          暂无 Bot。在上方上传你的第一个 Bot 吧。
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {bots.map(bot => <BotCard key={bot.id} bot={bot} />)}
        </div>
      )}
    </div>
  );
}
