import type { Card, PlayerState, PokerAction, ActionType } from '@/lib/types';
import { createTableState, seatPlayer, startHand, applyAction, type TableEvent } from '@/server/poker/state-machine';
import { BuiltinBotAgent } from '@/server/poker/agents';
import { SYSTEM_BOTS, resolveSystemBotBuyin, type SystemBotStyle } from '@/lib/system-bots';

interface ExtraStats {
  actionRequests: number;
  totalFolds: number;
  totalChecks: number;
  totalCalls: number;
  totalRaises: number;
  totalAllins: number;
  preflopRequests: number;
  preflopFoldFacingAction: number;
  postflopFacingBet: number;
  postflopFoldFacingBet: number;
}

interface HUDStats {
  hands: number;
  vpip: number;
  pfr: number;
  postflopRaises: number;
  postflopCalls: number;
  sawFlop: number;
  wtsd: number;
}

interface ProfileOptions {
  mode: 'reset' | 'persistent';
  autoRebuy: boolean;
  stackMode: 'uniform' | 'system';
}

function emptyHUD(): HUDStats {
  return { hands: 0, vpip: 0, pfr: 0, postflopRaises: 0, postflopCalls: 0, sawFlop: 0, wtsd: 0 };
}

function emptyExtra(): ExtraStats {
  return {
    actionRequests: 0,
    totalFolds: 0,
    totalChecks: 0,
    totalCalls: 0,
    totalRaises: 0,
    totalAllins: 0,
    preflopRequests: 0,
    preflopFoldFacingAction: 0,
    postflopFacingBet: 0,
    postflopFoldFacingBet: 0,
  };
}

function createBotAgent(style: SystemBotStyle): BuiltinBotAgent {
  const def = SYSTEM_BOTS.find(b => b.style === style)!;
  return new BuiltinBotAgent(def.userId, def);
}

function resolveSeatStacks(
  styles: SystemBotStyle[],
  bigBlind: number,
  stackMode: ProfileOptions['stackMode'],
): number[] {
  const uniformStack = bigBlind * 100;
  if (stackMode === 'uniform') return styles.map(() => uniformStack);

  const minBuyin = bigBlind * 20;
  const maxBuyin = bigBlind * 100;
  return styles.map(style => {
    const def = SYSTEM_BOTS.find(b => b.style === style)!;
    return resolveSystemBotBuyin(def, bigBlind, minBuyin, maxBuyin);
  });
}

function seatLineup(
  styles: SystemBotStyle[],
  seatStacks: number[],
  tableId: string,
  smallBlind: number,
  bigBlind: number,
) {
  const state = createTableState(tableId, styles.length, smallBlind, bigBlind);
  for (let s = 0; s < styles.length; s++) {
    const def = SYSTEM_BOTS.find(b => b.style === styles[s])!;
    seatPlayer(state, s, {
      userId: def.userId,
      displayName: def.name,
      kind: 'bot',
      stack: seatStacks[s],
      streetBet: 0,
      totalBet: 0,
      holeCards: null,
      status: 'active',
      lastAction: null,
      debugInfo: null,
    });
  }
  return state;
}

function rebuyBustedPlayers(
  state: ReturnType<typeof createTableState>,
  seatStacks: number[],
): void {
  for (let seat = 0; seat < state.players.length; seat++) {
    const p = state.players[seat];
    if (!p) continue;
    if (p.stack > 0 && p.status !== 'sitting_out') continue;
    p.stack = seatStacks[seat];
    p.status = 'active';
    p.streetBet = 0;
    p.totalBet = 0;
    p.holeCards = null;
    p.lastAction = null;
    p.debugInfo = null;
  }
}

