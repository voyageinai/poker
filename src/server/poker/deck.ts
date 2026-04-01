import type { Card, Rank, Suit } from '@/lib/types';

const RANKS: Rank[] = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS: Suit[] = ['h','d','c','s'];

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

/** Fisher-Yates shuffle, returns new shuffled array */
export function shuffle(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function freshShuffledDeck(): Card[] {
  return shuffle(freshDeck());
}

/** Draw n cards from the top of the deck. Mutates deck array. */
export function draw(deck: Card[], n: number): Card[] {
  if (deck.length < n) throw new Error(`Not enough cards: need ${n}, have ${deck.length}`);
  return deck.splice(0, n);
}

/** Burn one card (discard top). Mutates deck. */
export function burn(deck: Card[]): void {
  if (deck.length === 0) throw new Error('Cannot burn from empty deck');
  deck.splice(0, 1);
}

export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as Rank);
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

/** Format card for display, e.g. "A♥" */
export function displayCard(card: Card): string {
  const suitSymbols: Record<Suit, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
  return `${card[0]}${suitSymbols[suitOf(card)]}`;
}
