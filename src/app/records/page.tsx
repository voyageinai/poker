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

const DEBIT_ACTIONS = new Set(['buyin', 'rebuy', 'bot_buyin']);

function chipDelta(action: string, detail: string): { text: string; color: string } | null {
  try {
    const d = JSON.parse(detail) as Record<string, unknown>;
    if (typeof d.amount === 'number') {
      const n = DEBIT_ACTIONS.has(action) ? -(d.amount as number) : (d.amount as number);
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
      {/* Page header */}
      <h1 className="font-heading mb-1 text-2xl font-bold text-text-primary tracking-wide">
        <span className="glow-text-gold">战</span>绩
      </h1>
      <div className="gold-divider mb-5" />

      {/* Pill-style tab switcher */}
      <div className="mb-5 rounded-lg bg-bg-base p-1 flex gap-1 w-fit">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'cursor-pointer border-none px-5 py-1.5 text-sm font-medium transition-all rounded-md',
              tab === t
                ? 'bg-bg-card text-text-primary shadow-sm'
                : 'bg-transparent text-text-muted hover:text-text-secondary',
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
          <StatCard
            label="总局数"
            value={stats.total_hands.toLocaleString()}
            accent="gold"
          />
          <StatCard
            label="胜局"
            value={stats.win_count.toLocaleString()}
            color="text-win"
            accent="win"
          />
          <StatCard
            label="负局"
            value={stats.loss_count.toLocaleString()}
            color="text-loss"
            accent="loss"
          />
          <StatCard
            label="总盈亏"
            value={`${stats.total_profit >= 0 ? '+' : ''}${stats.total_profit.toLocaleString()}`}
            color={stats.total_profit >= 0 ? 'text-win' : 'text-loss'}
            accent={stats.total_profit >= 0 ? 'win' : 'loss'}
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
            const isWin = profit !== null && profit > 0;
            return (
              <Link
                key={r.id}
                href={`/hand/${r.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-lg border bg-bg-surface px-4 py-3 no-underline',
                  'transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:bg-bg-hover',
                  isWin
                    ? 'border-l-2 border-l-[var(--color-gold)] border-[var(--border)]'
                    : 'border-[var(--border)]',
                )}
              >
                {/* Hole cards with fan effect */}
                <div className="flex shrink-0 items-center" style={{ width: isMobile ? 42 : 54 }}>
                  {holeCards ? (
                    <div className="relative" style={{ width: isMobile ? 42 : 54, height: isMobile ? 36 : 46 }}>
                      <span
                        className="absolute top-0 left-0"
                        style={{ transform: 'rotate(-3deg)', transformOrigin: 'bottom center', zIndex: 1 }}
                      >
                        <PlayingCard card={holeCards[0]} size={isMobile ? 'xs' : 'sm'} />
                      </span>
                      <span
                        className="absolute top-0"
                        style={{
                          left: isMobile ? 10 : 12,
                          transform: 'rotate(3deg)',
                          transformOrigin: 'bottom center',
                          zIndex: 2,
                        }}
                      >
                        <PlayingCard card={holeCards[1]} size={isMobile ? 'xs' : 'sm'} />
                      </span>
                    </div>
                  ) : (
                    <div className="relative" style={{ width: isMobile ? 42 : 54, height: isMobile ? 36 : 46 }}>
                      <span
                        className="absolute top-0 left-0"
                        style={{ transform: 'rotate(-3deg)', transformOrigin: 'bottom center', zIndex: 1 }}
                      >
                        <PlayingCard faceDown size={isMobile ? 'xs' : 'sm'} />
                      </span>
                      <span
                        className="absolute top-0"
                        style={{
                          left: isMobile ? 10 : 12,
                          transform: 'rotate(3deg)',
                          transformOrigin: 'bottom center',
                          zIndex: 2,
                        }}
                      >
                        <PlayingCard faceDown size={isMobile ? 'xs' : 'sm'} />
                      </span>
                    </div>
                  )}
                </div>

                {isMobile ? (
                  /* Mobile: two-line layout */
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary font-medium">第 {r.hand_number} 局</span>
                      <span className="text-xs text-text-muted truncate flex-1">{r.table_name}</span>
                      {profit !== null && (
                        <span className={cn(
                          'mono text-xs font-bold whitespace-nowrap shrink-0 rounded-full px-2.5 py-0.5',
                          profit > 0
                            ? 'bg-win/10 text-win'
                            : profit < 0
                              ? 'bg-loss/10 text-loss'
                              : 'text-text-muted bg-bg-base',
                        )}>
                          {profit > 0 ? '+' : ''}{profit.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-text-muted">
                        底池 <span className="mono text-amber">{r.pot.toLocaleString()}</span>
                      </span>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {r.ended_at ? fmtTime(r.ended_at) : ''}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Desktop: two-line layout with better hierarchy */
                  <div className="flex flex-1 min-w-0 items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">第 {r.hand_number} 局</span>
                        <span className="text-xs text-text-muted">·</span>
                        <span className="text-xs text-text-muted truncate">{r.table_name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3">
                        <span className="text-xs text-text-muted">
                          底池 <span className="mono text-amber">{r.pot.toLocaleString()}</span>
                        </span>
                        <span className="text-xs text-text-muted whitespace-nowrap">
                          {r.ended_at ? fmtTime(r.ended_at) : ''}
                        </span>
                      </div>
                    </div>
                    {profit !== null && (
                      <span className={cn(
                        'mono text-sm font-bold whitespace-nowrap shrink-0 rounded-full px-2.5 py-0.5',
                        profit > 0
                          ? 'bg-win/10 text-win'
                          : profit < 0
                            ? 'bg-loss/10 text-loss'
                            : 'text-text-muted bg-bg-base',
                      )}>
                        {profit > 0 ? '+' : ''}{profit.toLocaleString()}
                      </span>
                    )}
                  </div>
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

function StatCard({
  label,
  value,
  color,
  accent,
}: {
  label: string;
  value: string;
  color?: string;
  accent?: 'gold' | 'win' | 'loss';
}) {
  const borderAccent = {
    gold: 'border-l-2 border-l-[var(--color-gold)]',
    win: 'border-l-2 border-l-[var(--color-win)]',
    loss: 'border-l-2 border-l-[var(--color-loss)]',
  }[accent ?? 'gold'] ?? '';

  return (
    <div className={cn(
      'rounded-lg border border-[var(--border)] bg-bg-surface px-4 py-3',
      borderAccent,
    )}>
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className={cn('font-heading text-xl font-bold mono', color ?? 'text-text-primary')}>{value}</div>
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
            const delta = chipDelta(r.action, r.detail);
            const extra = summarize(r.detail);
            const isDebit = DEBIT_ACTIONS.has(r.action);
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-bg-surface px-4 py-3 transition-colors hover:bg-bg-hover"
              >
                {/* Colored dot indicator */}
                <span
                  className={cn(
                    'shrink-0 h-2 w-2 rounded-full',
                    isDebit ? 'bg-loss' : 'bg-win',
                  )}
                  aria-hidden="true"
                />

                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text-primary">
                    {ACTION_LABELS[r.action] ?? r.action}
                  </span>
                  {extra && (
                    <div className="mt-0.5 text-xs text-text-muted truncate">{extra}</div>
                  )}
                </div>
                {delta && (
                  <span className={cn(
                    'mono text-sm font-bold whitespace-nowrap shrink-0 rounded-full px-2.5 py-0.5',
                    delta.color === 'text-win' ? 'bg-win/10 text-win' : 'bg-loss/10 text-loss',
                  )}>
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

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="mt-5 flex items-center justify-center gap-3">
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-all border',
          page <= 1
            ? 'border-[var(--border)] text-text-muted cursor-not-allowed opacity-40'
            : 'border-[var(--border)] text-text-secondary bg-bg-surface hover:bg-bg-hover hover:text-text-primary cursor-pointer',
        )}
        aria-label="上一页"
      >
        上一页
      </button>

      <span className="rounded-full bg-bg-card border border-[var(--border)] px-3.5 py-1 text-xs font-semibold text-text-primary tabular-nums">
        {page} / {totalPages}
      </span>

      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-all border',
          page >= totalPages
            ? 'border-[var(--border)] text-text-muted cursor-not-allowed opacity-40'
            : 'border-[var(--border)] text-text-secondary bg-bg-surface hover:bg-bg-hover hover:text-text-primary cursor-pointer',
        )}
        aria-label="下一页"
      >
        下一页
      </button>
    </div>
  );
}
