'use client';
import type { ClientTableState, ClientPlayerState, Card, ShowdownResult, WinnerEntry } from '@/lib/types';
import SeatView from '@/components/table/SeatView';
import EmptySeat from '@/components/table/EmptySeat';
import BoardCards from '@/components/table/BoardCards';
import PotDisplay from '@/components/table/PotDisplay';
import WinnerOverlay from '@/components/table/WinnerOverlay';
import PlayingCard from '@/components/PlayingCard';

// ─── Elliptical table layout helpers ──────────────────────────────────────────

export function getSeatPosition(
  seatIndex: number,
  totalSeats: number,
  heroSeat: number | null,
  compact?: boolean,
): { x: number; y: number } {
  const offset = heroSeat !== null ? heroSeat : 0;
  const adjusted = (seatIndex - offset + totalSeats) % totalSeats;
  const angle = Math.PI / 2 - (adjusted / totalSeats) * 2 * Math.PI;

  if (compact) {
    // Mobile: tighter ellipse — keeps seats within bounds
    // Max x = 50+36 = 86%. With 64px seat on 375px = 8.5%. 86+8.5 = 94.5% ✓
    // Min x = 50-36 = 14%. 14-8.5 = 5.5% ✓
    return {
      x: 50 + 36 * Math.cos(angle),
      y: 50 + 32 * Math.sin(angle),
    };
  }

  return {
    x: 50 + 40 * Math.cos(angle),
    y: 50 + 35 * Math.sin(angle),
  };
}

/**
 * Mobile layout: distribute opponents across the upper arc only.
 * opponentIndex: 0-based index among non-hero players (left-to-right).
 * totalOpponents: number of opponents (totalSeats - 1).
 * Returns { x, y } as percentages of the container.
 */
export function getMobileSeatPosition(
  opponentIndex: number,
  totalOpponents: number,
): { x: number; y: number } {
  const angle = Math.PI + ((opponentIndex + 1) / (totalOpponents + 1)) * Math.PI;
  const rx = 40; // safe on 375px screens (min x ≈ 12%)
  const ry = 38;
  return {
    x: 50 + rx * Math.cos(angle),
    y: 50 + ry * Math.sin(angle),
  };
}

export function getBetPosition(seatPos: { x: number; y: number }): { x: number; y: number } {
  return {
    x: 50 + (seatPos.x - 50) * 0.5,
    y: 50 + (seatPos.y - 50) * 0.5,
  };
}

interface TableFeltProps {
  tableId: string;
  tableState: ClientTableState;
  myHoleCards: [Card, Card] | null;
  showdown: ShowdownResult[] | null;
  lastWinners: WinnerEntry[] | null;
  showBluff?: { seat: number; cards: [Card, Card]; playerName: string } | null;
  currentUserId: string | null;
  isSeated: boolean;
  heroSeat: number | null;
  winnerSeats: Set<number>;
  onSitDown: (seatIndex?: number) => void;
  compact?: boolean;
}

