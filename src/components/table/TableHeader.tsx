'use client';
import { Button } from '@/components/ui/button';
import type { ClientTableState } from '@/lib/types';
import { STATUS_LABELS } from '@/components/table/constants';

interface TableHeaderProps {
  tableId: string;
  tableState: ClientTableState;
  connected: boolean;
  isSeated: boolean;
  authLoading: boolean;
  currentUserId: string | null;
  sitDownError: string | null;
  onSitDown: () => void;
  onLeave: () => void;
  compact?: boolean;
}

export default function TableHeader({
  tableId,
  tableState,
  connected,
  isSeated,
  authLoading,
  currentUserId,
  sitDownError,
  onSitDown,
  onLeave,
  compact,
}: TableHeaderProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 bg-bg-surface border-b border-[var(--border)] px-3 py-1.5 shrink-0">
        <span className="mono text-teal font-bold text-xs">#{tableState.handNumber}</span>
        <span className="text-amber font-semibold text-xs">
          {STATUS_LABELS[tableState.status] ?? tableState.status}
        </span>
        <div className="flex-1" />
        {!isSeated && (
          <Button variant="teal" size="xs" onClick={onSitDown} disabled={authLoading} className="h-7 text-xs">
            {authLoading ? '...' : currentUserId ? '入座' : '登录'}
          </Button>
        )}
        {isSeated && (
          <Button variant="destructive" size="xs" onClick={onLeave} className="h-7 text-xs">
            离桌
          </Button>
        )}
        <div
          className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{
            background: connected ? 'var(--win)' : 'var(--loss)',
            boxShadow: connected ? '0 0 6px rgba(34,197,94,0.6)' : undefined,
          }}
        />
        {sitDownError && (
          <span className="text-[0.6rem] text-loss">{sitDownError}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-bg-surface border border-[var(--border)] rounded-lg px-3 py-[0.4rem] flex-wrap shrink-0">
      <div>
        <span className="mono text-text-muted text-[0.65rem]">桌子</span>
        <span className="ml-1 font-semibold text-text-primary text-[0.8rem]">{tableId.slice(0, 8)}</span>
      </div>
      <div className="w-px h-4 bg-[var(--border)]" />
      <div>
        <span className="mono text-text-muted text-[0.65rem]">牌局</span>
        <span className="mono ml-1 text-teal font-bold text-[0.8rem]">#{tableState.handNumber}</span>
      </div>
      <div className="w-px h-4 bg-[var(--border)]" />
      <span className="text-amber font-semibold text-[0.75rem]">
        {STATUS_LABELS[tableState.status] ?? tableState.status}
      </span>
      <div className="flex-1" />
      {!isSeated && (
        <Button variant="teal" size="xs" onClick={onSitDown} disabled={authLoading}>
          {authLoading ? '...' : currentUserId ? '入座' : '登录游玩'}
        </Button>
      )}
      {isSeated && (
        <Button variant="destructive" size="xs" onClick={onLeave}>
          离桌
        </Button>
      )}
      {sitDownError && (
        <span className="text-[0.65rem] text-loss">{sitDownError}</span>
      )}
      <div className="flex items-center gap-1">
        <div
          className="w-[6px] h-[6px] rounded-full"
          style={{
            background: connected ? 'var(--win)' : 'var(--loss)',
            boxShadow: connected ? '0 0 6px rgba(34,197,94,0.6)' : undefined,
          }}
        />
        <span className="text-[0.65rem] text-text-muted">{connected ? '已连接' : '断开'}</span>
      </div>
    </div>
  );
}
