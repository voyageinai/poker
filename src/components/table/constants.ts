import type { ActionType, Card } from '@/lib/types';

// ─── Action log types ─────────────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  kind: 'action' | 'street' | 'winner' | 'new_hand';
  seat?: number;
  action?: ActionType;
  amount?: number;
  street?: string;
  cards?: Card[];
  text?: string;
}

export const ACTION_LABELS: Record<string, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  allin: '全下',
};

export const ACTION_LOG_COLORS: Record<string, string> = {
  fold: 'var(--fold)',
  check: '#10b981',
  call: 'var(--crimson)',
  raise: 'var(--gold)',
  allin: '#f87171',
};

export const STREET_NAMES: Record<string, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

export const STATUS_LABELS: Record<string, string> = {
  waiting: '等待中',
  starting: '发牌中',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  hand_complete: '本局结束',
};

export const HAND_NAMES: Record<string, string> = {
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

export function translateHand(name: string): string {
  for (const [en, zh] of Object.entries(HAND_NAMES)) {
    if (name.startsWith(en)) return name.replace(en, zh);
  }
  return name;
}