export default function TableFelt({
  tableId,
  tableState,
  myHoleCards,
  showdown,
  lastWinners,
  showBluff,
  currentUserId,
  isSeated,
  heroSeat,
  winnerSeats,
  onSitDown,
  compact,
}: TableFeltProps) {
  const totalSeats = tableState.players.length;
  const myPlayer = tableState.players.find(
    (p): p is ClientPlayerState => p !== null && p.userId === currentUserId
  ) ?? null;

  return (
    // compact: h-full to fill parent (parent is not flex, so flex-1 won't work)
    // desktop: flex-1 to share space with ActionBar in a flex-col parent
    <div className={compact ? 'relative w-full h-full overflow-visible' : 'relative w-full flex-1 min-h-0'}>
      {/* Green felt ellipse */}
      <div
        className="absolute rounded-[50%] noise-texture"
        style={{
          inset: compact ? '10% 6%' : '8% 4%',
          background: 'radial-gradient(ellipse at center, #2a1810 0%, #1a0f08 50%, #100a06 100%)',
          border: compact ? '1.5px solid var(--gold-dim)' : '2px solid var(--gold-dim)',
          boxShadow: compact
            ? 'inset 0 0 20px rgba(0,0,0,0.6), 0 2px 12px rgba(0,0,0,0.6)'
            : `inset 0 0 40px rgba(0,0,0,0.6), inset 0 2px 0 rgba(212,165,116,0.04), 0 2px 0 #1a0f08, 0 4px 0 #100a06, 0 6px 24px rgba(0,0,0,0.6)`,
        }}
      >
        <div
          className="absolute inset-0 rounded-[50%] pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 40% 35% at center, rgba(212,165,116,0.03), transparent)',
          }}
        />
      </div>

      {/* Center: pot + board */}
      <div
        className="absolute flex flex-col items-center gap-1 md:gap-2"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2,
        }}
      >
        <PotDisplay pot={tableState.pot} compact={compact} />

        <div className={compact ? 'bg-black/20 rounded-md px-1.5 py-1' : 'bg-black/20 rounded-lg px-3 py-2'}>
          <BoardCards cards={tableState.board} compact={compact} />
        </div>

        {lastWinners && (
          <WinnerOverlay
            lastWinners={lastWinners}
            myPlayer={myPlayer}
            compact={compact}
          />
        )}

        {showBluff && (
          <div className="mt-1 flex items-center gap-1.5 animate-pulse">
            <span className="text-xs font-bold text-red-400 tracking-wide">
              {showBluff.playerName} 亮牌示威!
            </span>
            <div className="flex gap-0.5">
              <PlayingCard card={showBluff.cards[0]} size={compact ? 'xs' : 'sm'} />
              <PlayingCard card={showBluff.cards[1]} size={compact ? 'xs' : 'sm'} />
            </div>
          </div>
        )}
      </div>

      {/* Seats */}
      {tableState.players.map((p, seatIdx) => {
        // In compact (mobile) mode, hero is rendered separately — skip
        if (compact && heroSeat !== null && seatIdx === heroSeat) return null;

        const pos = compact && heroSeat !== null
          ? (() => {
              const opponentSeats = tableState.players
                .map((_, i) => i)
                .filter(i => i !== heroSeat);
              const opponentIndex = opponentSeats.indexOf(seatIdx);
              return getMobileSeatPosition(opponentIndex, opponentSeats.length);
            })()
          : getSeatPosition(seatIdx, totalSeats, heroSeat, compact);

        if (p) {
          const showdownData = showdown?.find(r => r.seat === p.seatIndex);
          return (
            <div
              key={seatIdx}
              style={{
                position: 'absolute',
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 3,
              }}
            >
              <SeatView
                player={p}
                holeCards={p.userId === currentUserId ? myHoleCards : (showdownData?.holeCards ?? p.holeCards ?? null)}
                isActive={tableState.activeSeat === p.seatIndex}
                isMe={p.userId === currentUserId}
                isWinner={winnerSeats.has(p.seatIndex)}
                compact={compact}
                totalSeats={totalSeats}
              />
            </div>
          );
        }
        return (
          <div
            key={seatIdx}
            style={{
              position: 'absolute',
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 3,
            }}
          >
            <EmptySeat
              seatIndex={seatIdx}
              tableId={tableId}
              isSeated={isSeated}
              onSitDown={(idx) => onSitDown(idx)}
              compact={compact}
            />
          </div>
        );
      })}

      {/* Street bets */}
      {tableState.players.map((p, seatIdx) => {
        if (!p || p.streetBet <= 0) return null;
        if (compact && heroSeat !== null && seatIdx === heroSeat) return null;

        const seatPos = compact && heroSeat !== null
          ? (() => {
              const opponentSeats = tableState.players
                .map((_, i) => i)
                .filter(i => i !== heroSeat);
              const opponentIndex = opponentSeats.indexOf(seatIdx);
              return getMobileSeatPosition(opponentIndex, opponentSeats.length);
            })()
          : getSeatPosition(seatIdx, totalSeats, heroSeat, compact);
        const betPos = getBetPosition(seatPos);
        return (
          <div
            key={`bet-${seatIdx}`}
            style={{
              position: 'absolute',
              left: `${betPos.x}%`,
              top: `${betPos.y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 4,
            }}
          >
            <span
              className={`mono text-amber font-bold bg-black/50 rounded-[0.25rem] inline-flex items-center gap-[0.2rem] ${
                compact
                  ? 'text-[0.7rem] px-[0.3rem] py-[0.1rem]'
                  : 'text-[0.75rem] px-[0.4rem] py-[0.15rem]'
              }`}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: compact ? 8 : 10,
                  height: compact ? 8 : 10,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 35%, #e8c896, #a67c50)',
                  flexShrink: 0,
                }}
              />
              {p.streetBet}
            </span>
          </div>
        );
      })}
    </div>
  );
}