async function playHand(
  state: ReturnType<typeof createTableState>,
  agents: BuiltinBotAgent[],
  handIdx: number,
  seatStacks: number[],
  smallBlind: number,
  bigBlind: number,
  huds: HUDStats[],
  extras: ExtraStats[],
): Promise<void> {
  const numSeats = agents.length;
  const startEvents = startHand(state as Parameters<typeof startHand>[0]);
  const handStartStacks = state.players.map((p, idx) => (p ? p.stack + p.totalBet : seatStacks[idx]));

  for (let s = 0; s < numSeats; s++) {
    agents[s].notify({
      type: 'new_hand',
      handId: `profile-h${handIdx}`,
      seat: s,
      stack: handStartStacks[s] ?? seatStacks[s],
      players: state.players.filter((p): p is PlayerState => p !== null).map(p => ({
        seat: p.seatIndex,
        playerId: p.userId,
        displayName: p.displayName,
        stack: p.stack + p.totalBet,
        isBot: true,
        elo: 1200,
      })),
      smallBlind,
      bigBlind,
      buttonSeat: state.buttonSeat,
    });
  }

  let isPreflop = true;
  const seatSawFlop = new Array(numSeats).fill(false);
  const seatReachedShowdown = new Array(numSeats).fill(false);
  const seatVpip = new Array(numSeats).fill(false);
  const seatPfr = new Array(numSeats).fill(false);

  let pendingAction: { seat: number; toCall: number; minRaise: number } | null = null;
  let currentStreet: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop';
  let blindsPhase = true;
  let streetHistory: Array<{ seat: number; action: ActionType; amount: number }> = [];

  for (const ev of startEvents) {
    if (ev.kind === 'deal_hole_cards') {
      agents[ev.seat].notify({ type: 'hole_cards', cards: ev.cards });
    } else if (ev.kind === 'action_request') {
      pendingAction = { seat: ev.seat, toCall: ev.toCall, minRaise: ev.minRaise };
    }
  }

  let safety = 0;
  while (pendingAction && safety < 500) {
    safety++;
    const { seat, toCall, minRaise } = pendingAction;
    pendingAction = null;
    const player = state.players[seat];
    if (!player) break;
    blindsPhase = false;

    let response: PokerAction;
    try {
      const r = await agents[seat].requestAction({
        street: currentStreet,
        board: [...state.board] as Card[],
        pot: state.pot.total,
        currentBet: state.currentBet,
        toCall,
        minRaise,
        stack: player.stack,
        initialStack: handStartStacks[seat] ?? seatStacks[seat],
        history: [...streetHistory],
      });
      response = { action: r.action, amount: r.amount };
    } catch {
      response = { action: 'fold' };
    }

    const ex = extras[seat];
    ex.actionRequests++;
    if (currentStreet === 'preflop') ex.preflopRequests++;
    if (toCall > 0 && currentStreet !== 'preflop') ex.postflopFacingBet++;

    switch (response.action) {
      case 'fold':
        ex.totalFolds++;
        break;
      case 'check':
        ex.totalChecks++;
        break;
      case 'call':
        ex.totalCalls++;
        break;
      case 'raise':
        ex.totalRaises++;
        break;
      case 'allin':
        ex.totalAllins++;
        break;
    }

    if (currentStreet === 'preflop' && toCall > 0 && response.action === 'fold') {
      ex.preflopFoldFacingAction++;
    }
    if (currentStreet !== 'preflop' && toCall > 0 && response.action === 'fold') {
      ex.postflopFoldFacingBet++;
    }

    if (isPreflop) {
      if (response.action === 'raise' || response.action === 'allin') {
        seatPfr[seat] = true;
        seatVpip[seat] = true;
      } else if (response.action === 'call') {
        seatVpip[seat] = true;
      }
    } else {
      if (response.action === 'raise' || response.action === 'allin') {
        huds[seat].postflopRaises++;
      } else if (response.action === 'call') {
        huds[seat].postflopCalls++;
      }
    }

    let resultEvents: TableEvent[];
    try {
      resultEvents = applyAction(state as Parameters<typeof applyAction>[0], seat, response);
    } catch {
      try {
        const fallback: PokerAction = toCall > 0 ? { action: 'fold' } : { action: 'check' };
        resultEvents = applyAction(state as Parameters<typeof applyAction>[0], seat, fallback);
      } catch {
        break;
      }
    }

    for (const ev of resultEvents) {
      switch (ev.kind) {
        case 'player_action':
          for (const a of agents) {
            a.notify({ type: 'player_action', seat: ev.seat, action: ev.action, amount: ev.amount });
          }
          if (!blindsPhase) {
            streetHistory.push({ seat: ev.seat, action: ev.action as ActionType, amount: ev.amount });
          }
          break;

        case 'deal_board':
          if (ev.street === 'flop') {
            isPreflop = false;
            for (let s = 0; s < numSeats; s++) {
              const p = state.players[s];
              if (p && (p.status === 'active' || p.status === 'allin')) {
                seatSawFlop[s] = true;
              }
            }
          }
          currentStreet = ev.street;
          streetHistory = [];
          for (const a of agents) {
            a.notify({ type: 'street', name: ev.street, board: [...state.board] as Card[] });
          }
          break;

        case 'action_request':
          pendingAction = { seat: ev.seat, toCall: ev.toCall, minRaise: ev.minRaise };
          break;

        case 'showdown':
          for (const a of agents) {
            a.notify({
              type: 'showdown_result',
              players: ev.results.map(r => ({ seat: r.seat, playerId: r.userId, cards: r.holeCards })),
            });
          }
          for (let s = 0; s < numSeats; s++) {
            if (seatSawFlop[s]) seatReachedShowdown[s] = true;
          }
          break;

        case 'hand_complete':
          for (const a of agents) {
            a.notify({
              type: 'hand_over',
              winners: ev.winners.map(w => ({ seat: w.seat, amount: w.amountWon })),
              board: [...state.board] as Card[],
            });
          }
          break;
      }
    }
  }

  for (let s = 0; s < numSeats; s++) {
    huds[s].hands++;
    if (seatVpip[s]) huds[s].vpip++;
    if (seatPfr[s]) huds[s].pfr++;
    if (seatSawFlop[s]) huds[s].sawFlop++;
    if (seatReachedShowdown[s]) huds[s].wtsd++;
  }
}

