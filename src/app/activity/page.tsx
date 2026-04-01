'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/runtime-config';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface AuditRow {
  id: number;
  user_id: string | null;
  category: string;
  action: string;
  target_id: string | null;
  detail: string;
  created_at: number;
}

const CATEGORY_OPTIONS = [
  { label: '全部', value: '' },
  { label: '筹码', value: 'chips' },
  { label: '账户', value: 'account' },
  { label: '锦标赛', value: 'tournament' },
];

const CATEGORY_COLORS: Record<string, string> = {
  admin: 'text-loss',
  chips: 'text-amber',
  account: 'glow-text-teal',
  tournament: 'text-purple-400',
  system: 'text-text-muted',
};

const ACTION_LABELS: Record<string, string> = {
  adjust_chips: '管理员调整筹码',
  ban_user: '被封禁',
  unban_user: '被解封',
  change_role: '角色变更',
  buyin: '入座买入',
  cashout: '离座兑现',
  rebuy: '重新买入',
  redeem_code: '兑换码兑换',
  bot_buyin: 'Bot入座扣费',
  bot_cashout: 'Bot离座返还',
  daily_refresh: '每日俸禄',
  rake: '抽水',
  register: '注册账户',
  login: '登录',
  upload_bot: '上传Bot',
  bot_validated: 'Bot验证完成',
  create: '创建锦标赛',
  start: '锦标赛开始',
  eliminate: '锦标赛淘汰',
  finish: '锦标赛结束',
};

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function chipDelta(detail: string): { text: string; color: string } | null {
  try {
    const d = JSON.parse(detail) as Record<string, unknown>;
    if (typeof d.amount === 'number') {
      const n = d.amount as number;
      if (n > 0) return { text: `+${n.toLocaleString()}`, color: 'text-win' };
      if (n < 0) return { text: n.toLocaleString(), color: 'text-loss' };
    }
    if (typeof d.chips === 'number') {
      return { text: `+${(d.chips as number).toLocaleString()}`, color: 'text-win' };
    }
  } catch { /* ignore */ }
  return null;
}

function summarize(detail: string): string {
  try {
    const d = JSON.parse(detail) as Record<string, unknown>;
    const parts: string[] = [];
    if (d.tableId) parts.push(`桌:${String(d.tableId).slice(0, 8)}`);
    if (d.botName) parts.push(String(d.botName));
    if (d.code) parts.push(`码:${String(d.code)}`);
    if (d.status) parts.push(String(d.status));
    if (d.rank) parts.push(`排名 #${d.rank}`);
    return parts.join(' · ') || '';
  } catch { return ''; }
}

export default function ActivityPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const pageSize = 50;

  useEffect(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(r => { if (!r.ok) throw new Error(); })
      .catch(() => router.push('/login'));
  }, [router]);

  const fetchLogs = useCallback((p: number, cat: string) => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set('page', String(p));
    qs.set('pageSize', String(pageSize));
    if (cat) qs.set('category', cat);
    fetch(withBasePath(`/api/audit/me?${qs}`))
      .then(r => r.json() as Promise<{ rows: AuditRow[]; total: number }>)
      .then(d => { setRows(d.rows); setTotal(d.total); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLogs(page, category); }, [fetchLogs, page, category]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="py-6">
      <h1 className="mb-5 text-xl font-bold text-text-primary">
        <span className="glow-text-teal">操作</span>记录
      </h1>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-3">
        <select
          value={category}
          onChange={e => { setCategory(e.target.value); setPage(1); }}
          className="h-8 rounded-lg border border-[var(--border)] bg-bg-base px-2 text-sm text-text-primary outline-none focus:border-teal"
        >
          {CATEGORY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-text-muted">共 {total.toLocaleString()} 条</span>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-text-muted py-8 text-center">加载中...</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            const delta = chipDelta(r.detail);
            const extra = summarize(r.detail);
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-bg-surface px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-medium', CATEGORY_COLORS[r.category] ?? 'text-text-muted')}>
                      {CATEGORY_OPTIONS.find(o => o.value === r.category)?.label ?? r.category}
                    </span>
                    <span className="text-sm text-text-primary">
                      {ACTION_LABELS[r.action] ?? r.action}
                    </span>
                  </div>
                  {extra && (
                    <div className="mt-0.5 text-xs text-text-muted truncate">{extra}</div>
                  )}
                </div>
                {delta && (
                  <span className={cn('mono text-sm font-bold whitespace-nowrap', delta.color)}>
                    {delta.text}
                  </span>
                )}
                <span className="text-xs text-text-muted whitespace-nowrap">
                  {fmtTime(r.created_at)}
                </span>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="text-text-muted py-8 text-center">暂无记录</p>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="ghost" size="xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            上一页
          </Button>
          <span className="text-xs text-text-muted">{page} / {totalPages}</span>
          <Button variant="ghost" size="xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
