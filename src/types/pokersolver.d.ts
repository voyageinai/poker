declare module 'pokersolver' {
  export class Hand {
    name: string;
    rank: number;
    cards: Array<{ value: string; suit: string }>;
    [key: string]: unknown;
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
  }
}
