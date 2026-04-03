export type StakeLevelId = 'micro' | 'low' | 'mid' | 'high' | 'elite';

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
  { id: 'micro', name: '桃园结义',  smallBlind: 10,    bigBlind: 20,     minBuyin: 1_000,    maxBuyin: 2_000,    maxSeats: 9, minBalance: 2_000,    rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'low',   name: '群雄逐鹿',  smallBlind: 25,    bigBlind: 50,     minBuyin: 2_500,    maxBuyin: 5_000,    maxSeats: 9, minBalance: 5_000,    rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'mid',   name: '赤壁鏖战',  smallBlind: 100,   bigBlind: 200,    minBuyin: 10_000,   maxBuyin: 20_000,   maxSeats: 6, minBalance: 20_000,   rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'high',  name: '华山论剑',  smallBlind: 500,   bigBlind: 1_000,  minBuyin: 50_000,   maxBuyin: 100_000,  maxSeats: 6, minBalance: 100_000,  rakePercent: 0.05, rakeCapBB: 3 },
  { id: 'elite', name: '巅峰对决',  smallBlind: 2_500, bigBlind: 5_000,  minBuyin: 250_000,  maxBuyin: 500_000,  maxSeats: 6, minBalance: 500_000,  rakePercent: 0.04, rakeCapBB: 3 },
];

export function getStakeLevel(id: string): StakeLevel | undefined {
  return STAKE_LEVELS.find(l => l.id === id);
}

/**
 * Bot pool per stake level — keys are system bot keys from SYSTEM_BOTS.
 * On each fill, bots are randomly shuffled from the pool.
 */
export const LEVEL_BOT_POOL: Record<StakeLevelId, string[]> = {
  micro: ['house-nit', 'house-tag', 'house-lag', 'house-station', 'house-maniac', 'house-trapper', 'house-bully', 'house-tilter', 'house-shortstack', 'house-adaptive', 'house-gto'],
  low:   ['house-nit', 'house-tag', 'house-lag', 'house-station', 'house-maniac', 'house-trapper', 'house-bully', 'house-tilter', 'house-shortstack', 'house-adaptive', 'house-gto'],
  mid:   ['house-tag', 'house-lag', 'house-maniac', 'house-trapper', 'house-bully', 'house-shortstack', 'house-adaptive', 'house-gto'],
  high:   ['house-lag', 'house-maniac', 'house-trapper', 'house-shortstack', 'house-adaptive', 'house-gto'],
  elite:  ['house-gto', 'house-adaptive', 'house-lag', 'house-maniac', 'house-trapper', 'house-shortstack'],
};
