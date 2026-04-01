'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PlayingCard from '@/components/PlayingCard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Card as CardType, DbHand, DbHandPlayer, DbHandAction, Street } from '@/lib/types';
import { withBasePath } from '@/lib/runtime-config';
import { ArrowLeft, Hexagon, Copy, Check } from 'lucide-react';
import { formatHandHistory } from '@/lib/hand-history-format';
import { Button } from '@/components/ui/button';

interface HandData {
  hand: DbHand;
  players: DbHandPlayer[];
  actions: DbHandAction[];
  nameMap: Record<number, string>;
  kindMap: Record<number, 'human' | 'bot'>;
}

const STREET_LABELS: Record<Street, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

const ACTION_LABELS: Record<string, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  allin: '全下',
};

const ACTION_COLORS: Record<string, string> = {
  fold: 'var(--fold)',
  check: '#10b981',
  call: 'var(--teal)',
  raise: 'var(--amber)',
  allin: '#f87171',
};

export default function HandReplayPage() {
  const params = useParams();
  const handId = params.id as string;
  const [data, setData] = useState<HandData | null>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!data) return;
    const text = formatHandHistory({
      hand: data.hand,
      players: data.players,
      actions: data.actions,
      nameMap: data.nameMap,
      kindMap: data.kindMap,
    });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    fetch(withBasePath(`/api/hands/${handId}`))
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [handId]);

  if (!data) {
    return (
      <div className="py-12 text-center text-text-muted">加载中...</div>
    );
  }

  const { hand, players, actions, nameMap, kindMap } = data;
  const board: CardType[] = JSON.parse(hand.board || '[]');

  // Group actions by street
  const streetGroups: Array<{ street: Street; actions: DbHandAction[] }> = [];
  let currentStreet: Street | null = null;
  for (const a of actions) {
    if (a.street !== currentStreet) {
      currentStreet = a.street;
      streetGroups.push({ street: a.street, actions: [] });
    }
    streetGroups[streetGroups.length - 1].actions.push(a);
  }

  // Board cards revealed per street
  const boardByStreet = (street: Street): CardType[] => {
    switch (street) {
      case 'preflop': return [];
      case 'flop': return board.slice(0, 3);
      case 'turn': return board.slice(0, 4);
      case 'river': return board;
      default: return [];
    }
  };

  const getName = (seat: number) => nameMap[seat] ?? `座位 ${seat}`;
  const getKind = (seat: number) => kindMap[seat] ?? 'human';

  return (
    <div className="py-4 md:py-8 max-w-[900px] mx-auto">
      <Link
        href="/"
        className="text-text-muted text-[0.85rem] no-underline hover:text-text-secondary transition-colors"
      >
        <ArrowLeft className="inline h-4 w-4" /> 返回大厅
      </Link>

      <div className="mt-2 mb-1 flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight m-0">
          第 {hand.hand_number} 局
          <span className="text-text-muted font-normal ml-3 text-[0.85rem]">
            底池: <span className="chip-count mono">{hand.pot}</span>
          </span>
        </h1>
        <Button variant="ghost" size="xs" onClick={handleCopy} className="gap-1 text-text-muted hover:text-teal">
          {copied ? <Check className="h-3.5 w-3.5 text-win" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制牌局'}
        </Button>
      </div>
      {hand.started_at && (
        <div className="text-xs text-text-muted mb-6">
          {new Date(hand.started_at).toLocaleString('zh-CN')}
        </div>
      )}

      {/* Players overview */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {players.map(p => {
          const holeCards: [CardType, CardType] | null = p.hole_cards ? JSON.parse(p.hole_cards) : null;
          const isWinner = p.result === 'won';
          const kind = getKind(p.seat_index);
          return (
            <Card
              key={p.seat_index}
              size="sm"
              className={cn(
                'bg-bg-surface gap-0 py-3',
                isWinner
                  ? 'border-[rgba(34,197,94,0.4)] ring-0 shadow-[var(--glow-win)]'
                  : 'border-[var(--border)] ring-0',
              )}
            >
              <CardContent className="flex flex-col gap-0">
                {/* Name + badges */}
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'font-semibold text-[0.9rem]',
                        isWinner ? 'text-win' : 'text-text-primary',
                      )}
                    >
                      {getName(p.seat_index)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[0.6rem] font-mono h-auto py-0 px-1.5 rounded-[0.2rem] border-0',
                        kind === 'bot'
                          ? 'bg-[rgba(0,180,216,0.15)] text-teal'
                          : 'bg-[rgba(245,158,11,0.1)] text-amber',
                      )}
                    >
                      {kind === 'bot' ? <><Hexagon className="inline h-3 w-3" /> Bot</> : '玩家'}
                    </Badge>
                    {hand.button_seat === p.seat_index && (
                      <Badge
                        variant="outline"
                        className="text-[0.6rem] bg-[rgba(245,158,11,0.2)] text-amber border-0 h-auto py-0 px-1.5 rounded-[3px]"
                      >
                        BTN
                      </Badge>
                    )}
                  </div>
                  {isWinner && (
                    <span className="mono text-win font-bold text-[0.85rem]">
                      +{p.amount_won}
                    </span>
                  )}
                </div>

                {/* Seat number */}
                <div className="text-[0.7rem] text-text-muted mb-1.5">
                  座位 {p.seat_index}
                </div>

                {/* Hole cards — fanned */}
                <div className="flex mb-2" style={{ paddingLeft: '2px' }}>
                  {holeCards ? (
                    <>
                      <div style={{ transform: 'rotate(-4deg)', zIndex: 1 }}>
                        <PlayingCard card={holeCards[0]} size="md" />
                      </div>
                      <div style={{ marginLeft: '-8px', transform: 'rotate(4deg)', zIndex: 2 }}>
                        <PlayingCard card={holeCards[1]} size="md" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ transform: 'rotate(-4deg)', zIndex: 1 }}>
                        <PlayingCard faceDown size="md" />
                      </div>
                      <div style={{ marginLeft: '-8px', transform: 'rotate(4deg)', zIndex: 2 }}>
                        <PlayingCard faceDown size="md" />
                      </div>
                    </>
                  )}
                </div>

                {/* Stack change */}
                <div className="mono text-[0.75rem] text-text-muted">
                  {p.stack_start} → {p.stack_end ?? '?'}
                  {p.stack_end !== null && p.stack_end !== undefined && (
                    <span
                      className={cn(
                        'ml-1.5 font-semibold',
                        p.stack_end > p.stack_start
                          ? 'text-win'
                          : p.stack_end < p.stack_start
                            ? 'text-loss'
                            : 'text-text-muted',
                      )}
                    >
                      {p.stack_end > p.stack_start ? '+' : ''}{p.stack_end - p.stack_start}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Board — noise-texture felt background */}
      <div className="relative noise-texture bg-bg-card border border-border-bright rounded-xl p-3 md:p-4 flex gap-1 md:gap-2 justify-center mb-6">
        {[0, 1, 2, 3, 4].map(i => (
          <PlayingCard key={i} card={board[i]} faceDown={!board[i]} size="lg" />
        ))}
      </div>

      {/* Action timeline */}
      <div className="bg-bg-surface border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border)] font-semibold text-[0.85rem] text-text-primary">
          操作记录
        </div>

        {streetGroups.map(({ street, actions: streetActions }) => (
          <div key={street} className="relative">
            {/* Continuous vertical timeline line */}
            <div className="absolute left-[11px] top-0 bottom-0 w-px bg-[var(--border)]" />

            {/* Street header */}
            <div className="relative flex items-center gap-3 px-4 py-2 bg-bg-base border-b border-[var(--border)] pl-8">
              {/* Street dot — larger, teal */}
              <div
                className="absolute left-[8px] w-[7px] h-[7px] rounded-full bg-teal"
                style={{ width: '10px', height: '10px', left: '7px' }}
              />
              <span className="font-bold text-[0.8rem] text-teal tracking-[0.05em]">
                {STREET_LABELS[street]}
              </span>
              <div className="flex gap-1">
                {boardByStreet(street).map((c, i) => (
                  <PlayingCard key={i} card={c} size="xs" />
                ))}
              </div>
            </div>

            {/* Actions in this street */}
            {streetActions.map((a, i) => {
              const playerName = getName(a.seat_index);
              const kind = getKind(a.seat_index);
              const actionColor = ACTION_COLORS[a.action] ?? 'var(--text-secondary)';
              return (
                <div
                  key={a.id ?? i}
                  className="relative flex items-center gap-3 pl-8 pr-4 py-2 border-b border-[var(--border)] text-[0.85rem]"
                >
                  {/* Action dot on the timeline line */}
                  <div
                    className="absolute rounded-full"
                    style={{
                      left: '8px',
                      width: '7px',
                      height: '7px',
                      background: actionColor,
                    }}
                  />

                  {/* Player name */}
                  <div className="min-w-[60px] md:min-w-[100px] flex items-center gap-1.5">
                    {kind === 'bot' && (
                      <Hexagon className="h-3 w-3 text-teal" />
                    )}
                    <span className="font-semibold text-text-primary text-[0.8rem]">
                      {playerName}
                    </span>
                  </div>

                  {/* Action badge */}
                  <Badge
                    variant="outline"
                    className="font-bold text-[0.75rem] tracking-[0.05em] min-w-[50px] h-auto py-0.5 px-1.5 rounded-[0.2rem] border-0"
                    style={{ color: actionColor, background: actionColor + '18' }}
                  >
                    {ACTION_LABELS[a.action] ?? a.action}
                  </Badge>

                  {/* Amount */}
                  {a.amount > 0 && (
                    <span className="mono text-amber font-semibold">{a.amount}</span>
                  )}

                  <span className="flex-1" />

                  {/* Stack after */}
                  <span className="mono text-text-muted text-[0.75rem]">
                    余 {a.stack_after}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {/* No actions fallback */}
        {streetGroups.length === 0 && (
          <div className="p-8 text-center text-text-muted text-[0.85rem]">
            无操作记录
          </div>
        )}
      </div>
    </div>
  );
}
