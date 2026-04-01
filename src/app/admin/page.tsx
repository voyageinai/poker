'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { withBasePath } from '@/lib/runtime-config';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EconomyData {
  totalSupply: number;
  treasury: number;
  playerChips: number;
  botChips: number;
  inPlay: number;
  totalRake: number;
}

interface OverviewData {
  activeTables: number;
  onlinePlayers: number;
  totalUsers: number;
  totalChips: number;
  recentHands: { id: string; pot: number; started_at: number; ended_at: number | null }[];
  economy?: EconomyData;
}

interface AdminUser {
  id: string;
  username: string;
  chips: number;
  elo: number;
  games_played: number;
  role: string;
  banned: number;
}

interface ChipCode {
  code: string;
  chips: number;
  use_count: number;
  max_uses: number;
  expires_at: number | null;
  created_at: number;
}

interface AdminBot {
  id: string;
  name: string;
  description: string;
  owner_username: string;
  owner_chips: number;
  games_played: number;
  status: 'active' | 'disabled' | 'validating';
}

type Tab = 'overview' | 'users' | 'codes' | 'bots' | 'audit';

const TAB_LABELS: Record<Tab, string> = {
  overview: '概览',
  users: '用户',
  codes: '兑换码',
  bots: 'Bot',
  audit: '审计日志',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: number | null | undefined) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function codeStatus(c: ChipCode): { label: string; color: string } {
  const now = Math.floor(Date.now() / 1000);
  if (c.use_count >= c.max_uses) return { label: '已用完', color: 'text-text-muted' };
  if (c.expires_at && c.expires_at < now) return { label: '已过期', color: 'text-loss' };
  return { label: '有效', color: 'text-win' };
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  glowClass,
}: {
  label: string;
  value: number | string;
  glowClass: string;
}) {
  return (
    <Card className="border-[var(--border)] bg-bg-surface">
      <CardContent className="p-4">
        <div className="mb-1 text-xs text-text-muted">{label}</div>
        <div className={cn('mono text-2xl font-bold', glowClass)}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(withBasePath('/api/admin/overview'))
      .then(r => r.json() as Promise<OverviewData>)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-text-muted py-8 text-center">加载中...</p>;
  if (!data) return <p className="text-loss py-8 text-center">加载失败</p>;

  const eco = data.economy;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="活跃桌数" value={data.activeTables} glowClass="glow-text-teal" />
        <StatCard label="在线人数" value={data.onlinePlayers} glowClass="glow-text-win" />
        <StatCard label="注册用户" value={data.totalUsers} glowClass="glow-text-amber" />
        <StatCard label="总筹码流通" value={data.totalChips} glowClass="text-text-primary" />
      </div>

      {/* Economy breakdown */}
      {eco && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-secondary">经济总览 (总量 {eco.totalSupply.toLocaleString()})</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="国库储备" value={eco.treasury} glowClass="glow-text-teal" />
            <StatCard label="玩家持有" value={eco.playerChips} glowClass="glow-text-amber" />
            <StatCard label="系统Bot" value={eco.botChips} glowClass="text-text-secondary" />
            <StatCard label="牌桌在玩" value={eco.inPlay} glowClass="glow-text-win" />
            <StatCard label="累计抽水" value={eco.totalRake} glowClass="text-loss" />
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-text-secondary">最近对局</h3>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-text-muted">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-right">底池</th>
                <th className="px-3 py-2 text-right">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.recentHands.map(h => (
                <tr key={h.id} className="border-b border-[var(--border)] last:border-0 hover:bg-bg-surface/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/hand/${h.id}`}
                      className="mono text-teal hover:underline text-xs"
                    >
                      {h.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="mono px-3 py-2 text-right text-amber">{h.pot.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-text-muted text-xs">{fmtTime(h.ended_at ?? h.started_at)}</td>
                </tr>
              ))}
              {data.recentHands.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-text-muted">暂无对局记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Chip Adjust Dialog ───────────────────────────────────────────────────────

function ChipDialog({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (isNaN(n)) return;
    setLoading(true);
    try {
      const res = await fetch(withBasePath(`/api/admin/users/${user.id}/chips`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: n }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? '操作失败');
      }
      toast.success('操作成功');
      setOpen(false);
      setAmount('');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="xs">
            调整筹码
          </Button>
        }
      />
      <DialogContent className="bg-bg-surface border-[var(--border)]">
        <DialogHeader>
          <DialogTitle>调整筹码 — {user.username}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-1">
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              数量（正数增加，负数扣除）
            </label>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="如：500 或 -200"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" variant="teal" size="sm" disabled={loading}>
              {loading ? '...' : '确认'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab: Users ───────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = useCallback((q?: string) => {
    setLoading(true);
    const qs = q ? `?search=${encodeURIComponent(q)}` : '';
    fetch(withBasePath(`/api/admin/users${qs}`))
      .then(r => r.json() as Promise<AdminUser[]>)
      .then(d => { setUsers(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function postAction(url: string, body?: object) {
    setActionLoading(url);
    try {
      const res = await fetch(withBasePath(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? '操作失败');
      }
      toast.success('操作成功');
      fetchUsers(search || undefined);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索用户名..."
          className="max-w-xs"
          onKeyDown={e => e.key === 'Enter' && fetchUsers(search || undefined)}
        />
        <Button variant="teal" size="sm" onClick={() => fetchUsers(search || undefined)}>
          搜索
        </Button>
      </div>

      {loading ? (
        <p className="text-text-muted py-4 text-center">加载中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-text-muted">
                <th className="px-3 py-2 text-left">用户名</th>
                <th className="px-3 py-2 text-right">筹码</th>
                <th className="px-3 py-2 text-right">Elo</th>
                <th className="px-3 py-2 text-right">对局数</th>
                <th className="px-3 py-2 text-center">角色</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const busy = actionLoading !== null;
                return (
                  <tr key={u.id} className="border-b border-[var(--border)] last:border-0 hover:bg-bg-surface/60">
                    <td className="px-3 py-2 font-medium text-text-primary">{u.username}</td>
                    <td className="mono px-3 py-2 text-right text-amber">{u.chips.toLocaleString()}</td>
                    <td className="mono px-3 py-2 text-right">{u.elo}</td>
                    <td className="mono px-3 py-2 text-right">{u.games_played}</td>
                    <td className="px-3 py-2 text-center">
                      {u.role === 'admin' ? (
                        <Badge className="bg-amber-dim border-amber text-amber">管理员</Badge>
                      ) : (
                        <Badge variant="outline" className="text-text-muted">用户</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {u.banned ? (
                        <Badge variant="destructive">已封禁</Badge>
                      ) : (
                        <Badge className="bg-win/10 border-win/30 text-win">正常</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <ChipDialog user={u} onDone={() => fetchUsers(search || undefined)} />
                        <Button
                          variant={u.banned ? 'teal' : 'destructive'}
                          size="xs"
                          disabled={busy}
                          onClick={() => postAction(`/api/admin/users/${u.id}/ban`)}
                        >
                          {u.banned ? '解封' : '封禁'}
                        </Button>
                        <Button
                          variant="amber"
                          size="xs"
                          disabled={busy}
                          onClick={() =>
                            postAction(`/api/admin/users/${u.id}/role`, {
                              role: u.role === 'admin' ? 'user' : 'admin',
                            })
                          }
                        >
                          {u.role === 'admin' ? '降级' : '升级'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-text-muted">
                    无用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Codes ───────────────────────────────────────────────────────────────

const EXPIRE_OPTIONS = [
  { label: '永不过期', value: '' },
  { label: '1天', value: '86400' },
  { label: '7天', value: '604800' },
  { label: '30天', value: '2592000' },
];

function CodesTab() {
  const [codes, setCodes] = useState<ChipCode[]>([]);
  const [treasury, setTreasury] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState<string | null>(null);

  // Create form state
  const [chips, setChips] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresIn, setExpiresIn] = useState('');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchCodes = useCallback(() => {
    setLoading(true);
    fetch(withBasePath('/api/admin/codes'))
      .then(r => r.json() as Promise<{ codes: ChipCode[]; treasury: number }>)
      .then(d => { setCodes(d.codes); setTreasury(d.treasury); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const chipsNum = parseInt(chips, 10);
    const maxUsesNum = parseInt(maxUses, 10);
    if (isNaN(chipsNum) || chipsNum <= 0) return;
    setCreating(true);
    try {
      const body: Record<string, number> = { chips: chipsNum, maxUses: maxUsesNum };
      if (expiresIn) body.expiresIn = parseInt(expiresIn, 10);
      const res = await fetch(withBasePath('/api/admin/codes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { code?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? '创建失败');
      setNewCode(data.code ?? null);
      setChips('');
      setMaxUses('1');
      setExpiresIn('');
      toast.success('操作成功');
      fetchCodes();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(code: string) {
    setRevoking(code);
    try {
      const res = await fetch(withBasePath(`/api/admin/codes/${code}`), { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? '撤销失败');
      }
      toast.success('操作成功');
      fetchCodes();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Treasury balance */}
      <div className="rounded-lg border border-amber/30 bg-amber/5 px-4 py-3">
        <span className="text-xs text-text-muted">国库余额：</span>
        <span className="mono ml-1 font-bold text-amber">{treasury.toLocaleString()}</span>
      </div>

      {/* Create form */}
      <Card className="border-[var(--border)] bg-bg-surface">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-secondary">创建兑换码</h3>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-text-muted">筹码数量</label>
              <Input
                type="number"
                min="1"
                value={chips}
                onChange={e => setChips(e.target.value)}
                placeholder="500"
                className="w-28"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">最大使用次数</label>
              <Input
                type="number"
                min="1"
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                className="w-24"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">过期时间</label>
              <select
                value={expiresIn}
                onChange={e => setExpiresIn(e.target.value)}
                className="h-8 rounded-lg border border-[var(--border)] bg-bg-base px-2 text-sm text-text-primary outline-none focus:border-teal"
              >
                {EXPIRE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="teal" size="sm" disabled={creating}>
              {creating ? '...' : '创建'}
            </Button>
          </form>

          {newCode && (
            <div className="mt-4 rounded-lg border border-teal/30 bg-teal/5 p-3">
              <div className="mb-1 text-xs text-text-muted">新兑换码（点击复制）</div>
              <button
                className="mono text-lg font-bold tracking-widest text-teal glow-text-teal cursor-pointer hover:opacity-80"
                onClick={() => {
                  navigator.clipboard.writeText(newCode);
                  toast.success('已复制到剪贴板');
                }}
              >
                {newCode}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Codes table */}
      {loading ? (
        <p className="text-text-muted py-4 text-center">加载中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-text-muted">
                <th className="px-3 py-2 text-left">兑换码</th>
                <th className="px-3 py-2 text-right">筹码</th>
                <th className="px-3 py-2 text-center">使用次数</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.map(c => {
                const { label, color } = codeStatus(c);
                return (
                  <tr key={c.code} className="border-b border-[var(--border)] last:border-0 hover:bg-bg-surface/60">
                    <td className="mono px-3 py-2 font-bold text-text-primary tracking-wider">{c.code}</td>
                    <td className="mono px-3 py-2 text-right text-amber">{c.chips.toLocaleString()}</td>
                    <td className="mono px-3 py-2 text-center">
                      {c.use_count}/{c.max_uses}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn('text-xs font-medium', color)}>{label}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={revoking === c.code}
                        onClick={() => handleRevoke(c.code)}
                      >
                        撤销
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {codes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-text-muted">
                    暂无兑换码
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Bots ────────────────────────────────────────────────────────────────

const BOT_STATUS_MAP: Record<AdminBot['status'], { label: string; className: string }> = {
  active:     { label: '运行中', className: 'bg-win/10 border-win/30 text-win' },
  disabled:   { label: '已禁用', className: 'bg-destructive/10 border-destructive/30 text-destructive' },
  validating: { label: '验证中', className: 'bg-amber-dim border-amber text-amber' },
};

function BotsTab() {
  const [bots, setBots] = useState<AdminBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchBots = useCallback(() => {
    setLoading(true);
    fetch(withBasePath('/api/admin/bots'))
      .then(r => r.json() as Promise<AdminBot[]>)
      .then(d => { setBots(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBots(); }, [fetchBots]);

  async function toggleStatus(bot: AdminBot) {
    setActionLoading(bot.id);
    try {
      const res = await fetch(withBasePath(`/api/admin/bots/${bot.id}/status`), {
        method: 'POST',
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? '操作失败');
      }
      toast.success('操作成功');
      fetchBots();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      {loading ? (
        <p className="text-text-muted py-4 text-center">加载中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-text-muted">
                <th className="px-3 py-2 text-left">名称</th>
                <th className="px-3 py-2 text-left">所有者</th>
                <th className="px-3 py-2 text-right">资金</th>
                <th className="px-3 py-2 text-right">对局数</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {bots.map(b => {
                const status = BOT_STATUS_MAP[b.status] ?? BOT_STATUS_MAP.disabled;
                return (
                  <tr key={b.id} className="border-b border-[var(--border)] last:border-0 hover:bg-bg-surface/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-text-primary">{b.name}</div>
                      {b.description && <div className="text-xs text-text-muted">{b.description}</div>}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{b.owner_username}</td>
                    <td className="mono px-3 py-2 text-right text-amber">{b.owner_chips.toLocaleString()}</td>
                    <td className="mono px-3 py-2 text-right">{b.games_played}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge className={cn('text-xs', status.className)}>{status.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant={b.status === 'active' ? 'destructive' : 'teal'}
                        size="xs"
                        disabled={actionLoading === b.id || b.status === 'validating'}
                        onClick={() => toggleStatus(b)}
                      >
                        {b.status === 'active' ? '禁用' : '启用'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {bots.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-text-muted">
                    暂无 Bot
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Audit ──────────────────────────────────────────────────────────────

interface AuditRow {
  id: number;
  user_id: string | null;
  category: string;
  action: string;
  target_id: string | null;
  detail: string;
  ip: string | null;
  created_at: number;
}

const CATEGORY_OPTIONS = [
  { label: '全部', value: '' },
  { label: '管理员', value: 'admin' },
  { label: '筹码', value: 'chips' },
  { label: '账户', value: 'account' },
  { label: '锦标赛', value: 'tournament' },
  { label: '系统', value: 'system' },
];

const CATEGORY_COLORS: Record<string, string> = {
  admin: 'text-loss',
  chips: 'text-amber',
  account: 'glow-text-teal',
  tournament: 'text-purple-400',
  system: 'text-text-muted',
};

const ACTION_LABELS: Record<string, string> = {
  adjust_chips: '调整筹码',
  ban_user: '封禁用户',
  unban_user: '解封用户',
  change_role: '变更角色',
  create_code: '创建兑换码',
  revoke_code: '撤销兑换码',
  toggle_bot: '切换Bot状态',
  buyin: '入座买入',
  cashout: '离座兑现',
  rebuy: '重新买入',
  redeem_code: '兑换码兑换',
  bot_buyin: 'Bot入座',
  bot_cashout: 'Bot离座',
  daily_refresh: '每日刷新',
  rake: '抽水',
  register: '注册',
  login: '登录',
  upload_bot: '上传Bot',
  bot_validated: 'Bot验证',
  create: '创建锦标赛',
  start: '开始锦标赛',
  eliminate: '淘汰',
  finish: '结束锦标赛',
};

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [username, setUsername] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const pageSize = 50;

  const fetchLogs = useCallback((p: number, cat: string, uname: string) => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set('page', String(p));
    qs.set('pageSize', String(pageSize));
    if (cat) qs.set('category', cat);
    if (uname.trim()) qs.set('username', uname.trim());
    fetch(withBasePath(`/api/admin/audit?${qs}`))
      .then(r => r.json() as Promise<{ rows: AuditRow[]; total: number }>)
      .then(d => { setRows(d.rows); setTotal(d.total); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLogs(page, category, username); }, [fetchLogs, page, category, username]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function summarizeDetail(detail: string): string {
    try {
      const d = JSON.parse(detail) as Record<string, unknown>;
      const parts: string[] = [];
      if (d.targetUsername) parts.push(String(d.targetUsername));
      if (d.amount !== undefined) parts.push(`${Number(d.amount) > 0 ? '+' : ''}${Number(d.amount).toLocaleString()}`);
      if (d.chips !== undefined && d.amount === undefined) parts.push(`+${Number(d.chips).toLocaleString()}`);
      if (d.code) parts.push(`码:${String(d.code)}`);
      if (d.botName) parts.push(String(d.botName));
      if (d.from && d.to) parts.push(`${d.from}→${d.to}`);
      if (d.status) parts.push(String(d.status));
      if (d.rank) parts.push(`#${d.rank}`);
      if (d.tableId) parts.push(`桌:${String(d.tableId).slice(0, 8)}`);
      return parts.join(' · ') || '-';
    } catch {
      return '-';
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-text-muted">分类</label>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            className="h-8 rounded-lg border border-[var(--border)] bg-bg-base px-2 text-sm text-text-primary outline-none focus:border-teal"
          >
            {CATEGORY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">用户名</label>
          <Input
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); fetchLogs(1, category, username); } }}
            placeholder="搜索用户名..."
            className="w-36"
          />
        </div>
        <Button variant="teal" size="sm" onClick={() => { setPage(1); fetchLogs(1, category, username); }}>
          搜索
        </Button>
        <div className="ml-auto text-xs text-text-muted">
          共 {total.toLocaleString()} 条
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-text-muted py-4 text-center">加载中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-text-muted">
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">分类</th>
                <th className="px-3 py-2 text-left">动作</th>
                <th className="px-3 py-2 text-left">摘要</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-bg-surface/60 cursor-pointer"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                    {fmtTime(r.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('text-xs font-medium', CATEGORY_COLORS[r.category] ?? 'text-text-muted')}>
                      {CATEGORY_OPTIONS.find(o => o.value === r.category)?.label ?? r.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-primary text-xs">
                    {ACTION_LABELS[r.action] ?? r.action}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {expanded === r.id ? (
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-muted bg-bg-base rounded p-2 mt-1">
                        {JSON.stringify(JSON.parse(r.detail), null, 2)}
                      </pre>
                    ) : (
                      summarizeDetail(r.detail)
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-text-muted">
                    暂无审计记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            上一页
          </Button>
          <span className="text-xs text-text-muted">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const router = useRouter();

  useEffect(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(r => r.ok ? r.json() as Promise<{ role: string }> : Promise.reject())
      .then(d => { if (d.role !== 'admin') router.push('/'); })
      .catch(() => router.push('/'));
  }, [router]);

  return (
    <div className="py-6">
      <h1 className="mb-5 text-xl font-bold text-text-primary">
        <span className="glow-text-teal">管理</span>后台
      </h1>

      {/* Tab bar — underline style matching login page */}
      <div className="mb-6 flex gap-0 border-b border-[var(--border)]">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'cursor-pointer border-none bg-transparent px-4 py-2 text-sm transition-all',
              tab === t
                ? 'border-b-2 border-teal font-semibold text-teal -mb-px'
                : 'font-normal text-text-secondary hover:text-text-primary'
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users'    && <UsersTab />}
      {tab === 'codes'    && <CodesTab />}
      {tab === 'bots'     && <BotsTab />}
      {tab === 'audit'    && <AuditTab />}
    </div>
  );
}
