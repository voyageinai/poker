export type StakeLevelId = 'micro' | 'low' | 'mid' | 'high';

export interface StakeLevel {
  id: StakeLevelId;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyin: number;
  maxBuyin: number;
  maxSeats: number;
  /** Minimum user chip balance required to sit at this level */
  minBalance: number;
  /** Rake percentage (0-1), e.g. 0.05 = 5% */
  rakePercent: number;
  /** Rake cap in big blinds */
  rakeCapBB: number;
}

export const STAKE_LEVELS: StakeLevel[] = [
  { id: 'micro', name: '桃园结义',  smallBlind: 10,   bigBlind: 20,    minBuyin: 400,    maxBuyin: 2_000,    maxSeats: 6, minBalance: 1_000,   rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'low',   name: '群雄逐鹿',  smallBlind: 50,   bigBlind: 100,   minBuyin: 2_000,  maxBuyin: 10_000,   maxSeats: 6, minBalance: 5_000,   rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'mid',   name: '赤壁鏖战',  smallBlind: 250,  bigBlind: 500,   minBuyin: 10_000, maxBuyin: 50_000,   maxSeats: 6, minBalance: 25_000,  rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'high',  name: '华山论剑',  smallBlind: 1000, bigBlind: 2_000, minBuyin: 50_000, maxBuyin: 200_000,  maxSeats: 9, minBalance: 100_000, rakePercent: 0.05, rakeCapBB: 3 },
];

export function getStakeLevel(id: string): StakeLevel | undefined {
  return STAKE_LEVELS.find(l => l.id === id);
}

/**
 * Bot pool per stake level — keys are system bot keys from SYSTEM_BOTS.
 * On each fill, bots are randomly shuffled from the pool.
 */
export const LEVEL_BOT_POOL: Record<StakeLevelId, string[]> = {
  micro: ['house-nit', 'house-tag', 'house-station', 'house-bully', 'house-tilter'],
  low:   ['house-tag', 'house-lag', 'house-station', 'house-maniac', 'house-trapper', 'house-bully', 'house-tilter'],
  mid:   ['house-lag', 'house-maniac', 'house-trapper', 'house-shortstack', 'house-adaptive', 'house-gto'],
  high:  ['house-adaptive', 'house-gto', 'house-trapper', 'house-lag', 'house-maniac', 'house-shortstack'],
};
