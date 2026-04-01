import type { Card, Street, DbHand, DbHandPlayer, DbHandAction } from './types';

const STREET_CN: Record<Street, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

const ACTION_CN: Record<string, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  allin: '全下',
};

const HAND_NAMES_CN: Record<string, string> = {
  'Royal Flush': '皇家同花顺',
  'Straight Flush': '同花顺',
  'Four of a Kind': '四条',
  'Full House': '葫芦',
  'Flush': '同花',
  'Straight': '顺子',
  'Three of a Kind': '三条',
  'Two Pair': '两对',
  'Pair': '一对',
  'High Card': '高牌',
};

function translateHand(name: string): string {
  for (const [en, zh] of Object.entries(HAND_NAMES_CN)) {
    if (name.startsWith(en)) return name.replace(en, zh);
  }
  return name;
}

function formatCard(c: Card): string {
  const suits: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
  return c[0] + (suits[c[1]] ?? c[1]);
}

interface FormatOptions {
  hand: DbHand;
  players: DbHandPlayer[];
  actions: DbHandAction[];
  nameMap: Record<number, string>;
  kindMap?: Record<number, 'human' | 'bot'>;
  /** Optional: hand ranking from pokersolver evaluation */
  handRankMap?: Record<number, string>;
}

/**
 * Format a complete hand into a shareable text block.
 *
 * Example output:
 * ━━━ Poker Arena 第 5 局 ━━━
 * 盲注 5/10 | 底池 588 | 2026-03-31 18:30
 * 公共牌: 4♥ 2♥ 9♣ 9♠ Q♦
 *
 * 【玩家】
 * 座0 caimengzi   [5♠ 6♣]  200 → 180 (-20)
 * 座1 铁岩 🤖     [K♣ 2♦]  195 → 195 (±0) 弃牌
 * 座2 稳弈 🤖     [2♠ A♠]  190 → 376 (+186) ★ 赢家
 * 座4 跟注侠 🤖   [8♠ 3♣]  407 → 217 (-190)
 *
 * 【操作】
 * ── 翻牌前 ──
 * 跟注侠 跟注 10
 * caimengzi 加注 20
 * 铁岩 弃牌
 * ...
 */
export function formatHandHistory(opts: FormatOptions): string {
  const { hand, players, actions, nameMap, kindMap, handRankMap } = opts;
  const board: Card[] = JSON.parse(hand.board || '[]');
  const lines: string[] = [];

  // Header
  lines.push(`━━━ Poker Arena 第 ${hand.hand_number} 局 ━━━`);
  const time = hand.started_at ? new Date(hand.started_at * 1000).toLocaleString('zh-CN') : '';
  lines.push(`底池 ${hand.pot}${time ? ` | ${time}` : ''}`);
  if (board.length > 0) {
    lines.push(`公共牌: ${board.map(formatCard).join(' ')}`);
  }
  lines.push('');

  // Players
  lines.push('【玩家】');
  const sortedPlayers = [...players].sort((a, b) => a.seat_index - b.seat_index);
  for (const p of sortedPlayers) {
    const name = nameMap[p.seat_index] ?? `座位${p.seat_index}`;
    const kind = kindMap?.[p.seat_index];
    const botTag = kind === 'bot' ? ' 🤖' : '';
    const holeCards: [Card, Card] | null = p.hole_cards ? JSON.parse(p.hole_cards) : null;
    const cards = holeCards ? `[${formatCard(holeCards[0])} ${formatCard(holeCards[1])}]` : '[** **]';
    const stackEnd = p.stack_end ?? p.stack_start;
    const diff = stackEnd - p.stack_start;
    const diffStr = diff > 0 ? `+${diff}` : diff === 0 ? '±0' : `${diff}`;
    const resultTag = p.result === 'won' ? ' ★赢家' : p.result === 'lost' && diff < 0 ? '' : '';
    const handRank = handRankMap?.[p.seat_index];
    const rankStr = handRank ? ` ${translateHand(handRank)}` : '';

    lines.push(`座${p.seat_index} ${name}${botTag}  ${cards}  ${p.stack_start}→${stackEnd} (${diffStr})${rankStr}${resultTag}`);
  }
  lines.push('');

  // Actions grouped by street
  lines.push('【操作】');
  let currentStreet: Street | null = null;
  for (const a of actions) {
    if (a.street !== currentStreet) {
      currentStreet = a.street;
      const streetBoard = currentStreet === 'flop' ? board.slice(0, 3)
        : currentStreet === 'turn' ? board.slice(0, 4)
        : currentStreet === 'river' ? board
        : [];
      const boardStr = streetBoard.length > 0 ? ` [${streetBoard.map(formatCard).join(' ')}]` : '';
      lines.push(`── ${STREET_CN[currentStreet]}${boardStr} ──`);
    }
    const name = nameMap[a.seat_index] ?? `座位${a.seat_index}`;
    const actionStr = ACTION_CN[a.action] ?? a.action;
    const amountStr = a.amount > 0 ? ` ${a.amount}` : '';
    lines.push(`${name} ${actionStr}${amountStr}`);
  }

  return lines.join('\n');
}
