'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PlayingCard from '@/components/PlayingCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/runtime-config';
import type { Card as CardType } from '@/lib/types';
import { useIsMobile } from '@/hooks/useMediaQuery';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserHandRow {
  id: string;
  hand_number: number;
  table_name: string;
  pot: number;
  ended_at: number;
  hole_cards: string | null;
  result: string | null;
  stack_start: number;
  stack_end: number | null;
  amount_won: number;
}

interface PlayerStats {
  total_hands: number;
  win_count: number;
  loss_count: number;
  total_profit: number;
}

interface AuditRow {
  id: number;
  category: string;
  action: string;
  target_id: string | null;
  detail: string;
  created_at: number;
}

type Tab = 'hands' | 'ledger';

const TAB_LABELS: Record<Tab, string> = {
  hands: '牌局',
  ledger: '账目',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  buyin: '入座买入',
  cashout: '离座兑现',
  rebuy: '重新买入',
  bot_buyin: 'Bot入座扣费',
  bot_cashout: 'Bot离座返还',
  daily_refresh: '每日俸禄',
  redeem_code: '兑换码兑换',
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
    return parts.join(' · ') || '';
  } catch { return ''; }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RecordsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('hands');

  useEffect(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(r => { if (!r.ok) throw new Error(); })
      .catch(() => router.push('/login'));
  }, [router]);

  return (
    <div className="py-4 md:py-6">
      <h1 className="mb-5 text-xl font-bold text-text-primary">
        <span className="glow-text-teal">战</span>绩
      </h1>

      {/* Tabs */}
      <div className="mb-5 flex gap-0 border-b border-[var(--border)]">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'cursor-pointer border-none bg-transparent px-4 py-2 text-sm transition-all',
              tab === t
                ? 'border-b-2 border-teal font-semibold text-teal -mb-px'
                : 'font-normal text-text-secondary hover:text-text-primary',
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'hands' && <HandsTab />}
      {tab === 'ledger' && <LedgerTab />}
    </div>
  );
}

// ─── Hands Tab ───────────────────────────────────────────────────────────────

function HandsTab() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<UserHandRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 30;

  const fetchHands = useCallback((p: number) => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
    fetch(withBasePath(`/api/hands/mine?${qs}`))
      .then(r => r.json() as Promise<{ rows: UserHandRow[]; total: number; stats: PlayerStats }>)
      .then(d => { setRows(d.rows); setTotal(d.total); setStats(d.stats); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchHands(page); }, [fetchHands, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {/* Stats summary */}
      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="总局数" value={stats.total_hands.toLocaleString()} />
          <StatCard label="胜局" value={stats.win_count.toLocaleString()} color="text-win" />
          <StatCard label="负局" value={stats.loss_count.toLocaleString()} color="text-loss" />
          <StatCard
            label="总盈亏"
            value={`${stats.total_profit >= 0 ? '+' : ''}${stats.total_profit.toLocaleString()}`}
            color={stats.total_profit >= 0 ? 'text-win' : 'text-loss'}
          />
        </div>
      )}

      {/* Hand list */}
      {loading ? (
        <p className="py-8 text-center text-text-muted">加载中...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-text-muted">暂无牌局记录</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            const profit = r.stack_end !== null ? r.stack_end - r.stack_start : null;
            const holeCards: [CardType, CardType] | null = r.hole_cards ? JSON.parse(r.hole_cards) : null;
            return (
              <Link
                key={r.id}
                href={`/hand/${r.id}`}
                className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-bg-surface px-4 py-3 no-underline transition-colors hover:bg-bg-hover"
              >
                {/* Hole cards */}
                <div className="flex shrink-0">
                  {holeCards ? (
                    <>
                      <PlayingCard card={holeCards[0]} size="xs" />
                      <div style={{ marginLeft: '-4px' }}>
                        <PlayingCard card={holeCards[1]} size="xs" />
                      </div>
                    </>
                  ) : (
                    <>
                      <PlayingCard faceDown size="xs" />
                      <div style={{ marginLeft: '-4px' }}>
                        <PlayingCard faceDown size="xs" />
                      </div>
                    </>
                  )}
                </div>

                {isMobile ? (
                  /* Mobile: two-line layout */
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">第 {r.hand_number} 局</span>
                      <span className="text-xs text-text-muted truncate flex-1">{r.table_name}</span>
                      {profit !== null && (
                        <span className={cn(
                          'mono text-sm font-bold whitespace-nowrap shrink-0',
                          profit > 0 ? 'text-win' : profit < 0 ? 'text-loss' : 'text-text-muted',
                        )}>
                          {profit > 0 ? '+' : ''}{profit.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-text-muted">
                        底池 <span className="mono text-amber">{r.pot}</span>
                      </span>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {r.ended_at ? fmtTime(r.ended_at) : ''}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Desktop: single-line layout */
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">第 {r.hand_number} 局</span>
                        <span className="text-xs text-text-muted truncate">{r.table_name}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-text-muted">
                        底池 <span className="mono text-amber">{r.pot}</span>
                      </div>
                    </div>
                    {profit !== null && (
                      <span className={cn(
                        'mono text-sm font-bold whitespace-nowrap',
                        profit > 0 ? 'text-win' : profit < 0 ? 'text-loss' : 'text-text-muted',
                      )}>
                        {profit > 0 ? '+' : ''}{profit.toLocaleString()}
                      </span>
                    )}
                    <span className="text-xs text-text-muted whitespace-nowrap">
                      {r.ended_at ? fmtTime(r.ended_at) : ''}
                    </span>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-bg-surface px-4 py-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={cn('mono text-lg font-bold', color ?? 'text-text-primary')}>{value}</div>
    </div>
  );
}

// ─── Ledger Tab ──────────────────────────────────────────────────────────────

function LedgerTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const fetchLogs = useCallback((p: number) => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
    fetch(withBasePath(`/api/audit/me?${qs}`))
      .then(r => r.json() as Promise<{ rows: AuditRow[]; total: number }>)
      .then(d => { setRows(d.rows); setTotal(d.total); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLogs(page); }, [fetchLogs, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="mb-3 text-xs text-text-muted">共 {total.toLocaleString()} 条</div>

      {loading ? (
        <p className="py-8 text-center text-text-muted">加载中...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-text-muted">暂无账目记录</p>
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
                  <span className="text-sm text-text-primary">
                    {ACTION_LABELS[r.action] ?? r.action}
                  </span>
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
        </div>
      )}

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
    </>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <Button variant="ghost" size="xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="h-11 px-4 md:h-auto md:px-2">
        上一页
      </Button>
      <span className="text-xs text-text-muted">{page} / {totalPages}</span>
      <Button variant="ghost" size="xs" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="h-11 px-4 md:h-auto md:px-2">
        下一页
      </Button>
    </div>
  );
}
