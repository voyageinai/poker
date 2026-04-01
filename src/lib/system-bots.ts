export type SystemBotStyle = 'nit' | 'tag' | 'lag' | 'station' | 'maniac' | 'trapper' | 'bully' | 'tilter' | 'shortstack' | 'adaptive' | 'gto';

export interface SystemBotDefinition {
  key: string;
  botId: string;
  userId: string;
  username: string;
  name: string;
  description: string;
  style: SystemBotStyle;
  binaryPath: string;
}

export const SYSTEM_BOT_PATH_PREFIX = 'builtin:';
export const SYSTEM_BOT_USER_PREFIX = 'system:user:';

export const SYSTEM_BOTS: SystemBotDefinition[] = [
  {
    key: 'house-nit',
    botId: 'sysbot-house-nit',
    userId: 'system:user:house-nit',
    username: 'simayi',
    name: '司马懿',
    description: '隐忍蛰伏，只在必胜时出手。极度保守的策略大师',
    style: 'nit',
    binaryPath: 'builtin:house-nit',
  },
  {
    key: 'house-tag',
    botId: 'sysbot-house-tag',
    userId: 'system:user:house-tag',
    username: 'zhaoyun',
    name: '赵云',
    description: '攻守兼备的常胜将军。牌力精准，价值下注一击必中',
    style: 'tag',
    binaryPath: 'builtin:house-tag',
  },
  {
    key: 'house-lag',
    botId: 'sysbot-house-lag',
    userId: 'system:user:house-lag',
    username: 'sunwukong',
    name: '孙悟空',
    description: '大闹天宫的齐天大圣。出牌范围无边界，全程高压不喘气',
    style: 'lag',
    binaryPath: 'builtin:house-lag',
  },
  {
    key: 'house-station',
    botId: 'sysbot-house-station',
    userId: 'system:user:house-station',
    username: 'zhubajie',
    name: '猪八戒',
    description: '管不住手的天蓬元帅。什么牌都想看看，送你筹码最大方',
    style: 'station',
    binaryPath: 'builtin:house-station',
  },
  {
    key: 'house-maniac',
    botId: 'sysbot-house-maniac',
    userId: 'system:user:house-maniac',
    username: 'zhangfei',
    name: '张飞',
    description: '暴烈如火的猛将。逢牌必加，疯狂下注，心脏不好慎入',
    style: 'maniac',
    binaryPath: 'builtin:house-maniac',
  },
  {
    key: 'house-trapper',
    botId: 'sysbot-house-trapper',
    userId: 'system:user:house-trapper',
    username: 'wangxifeng',
    name: '王熙凤',
    description: '机关算尽的凤辣子。慢打大牌设埋伏，你以为她弱她反杀你',
    style: 'trapper',
    binaryPath: 'builtin:house-trapper',
  },
  {
    key: 'house-bully',
    botId: 'sysbot-house-bully',
    userId: 'system:user:house-bully',
    username: 'luzhishen',
    name: '鲁智深',
    description: '拳打镇关西的花和尚。专挑短码欺负，筹码碾压绝不留情',
    style: 'bully',
    binaryPath: 'builtin:house-bully',
  },
  {
    key: 'house-tilter',
    botId: 'sysbot-house-tilter',
    userId: 'system:user:house-tilter',
    username: 'linchong',
    name: '林冲',
    description: '忍辱负重的豹子头。平时沉稳如水，连输几把后怒火燎原',
    style: 'tilter',
    binaryPath: 'builtin:house-tilter',
  },
  {
    key: 'house-shortstack',
    botId: 'sysbot-house-shortstack',
    userId: 'system:user:house-shortstack',
    username: 'yanqing',
    name: '燕青',
    description: '身手敏捷的浪子。筹码虽少但招招致命，擅长以小博大全下逼迫',
    style: 'shortstack',
    binaryPath: 'builtin:house-shortstack',
  },
  {
    key: 'house-adaptive',
    botId: 'sysbot-house-adaptive',
    userId: 'system:user:house-adaptive',
    username: 'caocao',
    name: '曹操',
    description: '乱世奸雄，因势利导。观察你的弱点，然后精准剥削',
    style: 'adaptive',
    binaryPath: 'builtin:house-adaptive',
  },
  {
    key: 'house-gto',
    botId: 'sysbot-house-gto',
    userId: 'system:user:house-gto',
    username: 'zhugeliang',
    name: '诸葛亮',
    description: '运筹帷幄的卧龙。攻守完美平衡，混合策略无懈可击',
    style: 'gto',
    binaryPath: 'builtin:house-gto',
  },
];

export function isSystemBotPath(binaryPath: string): boolean {
  return binaryPath.startsWith(SYSTEM_BOT_PATH_PREFIX);
}

export function isSystemBotUserId(userId: string): boolean {
  return userId.startsWith(SYSTEM_BOT_USER_PREFIX);
}

export function getSystemBotByBinaryPath(binaryPath: string): SystemBotDefinition | undefined {
  return SYSTEM_BOTS.find(bot => bot.binaryPath === binaryPath);
}

export function isSystemBotRecord(bot: { user_id: string; binary_path: string }): boolean {
  return isSystemBotUserId(bot.user_id) || isSystemBotPath(bot.binary_path);
}