async function runProfile(
  styles: SystemBotStyle[],
  numHands: number,
  options: ProfileOptions,
  bigBlind: number = 20,
): Promise<Array<{ style: SystemBotStyle; hud: HUDStats; extra: ExtraStats }>> {
  const numSeats = styles.length;
  const smallBlind = bigBlind / 2;
  const seatStacks = resolveSeatStacks(styles, bigBlind, options.stackMode);
  const huds: HUDStats[] = styles.map(() => emptyHUD());
  const extras: ExtraStats[] = styles.map(() => emptyExtra());

  if (options.mode === 'persistent') {
    const state = seatLineup(styles, seatStacks, 'profile-persistent', smallBlind, bigBlind);
    const agents: BuiltinBotAgent[] = styles.map(s => createBotAgent(s));
    try {
      for (let handIdx = 0; handIdx < numHands; handIdx++) {
        if (options.autoRebuy) rebuyBustedPlayers(state, seatStacks);
        await playHand(state, agents, handIdx, seatStacks, smallBlind, bigBlind, huds, extras);
      }
    } finally {
      for (const agent of agents) agent.dispose();
    }
  } else {
    for (let handIdx = 0; handIdx < numHands; handIdx++) {
      const state = seatLineup(styles, seatStacks, `profile-${handIdx}`, smallBlind, bigBlind);
      if (handIdx > 0) {
        (state as unknown as { buttonSeat: number }).buttonSeat = (handIdx - 1) % numSeats;
      }
      const agents: BuiltinBotAgent[] = styles.map(s => createBotAgent(s));
      try {
        await playHand(state, agents, handIdx, seatStacks, smallBlind, bigBlind, huds, extras);
      } finally {
        for (const agent of agents) agent.dispose();
      }
    }
  }

  return styles.map((style, i) => ({ style, hud: huds[i], extra: extras[i] }));
}

function rate(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function af(raises: number, calls: number): number {
  return calls > 0 ? raises / calls : raises;
}

async function main() {
  const hands = Number.parseInt(process.env.PROFILE_HANDS ?? '300', 10);
  const tableFilter = process.env.PROFILE_TABLE ?? 'all';
  const customStyles = process.env.PROFILE_STYLES
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean) as SystemBotStyle[] | undefined;
  const customLabel = process.env.PROFILE_LABEL?.trim() || 'Custom';
  const mode = process.env.PROFILE_MODE === 'persistent' ? 'persistent' : 'reset';
  const autoRebuy = process.env.PROFILE_AUTO_REBUY !== '0';
  const stackMode = process.env.PROFILE_STACK_MODE === 'uniform' ? 'uniform' : 'system';
  const lineups: Array<{ name: string; styles: SystemBotStyle[] }> = [
    { name: 'Table-A', styles: ['nit', 'tag', 'lag', 'station', 'maniac', 'trapper'] },
    { name: 'Table-B', styles: ['bully', 'tilter', 'shortstack', 'adaptive', 'gto', 'tag'] },
  ];

  if (customStyles && customStyles.length > 0) {
    lineups.unshift({ name: customLabel, styles: customStyles });
  }

  const selected = tableFilter === 'all'
    ? lineups
    : lineups.filter(lineup => lineup.name === tableFilter);

  for (const lineup of selected) {
    const res = await runProfile(lineup.styles, hands, { mode, autoRebuy, stackMode });
    console.log(`\n=== ${lineup.name} (${hands} hands; mode=${mode}; stacks=${stackMode}; ${lineup.styles.join(', ')}) ===`);
    console.log('style       VPIP   PFR   AF    WTSD  PreFold  PostFold  FoldAll  AllinAll RaiseOnly');
    for (const p of res) {
      const vpip = rate(p.hud.vpip, p.hud.hands);
      const pfr = rate(p.hud.pfr, p.hud.hands);
      const wtsd = rate(p.hud.wtsd, p.hud.sawFlop);
      const preFold = rate(p.extra.preflopFoldFacingAction, p.extra.preflopRequests);
      const postFold = rate(p.extra.postflopFoldFacingBet, p.extra.postflopFacingBet);
      const foldAll = rate(p.extra.totalFolds, p.extra.actionRequests);
      const allinAll = rate(p.extra.totalAllins, p.extra.actionRequests);
      const raiseOnly = rate(p.extra.totalRaises, p.extra.actionRequests);

      console.log(
        `${p.style.padEnd(10)} ${(vpip * 100).toFixed(1).padStart(5)}% ${(pfr * 100).toFixed(1).padStart(5)}% `
        + `${af(p.hud.postflopRaises, p.hud.postflopCalls).toFixed(2).padStart(5)} ${(wtsd * 100).toFixed(1).padStart(6)}% `
        + `${(preFold * 100).toFixed(1).padStart(7)}% ${(postFold * 100).toFixed(1).padStart(8)}% `
        + `${(foldAll * 100).toFixed(1).padStart(7)}% ${(allinAll * 100).toFixed(1).padStart(8)}% `
        + `${(raiseOnly * 100).toFixed(1).padStart(9)}%`,
      );
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
