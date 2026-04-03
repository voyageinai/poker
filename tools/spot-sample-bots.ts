import type { Card, PbpServerMessage } from '@/lib/types';
import { BuiltinBotAgent } from '@/server/poker/agents';
import { SYSTEM_BOTS, type SystemBotStyle } from '@/lib/system-bots';

type SpotPlayer = {
  seat: number;
  playerId?: string;
  displayName?: string;
  stack: number;
  isBot?: boolean;
  elo?: number;
};

type SpotActionRequest = {
  street: 'preflop' | 'flop' | 'turn' | 'river';
  board: Card[];
  pot: number;
  currentBet: number;
  toCall: number;
  minRaise: number;
  stack: number;
  initialStack?: number;
  history: Array<{ seat: number; action: 'fold' | 'check' | 'call' | 'raise' | 'allin'; amount: number }>;
};

type SpotConfig = {
  heroSeat: number;
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  players: SpotPlayer[];
  holeCards: [Card, Card];
  request: SpotActionRequest;
  prelude?: PbpServerMessage[];
};

function parseStyles(): SystemBotStyle[] {
  const raw = process.env.SPOT_STYLES?.trim();
  if (!raw) return SYSTEM_BOTS.map(bot => bot.style);

  const styles = raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean) as SystemBotStyle[];

  return styles;
}

function parseConfig(): SpotConfig {
  const raw = process.env.SPOT_CONFIG;
  if (!raw) {
    throw new Error(
      'Missing SPOT_CONFIG JSON. Example: '
      + '\'{"heroSeat":5,"buttonSeat":3,"smallBlind":50,"bigBlind":100,"players":[{"seat":4,"stack":9377},{"seat":5,"stack":318}],"holeCards":["8h","6h"],"request":{"street":"preflop","board":[],"pot":200,"currentBet":237,"toCall":137,"minRaise":137,"stack":318,"initialStack":418,"history":[{"seat":4,"action":"raise","amount":237}]}}\'',
    );
  }

  return JSON.parse(raw) as SpotConfig;
}

function buildNewHand(config: SpotConfig): PbpServerMessage {
  const hero = config.players.find(player => player.seat === config.heroSeat);
  if (!hero) {
    throw new Error(`SPOT_CONFIG.players is missing hero seat ${config.heroSeat}`);
  }

  return {
    type: 'new_hand',
    handId: 'spot-sample',
    seat: config.heroSeat,
    stack: hero.stack,
    players: config.players.map(player => ({
      seat: player.seat,
      playerId: player.playerId ?? `p${player.seat}`,
      displayName: player.displayName ?? `P${player.seat}`,
      stack: player.stack,
      isBot: player.isBot ?? true,
      elo: player.elo,
    })),
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    buttonSeat: config.buttonSeat,
  };
}

async function sampleStyle(
  style: SystemBotStyle,
  config: SpotConfig,
  trials: number,
): Promise<void> {
  const def = SYSTEM_BOTS.find(bot => bot.style === style);
  if (!def) throw new Error(`Unknown style: ${style}`);

  const counts: Record<'fold' | 'check' | 'call' | 'raise' | 'allin', number> = {
    fold: 0,
    check: 0,
    call: 0,
    raise: 0,
    allin: 0,
  };

  let totalThinkMs = 0;
  let sampleReasoning = '';

  for (let i = 0; i < trials; i++) {
    const agent = new BuiltinBotAgent(def.userId, def);
    try {
      agent.notify(buildNewHand(config));
      agent.notify({ type: 'hole_cards', cards: config.holeCards });
      for (const msg of config.prelude ?? []) {
        agent.notify(msg);
      }

      const action = await agent.requestAction(config.request);
      counts[action.action]++;
      totalThinkMs += action.debug?.thinkMs ?? 0;
      if (!sampleReasoning && action.debug?.reasoning) {
        sampleReasoning = action.debug.reasoning;
      }
    } finally {
      agent.dispose();
    }
  }

  const pct = (n: number) => `${((n / Math.max(trials, 1)) * 100).toFixed(1)}%`;
  const avgThink = Math.round(totalThinkMs / Math.max(trials, 1));

  console.log(
    `${style.padEnd(10)} fold ${pct(counts.fold).padStart(6)} `
    + `check ${pct(counts.check).padStart(6)} `
    + `call ${pct(counts.call).padStart(6)} `
    + `raise ${pct(counts.raise).padStart(6)} `
    + `allin ${pct(counts.allin).padStart(6)} `
    + `avgThink ${String(avgThink).padStart(4)}ms`,
  );
  if (sampleReasoning) {
    console.log(`  sample: ${sampleReasoning}`);
  }
}

async function main() {
  const config = parseConfig();
  const styles = parseStyles();
  const trials = Number.parseInt(process.env.SPOT_TRIALS ?? '40', 10);

  console.log(`Spot: heroSeat=${config.heroSeat} buttonSeat=${config.buttonSeat} hole=${config.holeCards.join(' ')}`);
  console.log(
    `Request: ${config.request.street} pot=${config.request.pot} toCall=${config.request.toCall} `
    + `currentBet=${config.request.currentBet} stack=${config.request.stack}`,
  );

  for (const style of styles) {
    await sampleStyle(style, config, trials);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
