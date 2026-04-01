/**
 * PlayerAgent abstraction — table state machine only calls these methods,
 * never directly touches WebSocket or subprocess.
 *
 * HumanAgent: waits for a WebSocket message from the browser.
 * BotAgent:   spawns the bot executable, sends PBP JSON via stdin, reads stdout.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import type { PokerAction, PbpServerMessage, PbpBotMessage, BotDebugInfo, Card, ActionType } from '@/lib/types';
import { evaluateHand } from './hand-eval';
import { Hand } from 'pokersolver';
import { freshDeck } from './deck';
import { getSystemBotByBinaryPath, type SystemBotDefinition, type SystemBotStyle } from '@/lib/system-bots';

const BOT_ACTION_TIMEOUT_MS = parseInt(process.env.BOT_ACTION_TIMEOUT_MS ?? '5000', 10);
const HUMAN_ACTION_TIMEOUT_MS = parseInt(process.env.HUMAN_ACTION_TIMEOUT_MS ?? '30000', 10);

export interface ActionRequest {
  street: 'preflop' | 'flop' | 'turn' | 'river';
  board: Card[];
  pot: number;
  currentBet: number;
  toCall: number;
  minRaise: number;
  stack: number;
  history: Array<{ seat: number; action: ActionType; amount: number }>;
}

export interface PlayerAgent {
  readonly userId: string;
  readonly timeoutMs: number;
  /** Send a PBP event notification (no response needed) */
  notify(msg: PbpServerMessage): void;
  /** Request an action and wait for the response */
  requestAction(req: ActionRequest): Promise<PokerAction & { debug?: BotDebugInfo }>;
  /** Clean up resources (kill subprocess, close listeners) */
  dispose(): void;
}

// ─── HumanAgent ───────────────────────────────────────────────────────────────

type ActionResolver = (action: PokerAction) => void;

export class HumanAgent implements PlayerAgent {
  readonly timeoutMs = HUMAN_ACTION_TIMEOUT_MS;
  private _pendingResolver: ActionResolver | null = null;
  private _pendingReject: ((reason: Error) => void) | null = null;

  constructor(
    readonly userId: string,
    /** Called to push state/events to this user's WebSocket */
    private readonly sendWs: (msg: object) => void,
  ) {}

  notify(msg: PbpServerMessage): void {
    // HumanAgent doesn't use PBP; WsHub handles client-side notifications
    // This is a no-op; the table manager sends WS events directly
  }

  requestAction(req: ActionRequest): Promise<PokerAction & { debug?: BotDebugInfo }> {
    return new Promise((resolve, reject) => {
      this._pendingResolver = resolve;
      this._pendingReject = reject;

      // Send action_request to client
      this.sendWs({
        type: 'action_request',
        toCall: req.toCall,
        minRaise: req.minRaise,
        timeoutMs: this.timeoutMs,
      });

      // Auto-fold on timeout
      const timer = setTimeout(() => {
        if (this._pendingResolver) {
          this._pendingResolver = null;
          this._pendingReject = null;
          resolve({ action: 'fold' });
        }
      }, this.timeoutMs);

      // Store timer ref so we can cancel on dispose
      this._timeoutHandle = timer;
    });
  }

  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /** Called by WsHub when the browser sends a { type: 'action', ... } message */
  receiveAction(action: PokerAction): void {
    if (this._pendingResolver) {
      if (this._timeoutHandle) clearTimeout(this._timeoutHandle);
      const resolve = this._pendingResolver;
      this._pendingResolver = null;
      this._pendingReject = null;
      resolve(action);
    }
  }

  dispose(): void {
    if (this._timeoutHandle) clearTimeout(this._timeoutHandle);
    if (this._pendingReject) {
      this._pendingReject(new Error('Agent disposed'));
      this._pendingResolver = null;
      this._pendingReject = null;
    }
  }
}

// ─── BotAgent ─────────────────────────────────────────────────────────────────

export class BotAgent implements PlayerAgent {
  readonly timeoutMs = BOT_ACTION_TIMEOUT_MS;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private _pendingResolver: ((msg: PbpBotMessage) => void) | null = null;
  private _pendingReject: ((err: Error) => void) | null = null;
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly userId: string,
    private readonly binaryPath: string,
    private readonly botId: string,
  ) {}

  private ensureProcess(): void {
    if (this.proc) return;
    this.proc = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BOT_ID: this.botId },
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });

    this.rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as PbpBotMessage;
        if (this._pendingResolver) {
          if (this._timeoutHandle) {
            clearTimeout(this._timeoutHandle);
            this._timeoutHandle = null;
          }
          const resolve = this._pendingResolver;
          this._pendingResolver = null;
          this._pendingReject = null;
          resolve(msg);
        }
      } catch {
        // Ignore parse errors; pending promise will time out
      }
    });

    this.proc.on('exit', () => {
      if (this._pendingReject) {
        this._pendingReject(new Error('Bot process exited unexpectedly'));
        this._pendingResolver = null;
        this._pendingReject = null;
      }
      this.proc = null;
      this.rl = null;
    });

    this.proc.stderr.on('data', (_data: Buffer) => {
      // Silently ignore stderr — bots may log there
    });
  }

  private send(msg: PbpServerMessage): void {
    this.ensureProcess();
    if (this.proc?.stdin) {
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  notify(msg: PbpServerMessage): void {
    this.send(msg);
  }

  requestAction(req: ActionRequest): Promise<PokerAction & { debug?: BotDebugInfo }> {
    const pbpMsg: PbpServerMessage = {
      type: 'action_request',
      street: req.street,
      board: req.board,
      pot: req.pot,
      currentBet: req.currentBet,
      toCall: req.toCall,
      minRaise: req.minRaise,
      stack: req.stack,
      history: req.history,
    };

    this.send(pbpMsg);

    return new Promise((resolve, reject) => {
      this._pendingResolver = (msg: PbpBotMessage) => {
        resolve({
          action: msg.action,
          amount: msg.amount,
          debug: msg.debug,
        });
      };
      this._pendingReject = reject;

      this._timeoutHandle = setTimeout(() => {
        if (this._pendingResolver) {
          this._pendingResolver = null;
          this._pendingReject = null;
          this._timeoutHandle = null;
          resolve({ action: 'fold' }); // timeout → auto-fold
        }
      }, this.timeoutMs);
    });
  }

  dispose(): void {
    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
    if (this._pendingReject) {
      this._pendingReject(new Error('Agent disposed'));
      this._pendingResolver = null;
      this._pendingReject = null;
    }
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    this.rl?.close();
    this.rl = null;
  }
}

const RANK_VALUE: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

interface StyleParams {
  label: string;
  aggression: number;
  looseness: number;
  bluffRate: number;
  raiseBias: number;
  crowdSensitivity: number;
  slowplayRate: number;
  checkRaiseRate: number;
  positionSensitivity: number;
  sizingSensitivity: number;
  patternSensitivity: number;
  exploitWeight: number;
}

const STYLE_CONFIG: Record<SystemBotStyle, StyleParams> = {
  nit:        { label: '司马懿', aggression: 0.28, looseness: 0.18, bluffRate: 0.01, raiseBias: 0.08, crowdSensitivity: 1.0,  slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.5, sizingSensitivity: 0.8, patternSensitivity: 0.6, exploitWeight: 0.3 },
  tag:        { label: '赵云',   aggression: 0.52, looseness: 0.42, bluffRate: 0.04, raiseBias: 0.18, crowdSensitivity: 0.7,  slowplayRate: 0,    checkRaiseRate: 0.05, positionSensitivity: 0.9, sizingSensitivity: 0.7, patternSensitivity: 0.6, exploitWeight: 0.7 },
  lag:        { label: '孙悟空', aggression: 0.72, looseness: 0.65, bluffRate: 0.08, raiseBias: 0.28, crowdSensitivity: 0.4,  slowplayRate: 0,    checkRaiseRate: 0.08, positionSensitivity: 0.7, sizingSensitivity: 0.5, patternSensitivity: 0.4, exploitWeight: 0.7 },
  station:    { label: '猪八戒', aggression: 0.16, looseness: 0.72, bluffRate: 0,    raiseBias: 0.04, crowdSensitivity: 0.15, slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.1, sizingSensitivity: 0.1, patternSensitivity: 0.1, exploitWeight: 0.1 },
  maniac:     { label: '张飞',   aggression: 0.88, looseness: 0.82, bluffRate: 0.18, raiseBias: 0.45, crowdSensitivity: 0.2,  slowplayRate: 0,    checkRaiseRate: 0.10, positionSensitivity: 0.1, sizingSensitivity: 0.2, patternSensitivity: 0.1, exploitWeight: 0.3 },
  trapper:    { label: '王熙凤', aggression: 0.38, looseness: 0.45, bluffRate: 0.03, raiseBias: 0.12, crowdSensitivity: 0.6,  slowplayRate: 0.55, checkRaiseRate: 0.40, positionSensitivity: 0.6, sizingSensitivity: 0.5, patternSensitivity: 0.8, exploitWeight: 0.6 },
  bully:      { label: '鲁智深', aggression: 0.62, looseness: 0.55, bluffRate: 0.10, raiseBias: 0.30, crowdSensitivity: 0.5,  slowplayRate: 0,    checkRaiseRate: 0.06, positionSensitivity: 0.5, sizingSensitivity: 0.5, patternSensitivity: 0.4, exploitWeight: 0.5 },
  tilter:     { label: '林冲',   aggression: 0.48, looseness: 0.38, bluffRate: 0.03, raiseBias: 0.15, crowdSensitivity: 0.7,  slowplayRate: 0,    checkRaiseRate: 0.04, positionSensitivity: 0.7, sizingSensitivity: 0.5, patternSensitivity: 0.5, exploitWeight: 0.5 },
  shortstack: { label: '燕青',   aggression: 0.55, looseness: 0.40, bluffRate: 0.05, raiseBias: 0.20, crowdSensitivity: 0.6,  slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.4, sizingSensitivity: 0.5, patternSensitivity: 0.3, exploitWeight: 0.4 },
  adaptive:   { label: '曹操',   aggression: 0.50, looseness: 0.45, bluffRate: 0.06, raiseBias: 0.20, crowdSensitivity: 0.5,  slowplayRate: 0.05, checkRaiseRate: 0.08, positionSensitivity: 0.8, sizingSensitivity: 0.8, patternSensitivity: 1.0, exploitWeight: 1.0 },
  gto:        { label: '诸葛亮', aggression: 0.50, looseness: 0.42, bluffRate: 0.07, raiseBias: 0.22, crowdSensitivity: 0.5,  slowplayRate: 0.10, checkRaiseRate: 0.12, positionSensitivity: 0.9, sizingSensitivity: 0.9, patternSensitivity: 0.7, exploitWeight: 0.2 },
};

// ─── Opponent stats for adaptive bot ──────────────────────────────────────────

interface OpponentStats {
  hands: number;        // total hands observed
  vpip: number;         // voluntarily put money in pot (not blinds)
  pfr: number;          // preflop raise count
  aggActions: number;   // raise/bet count postflop
  passActions: number;  // check/call count postflop
  cbetOpportunities: number;
  cbets: number;
  foldToCbetCount: number;
  foldToCbetOpportunities: number;
  wtsdCount: number;
  wtsdOpportunities: number;
}

export interface OpponentProfile {
  hands: number;
  vpipRate: number;
  pfrRate: number;
  af: number;
  cbetRate: number;
  foldToCbetRate: number;
  wtsdRate: number;
}

export interface ExploitDeltas {
  aggressionDelta: number;
  bluffDelta: number;
  callThresholdDelta: number;
  slowplayDelta: number;
  checkRaiseDelta: number;
}

export function computeExploit(opp: OpponentProfile): ExploitDeltas {
  if (opp.hands < 8) {
    return { aggressionDelta: 0, bluffDelta: 0, callThresholdDelta: 0, slowplayDelta: 0, checkRaiseDelta: 0 };
  }

  let aggressionDelta = 0;
  let bluffDelta = 0;
  let callThresholdDelta = 0;
  let slowplayDelta = 0;
  let checkRaiseDelta = 0;

  // vs calling station (high VPIP, low AF): value bet thinner, don't bluff
  if (opp.vpipRate > 0.55 && opp.af < 0.8) {
    aggressionDelta += 0.12;
    bluffDelta -= 0.06;
  }

  // vs nit (low VPIP): steal more
  if (opp.vpipRate < 0.25) {
    bluffDelta += 0.08;
    aggressionDelta += 0.06;
  }

  // vs passive (low AF): bluff more
  if (opp.af < 0.8 && opp.vpipRate <= 0.55) {
    bluffDelta += 0.05;
  }

  // vs aggro (high AF): trap more
  if (opp.af > 2.5) {
    slowplayDelta += 0.12;
    checkRaiseDelta += 0.10;
  }

  // vs high fold-to-cbet: c-bet relentlessly
  if (opp.foldToCbetRate > 0.6) {
    aggressionDelta += 0.08;
    bluffDelta += 0.04;
  }

  // vs low fold-to-cbet: only value bet
  if (opp.foldToCbetRate < 0.3 && opp.foldToCbetRate > 0) {
    bluffDelta -= 0.04;
  }

  // vs high WTSD: value bet thinner, don't bluff
  if (opp.wtsdRate > 0.35) {
    aggressionDelta += 0.06;
    bluffDelta -= 0.04;
  }

  return { aggressionDelta, bluffDelta, callThresholdDelta, slowplayDelta, checkRaiseDelta };
}

// ─── Position awareness ──────────────────────────────────────────────────────

export type Position = 'EP' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export function calcPosition(mySeat: number, buttonSeat: number, seatList: number[]): Position {
  const n = seatList.length;
  if (n <= 1) return 'BTN';

  // Sort seats in clockwise order starting from the seat after the button
  const sorted = [...seatList].sort((a, b) => a - b);
  const btnIdx = sorted.indexOf(buttonSeat);
  // Rotate so position 0 = button
  const rotated: number[] = [];
  for (let i = 0; i < n; i++) {
    rotated.push(sorted[(btnIdx + i) % n]);
  }

  const myIdx = rotated.indexOf(mySeat);

  // Heads-up special case: BTN is SB
  if (n === 2) return myIdx === 0 ? 'SB' : 'BB';

  if (myIdx === 0) return 'BTN';
  if (myIdx === 1) return 'SB';
  if (myIdx === 2) return 'BB';
  if (myIdx === n - 1) return 'CO';

  // Remaining seats: split into EP and MP
  const middleCount = n - 4;
  if (middleCount <= 0) return 'MP';
  const epCount = Math.ceil(middleCount / 2);
  const posInMiddle = myIdx - 3;
  return posInMiddle < epCount ? 'EP' : 'MP';
}

export function getPositionFactor(position: Position): number {
  switch (position) {
    case 'BTN': return 0.08;
    case 'CO':  return 0.06;
    case 'MP':  return 0;
    case 'EP':  return -0.06;
    case 'SB':  return -0.06;
    case 'BB':  return -0.02;
  }
}

export class BuiltinBotAgent implements PlayerAgent {
  readonly timeoutMs = BOT_ACTION_TIMEOUT_MS;
  private holeCards: [Card, Card] | null = null;
  private players: Array<{ seat: number; displayName: string; stack: number }> = [];
  private mySeat = -1;
  private bigBlind = 20;

  // ─── Position tracking ────────────────────────────────────────────────────
  private myPosition: Position = 'MP';

  // ─── Tilter state (林冲) ──────────────────────────────────────────────────
  private recentResults: number[] = [];  // last N hand results: +chips or -chips
  private tiltLevel = 0;                 // 0 = calm, up to 1.0 = full tilt

  // ─── Adaptive state (曹操) ────────────────────────────────────────────────
  private opponentStats = new Map<number, OpponentStats>();
  private currentStreet: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop';
  private preflopActors = new Set<number>();  // seats that acted preflop (non-blind)

  // ─── Multi-street memory ─────────────────────────────────────────────────
  private handActions: HandActionRecord = { preflop: [], flop: [], turn: [], river: [] };

  constructor(
    readonly userId: string,
    private readonly definition: SystemBotDefinition,
  ) {}

  notify(msg: PbpServerMessage): void {
    switch (msg.type) {
      case 'new_hand':
        this.players = msg.players;
        this.holeCards = null;
        this.mySeat = msg.seat;
        this.bigBlind = msg.bigBlind ?? 20;
        this.currentStreet = 'preflop';
        this.preflopActors.clear();
        this.handActions = { preflop: [], flop: [], turn: [], river: [] };
        this.myPosition = calcPosition(
          msg.seat,
          msg.buttonSeat,
          msg.players.map(p => p.seat),
        );
        // Ensure stats exist for all opponents
        for (const p of msg.players) {
          if (p.seat !== this.mySeat && !this.opponentStats.has(p.seat)) {
            this.opponentStats.set(p.seat, { hands: 0, vpip: 0, pfr: 0, aggActions: 0, passActions: 0, cbetOpportunities: 0, cbets: 0, foldToCbetCount: 0, foldToCbetOpportunities: 0, wtsdCount: 0, wtsdOpportunities: 0 });
          }
        }
        // Increment hand count for all opponents
        for (const p of msg.players) {
          if (p.seat !== this.mySeat) {
            const s = this.opponentStats.get(p.seat);
            if (s) s.hands++;
          }
        }
        break;
      case 'hole_cards':
        this.holeCards = msg.cards;
        break;
      case 'street':
        this.currentStreet = msg.name as 'preflop' | 'flop' | 'turn' | 'river';
        break;
      case 'player_action': {
        // Track all actions for multi-street pattern detection
        this.handActions[this.currentStreet].push({ seat: msg.seat, action: msg.action, amount: msg.amount });
        if (msg.seat === this.mySeat) break;
        const s = this.opponentStats.get(msg.seat);
        if (!s) break;
        if (this.currentStreet === 'preflop') {
          if (msg.action === 'call' || msg.action === 'raise' || msg.action === 'allin') {
            if (!this.preflopActors.has(msg.seat)) s.vpip++;
            this.preflopActors.add(msg.seat);
          }
          if (msg.action === 'raise' || msg.action === 'allin') s.pfr++;
        } else {
          if (msg.action === 'raise' || msg.action === 'allin') s.aggActions++;
          else if (msg.action === 'call' || msg.action === 'check') s.passActions++;
        }
        break;
      }
      case 'hand_over': {
        this.holeCards = null;
        // Track results for tilter
        const myWin = msg.winners.find((w: { seat: number }) => w.seat === this.mySeat);
        if (myWin) {
          this.recentResults.push(myWin.amount);
        } else {
          this.recentResults.push(-1); // lost (exact amount doesn't matter, just direction)
        }
        if (this.recentResults.length > 8) this.recentResults.shift();
        // Calculate tilt: count recent losses
        const recentLosses = this.recentResults.slice(-5).filter(r => r < 0).length;
        this.tiltLevel = clamp01(recentLosses / 5 * 1.2); // 3/5 losses = 0.72 tilt, 5/5 = 1.0
        break;
      }
      case 'action_request':
        break;
    }
  }

  requestAction(req: ActionRequest): Promise<PokerAction & { debug?: BotDebugInfo }> {
    if (!this.holeCards) {
      return Promise.resolve({
        action: req.toCall > 0 ? 'fold' : 'check',
        debug: { reasoning: `${this.definition.name}: 无手牌信息，安全弃牌.` },
      });
    }

    const style = this.definition.style;
    let cfg = { ...STYLE_CONFIG[style] };
    let extraReasoning = '';

    // ─── Bully (鲁智深): boost aggression vs short stacks ────────────────
    if (style === 'bully') {
      const avgOppStack = this.players
        .filter(p => p.seat !== this.mySeat)
        .reduce((s, p) => s + p.stack, 0) / Math.max(1, this.players.length - 1);
      const stackRatio = req.stack / Math.max(avgOppStack, 1);
      if (stackRatio > 1.5) {
        const boost = Math.min((stackRatio - 1) * 0.2, 0.3);
        cfg.aggression = clamp01(cfg.aggression + boost);
        cfg.looseness = clamp01(cfg.looseness + boost * 0.6);
        cfg.bluffRate = clamp01(cfg.bluffRate + boost * 0.3);
        extraReasoning = ` 筹码碾压(${stackRatio.toFixed(1)}x), 加压.`;
      }
    }

    // ─── Tilter (林冲): tilt boosts aggression ───────────────────────────
    if (style === 'tilter' && this.tiltLevel > 0.2) {
      const t = this.tiltLevel;
      cfg.aggression = clamp01(cfg.aggression + t * 0.40);
      cfg.looseness = clamp01(cfg.looseness + t * 0.30);
      cfg.bluffRate = clamp01(cfg.bluffRate + t * 0.15);
      cfg.raiseBias = clamp01(cfg.raiseBias + t * 0.25);
      extraReasoning = ` 怒气值${Math.round(t * 100)}%, ${t > 0.6 ? '风雪山神庙!' : '渐失冷静.'}`;
    }

    // ─── Shortstack (燕青): push/fold when ≤15BB ─────────────────────────
    if (style === 'shortstack') {
      const bbCount = req.stack / this.bigBlind;
      if (bbCount <= 15 && req.street === 'preflop') {
        const action = choosePushFold(this.holeCards, bbCount, req, this.players.length);
        return Promise.resolve({
          ...action,
          debug: {
            equity: preflopStrength(this.holeCards),
            reasoning: `${this.definition.name}: ${bbCount.toFixed(0)}BB 短码模式, ${action.action === 'allin' ? '全下!' : '弃牌等待.'}`,
          },
        });
      }
    }

    // ─── Universal opponent modeling (all styles, scaled by exploitWeight) ─
    const oppProfile = this.getAverageOpponentProfile();
    if (oppProfile.hands >= 8) {
      const exploit = computeExploit(oppProfile);
      cfg.aggression = clamp01(cfg.aggression + exploit.aggressionDelta * cfg.exploitWeight);
      cfg.bluffRate = clamp01(cfg.bluffRate + exploit.bluffDelta * cfg.exploitWeight);
      cfg.slowplayRate = clamp01(cfg.slowplayRate + exploit.slowplayDelta * cfg.exploitWeight);
      cfg.checkRaiseRate = clamp01(cfg.checkRaiseRate + exploit.checkRaiseDelta * cfg.exploitWeight);
      if (!extraReasoning) {
        extraReasoning = ` 对手画像(VPIP ${Math.round(oppProfile.vpipRate * 100)}% AF ${oppProfile.af.toFixed(1)}).`;
      }
    }

    // ─── GTO (诸葛亮): use mixed strategy frequencies ────────────────────
    if (style === 'gto') {
      const action = chooseGtoAction(this.holeCards, req, this.players.length);
      return Promise.resolve({
        ...action.result,
        debug: {
          equity: action.strength,
          potOdds: action.potOdds,
          foldFreq: action.foldFreq,
          callFreq: action.callFreq,
          raiseFreq: action.raiseFreq,
          reasoning: `${this.definition.name}: 均衡策略 [F${Math.round(action.foldFreq * 100)}% C${Math.round(action.callFreq * 100)}% R${Math.round(action.raiseFreq * 100)}%]. ${describeHolding(req.street, this.holeCards, req.board)}.`,
        },
      });
    }

    // ─── Standard path (all other styles use the generic engine) ─────────
    const opponents = Math.max(1, this.players.length - 1);
    const strength = req.street === 'preflop'
      ? preflopStrength(this.holeCards)
      : postflopStrengthMC(this.holeCards, req.board, opponents);
    const crowdPenalty = Math.max(0, opponents - 2) * 0.04 * cfg.crowdSensitivity;
    const posFactor = getPositionFactor(this.myPosition) * cfg.positionSensitivity;
    const isLatePosition = this.myPosition === 'BTN' || this.myPosition === 'CO';
    cfg.bluffRate = clamp01(cfg.bluffRate + (isLatePosition ? 0.03 : -0.02) * cfg.positionSensitivity);
    let adjustedStrength = clamp01(strength - crowdPenalty + cfg.looseness * 0.25 + posFactor);

    // Multi-street pattern adjustment (lower effective strength when danger patterns detected)
    if (req.toCall > 0) {
      const lastAggressor = req.history.filter(h => h.action === 'raise' || h.action === 'allin').pop();
      if (lastAggressor && lastAggressor.seat !== this.mySeat) {
        const patterns = detectPatterns(lastAggressor.seat, this.handActions, req.street);
        let patternPenalty = 0;
        if (patterns.checkThenBet) patternPenalty += 0.05;
        if (patterns.betBetBet) patternPenalty += 0.06;
        if (patterns.checkCheckBet) patternPenalty += 0.08;
        if (patterns.timesRaised >= 2) patternPenalty += 0.10;
        adjustedStrength = clamp01(adjustedStrength - patternPenalty * cfg.patternSensitivity);
      }
    }

    const potOdds = req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0;
    const action = chooseBuiltinAction(style, adjustedStrength, potOdds, req, cfg);

    return Promise.resolve({
      ...action,
      debug: {
        equity: adjustedStrength,
        potOdds,
        foldFreq: clamp01(1 - adjustedStrength - cfg.looseness * 0.35),
        callFreq: clamp01(cfg.looseness * 0.55 + (req.toCall > 0 ? 0.15 : 0.05)),
        raiseFreq: clamp01(cfg.raiseBias + adjustedStrength * cfg.aggression),
        reasoning: `${this.definition.name}: ${describeHolding(req.street, this.holeCards, req.board)}.${extraReasoning}`,
      },
    });
  }

  /** Compute average opponent VPIP rate and aggression factor. */
  private getAverageOpponentProfile(): OpponentProfile {
    let totalHands = 0, totalVpip = 0, totalPfr = 0, totalAgg = 0, totalPass = 0;
    let totalCbetOpp = 0, totalCbets = 0, totalFoldCbetOpp = 0, totalFoldCbet = 0;
    let totalWtsdOpp = 0, totalWtsd = 0;
    for (const [seat, s] of this.opponentStats) {
      if (seat === this.mySeat || s.hands < 3) continue;
      totalHands += s.hands;
      totalVpip += s.vpip;
      totalPfr += s.pfr;
      totalAgg += s.aggActions;
      totalPass += s.passActions;
      totalCbetOpp += s.cbetOpportunities;
      totalCbets += s.cbets;
      totalFoldCbetOpp += s.foldToCbetOpportunities;
      totalFoldCbet += s.foldToCbetCount;
      totalWtsdOpp += s.wtsdOpportunities;
      totalWtsd += s.wtsdCount;
    }
    if (totalHands === 0) {
      return { hands: 0, vpipRate: 0.4, pfrRate: 0.2, af: 1.5, cbetRate: 0.5, foldToCbetRate: 0.4, wtsdRate: 0.3 };
    }
    return {
      hands: totalHands,
      vpipRate: totalVpip / totalHands,
      pfrRate: totalPfr / totalHands,
      af: totalPass > 0 ? totalAgg / totalPass : totalAgg > 0 ? 3 : 1,
      cbetRate: totalCbetOpp > 0 ? totalCbets / totalCbetOpp : 0.5,
      foldToCbetRate: totalFoldCbetOpp > 0 ? totalFoldCbet / totalFoldCbetOpp : 0.4,
      wtsdRate: totalWtsdOpp > 0 ? totalWtsd / totalWtsdOpp : 0.3,
    };
  }

  dispose(): void {}
}

// ─── Multi-street memory & pattern detection ────────────────────────────────

export type HandActionRecord = Record<
  'preflop' | 'flop' | 'turn' | 'river',
  Array<{ seat: number; action: ActionType; amount: number }>
>;

export interface OpponentHandPattern {
  checkThenBet: boolean;
  betBetBet: boolean;
  checkCheckBet: boolean;
  timesRaised: number;
}

const STREET_ORDER: Array<'preflop' | 'flop' | 'turn' | 'river'> = ['preflop', 'flop', 'turn', 'river'];
const AGG_ACTIONS = new Set<ActionType>(['raise', 'allin']);

export function detectPatterns(
  seat: number,
  actions: HandActionRecord,
  currentStreet: 'preflop' | 'flop' | 'turn' | 'river',
): OpponentHandPattern {
  const streetIdx = STREET_ORDER.indexOf(currentStreet);

  function streetSummary(street: 'preflop' | 'flop' | 'turn' | 'river'): 'agg' | 'passive' | 'call' | 'none' {
    const seatActions = actions[street].filter(a => a.seat === seat);
    if (seatActions.length === 0) return 'none';
    if (seatActions.some(a => AGG_ACTIONS.has(a.action))) return 'agg';
    if (seatActions.some(a => a.action === 'check')) return 'passive';
    return 'call';
  }

  const summaries = STREET_ORDER.slice(0, streetIdx + 1).map(s => streetSummary(s));

  const checkThenBet = summaries.length >= 2
    && summaries[summaries.length - 2] === 'passive'
    && summaries[summaries.length - 1] === 'agg';

  const aggStreaks = summaries.filter(s => s === 'agg').length;
  const betBetBet = aggStreaks >= 2 && summaries[summaries.length - 1] === 'agg';

  let checkCheckBet = false;
  if (summaries.length >= 3 && summaries[summaries.length - 1] === 'agg') {
    const prevPassive = summaries.slice(0, -1).filter(s => s === 'passive').length;
    checkCheckBet = prevPassive >= 2;
  }

  let timesRaised = 0;
  for (const street of STREET_ORDER.slice(0, streetIdx + 1)) {
    timesRaised += actions[street].filter(a => a.seat === seat && AGG_ACTIONS.has(a.action)).length;
  }

  return { checkThenBet, betBetBet, checkCheckBet, timesRaised };
}

/** Returns a callThreshold multiplier based on bet-to-pot ratio. */
export function getBetSizingMultiplier(betSizeRatio: number): number {
  if (betSizeRatio <= 0) return 1.0;
  if (betSizeRatio < 0.4) return 0.85;
  if (betSizeRatio <= 0.8) return 1.0;
  if (betSizeRatio <= 1.3) return 1.10;
  return 1.20;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function chooseBuiltinAction(
  style: SystemBotStyle,
  strength: number,
  potOdds: number,
  req: ActionRequest,
  cfg?: StyleParams,
): PokerAction {
  if (!cfg) cfg = STYLE_CONFIG[style];
  const callPressure = req.toCall / Math.max(req.stack + req.toCall, 1);

  // Call threshold: potOdds sets a floor, but looseness actively lowers it.
  // Nit (0.18): base ~0.36, potOdds barely discounted → tight
  // Station (0.72): base ~0.20, potOdds discounted 36% → calls almost anything
  const baseThreshold = 0.40 - cfg.looseness * 0.28 + callPressure * 0.12;
  const oddsThreshold = potOdds * (1 - cfg.looseness * 0.5);
  const callThreshold = Math.max(baseThreshold, oddsThreshold);

  // Raise threshold: aggressive styles raise thinner
  // Nit: 0.65  TAG: 0.55  LAG: 0.44  Station: 0.66
  const raiseThreshold = 0.70 - cfg.aggression * 0.36 + potOdds * 0.04;

  // Bet sizing adjustment
  const betSizeRatio = req.toCall / Math.max(req.pot, 1);
  const sizingMult = getBetSizingMultiplier(betSizeRatio);
  const sizedCallThreshold = callThreshold * lerp(1.0, sizingMult, cfg.sizingSensitivity);
  const sizedRaiseThreshold = raiseThreshold * lerp(1.0, sizingMult, cfg.sizingSensitivity);

  const minRaiseTotal = req.currentBet + req.minRaise;
  const maxRaiseTotal = req.currentBet + req.stack - req.toCall;
  const canRaise = req.stack > req.toCall && minRaiseTotal <= maxRaiseTotal;

  // No bet to face: check or bet
  if (req.toCall === 0) {
    // Trapper slowplay: with strong hands, check to induce a bet (then check-raise later)
    if (strength > 0.75 && roll(cfg.slowplayRate)) {
      return { action: 'check' };
    }
    if (canRaise && (strength > sizedRaiseThreshold || (strength > 0.32 && roll(cfg.bluffRate)))) {
      return chooseRaiseAction(req, strength, cfg);
    }
    return { action: 'check' };
  }

  // Facing a bet: fold / call / raise
  // Check-raise opportunity: if we checked and now face a bet with a strong hand
  if (canRaise && strength > 0.65 && roll(cfg.checkRaiseRate)) {
    return chooseRaiseAction(req, strength, cfg);
  }

  if (strength < sizedCallThreshold) {
    // Below calling threshold — sometimes bluff-raise with decent hands
    if (canRaise && strength > 0.45 && roll(cfg.bluffRate)) {
      return chooseRaiseAction(req, strength, cfg);
    }
    return { action: 'fold' };
  }

  // Above calling threshold — consider raising
  if (canRaise && (strength > sizedRaiseThreshold || (strength > 0.42 && roll(cfg.raiseBias)))) {
    return chooseRaiseAction(req, strength, cfg);
  }

  // All-in call when pot-committed
  if (req.toCall >= req.stack && strength > Math.max(0.48, potOdds + 0.08)) {
    return { action: 'allin' };
  }

  return { action: 'call' };
}

function chooseRaiseAction(
  req: ActionRequest,
  strength: number,
  cfg: StyleParams,
): PokerAction {
  if (req.stack <= req.toCall) return { action: 'allin' };

  const minRaiseTotal = req.currentBet + req.minRaise;
  const maxRaiseTotal = req.currentBet + req.stack - req.toCall;
  if (maxRaiseTotal <= minRaiseTotal) return { action: 'allin' };

  if (strength > 0.92 && maxRaiseTotal <= minRaiseTotal + req.minRaise * 2) {
    return { action: 'allin' };
  }

  const potComponent = Math.round(req.pot * (0.35 + cfg.aggression * 0.65));
  const pressureComponent = Math.round(req.toCall + req.minRaise + strength * req.pot * 0.35);
  const raiseTotal = clampInt(
    Math.max(minRaiseTotal, req.currentBet + Math.max(potComponent, pressureComponent)),
    minRaiseTotal,
    maxRaiseTotal,
  );

  return raiseTotal >= maxRaiseTotal ? { action: 'allin' } : { action: 'raise', amount: raiseTotal };
}

// ─── Shortstack push/fold (燕青) ──────────────────────────────────────────────

function choosePushFold(
  holeCards: [Card, Card],
  bbCount: number,
  req: ActionRequest,
  playerCount: number,
): PokerAction {
  const strength = preflopStrength(holeCards);
  // Push threshold depends on stack depth and number of players
  // Shorter stack = looser push range; more players = tighter
  const positionFactor = Math.max(0, (6 - playerCount)) * 0.03;
  const depthFactor = clamp01((20 - bbCount) / 20) * 0.15; // tighter at 15BB, looser at 5BB
  const threshold = 0.48 - depthFactor - positionFactor;

  if (req.toCall > 0) {
    // Facing a raise: need stronger hand to call all-in
    const callThreshold = threshold + 0.08;
    if (strength >= callThreshold) return { action: 'allin' };
    return { action: 'fold' };
  }

  // Open action: push or fold
  if (strength >= threshold) return { action: 'allin' };
  return req.toCall === 0 ? { action: 'check' } : { action: 'fold' };
}

// ─── GTO mixed strategy (诸葛亮) ─────────────────────────────────────────────

function chooseGtoAction(
  holeCards: [Card, Card],
  req: ActionRequest,
  playerCount: number,
): { result: PokerAction; strength: number; potOdds: number; foldFreq: number; callFreq: number; raiseFreq: number } {
  const strength = req.street === 'preflop'
    ? preflopStrength(holeCards)
    : postflopStrength(holeCards, req.board);
  const potOdds = req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0;

  // MDF (Minimum Defense Frequency) = 1 - bet/(bet+pot)
  // This is how often we must continue to prevent opponent from profiting with any two cards
  const mdf = req.toCall > 0 ? 1 - req.toCall / Math.max(req.pot + req.toCall, 1) : 1;

  let foldFreq: number, callFreq: number, raiseFreq: number;

  if (req.toCall === 0) {
    // No bet to face: choose between check and bet
    // Bet with strong hands (value) and some weak hands (bluff) at ~2:1 ratio
    const valueBetThreshold = 0.65;
    const bluffThreshold = 0.25;  // bottom of range for bluffs
    const betFreq = strength > valueBetThreshold ? 0.80
      : (strength < bluffThreshold && strength > 0.10) ? 0.25
      : 0.05;
    raiseFreq = betFreq;
    callFreq = 0;  // can't call when no bet
    foldFreq = 0;  // can always check
  } else {
    // Facing a bet: use MDF as the floor for continue frequency
    // Strong hands raise, medium hands call, weak hands fold
    // But defend at least MDF of the time
    const rawRaise = strength > 0.78 ? 0.65 : strength > 0.65 ? 0.25 : 0.05;
    const rawCall = strength > potOdds + 0.05 ? 0.60 : strength > potOdds ? 0.35 : 0.10;
    const rawFold = 1 - rawRaise - rawCall;

    // Ensure we defend at least MDF
    const continueRate = rawRaise + rawCall;
    if (continueRate < mdf && strength > 0.15) {
      // Need to defend more — add calls
      const deficit = mdf - continueRate;
      callFreq = rawCall + deficit;
      raiseFreq = rawRaise;
      foldFreq = Math.max(0, 1 - raiseFreq - callFreq);
    } else {
      raiseFreq = rawRaise;
      callFreq = rawCall;
      foldFreq = Math.max(0, rawFold);
    }
  }

  // Normalize
  const total = foldFreq + callFreq + raiseFreq;
  if (total > 0) {
    foldFreq /= total;
    callFreq /= total;
    raiseFreq /= total;
  }

  // Roll the dice to pick an action based on frequencies
  const roll_ = Math.random();
  let result: PokerAction;

  const minRaiseTotal = req.currentBet + req.minRaise;
  const maxRaiseTotal = req.currentBet + req.stack - req.toCall;
  const canRaise = req.stack > req.toCall && minRaiseTotal <= maxRaiseTotal;

  if (roll_ < foldFreq && req.toCall > 0) {
    result = { action: 'fold' };
  } else if (roll_ < foldFreq + callFreq || !canRaise) {
    if (req.toCall === 0) {
      result = { action: 'check' };
    } else if (req.toCall >= req.stack) {
      // Pot-committed: call all-in if strength justifies
      result = strength > potOdds ? { action: 'allin' } : { action: 'fold' };
    } else {
      result = { action: 'call' };
    }
  } else {
    // Raise — size between 50% and 80% pot
    const sizeFactor = 0.5 + strength * 0.3;
    const raiseAmount = Math.round(req.pot * sizeFactor);
    const raiseTotal = clampInt(req.currentBet + Math.max(raiseAmount, req.minRaise), minRaiseTotal, maxRaiseTotal);
    result = raiseTotal >= maxRaiseTotal ? { action: 'allin' } : { action: 'raise', amount: raiseTotal };
  }

  return { result, strength, potOdds, foldFreq, callFreq, raiseFreq };
}

function preflopStrength([a, b]: [Card, Card]): number {
  const av = RANK_VALUE[a[0]];
  const bv = RANK_VALUE[b[0]];
  const suited = a[1] === b[1];
  const high = Math.max(av, bv);
  const low = Math.min(av, bv);
  const gap = high - low;

  let score = ((high + low) / 28) * 0.32;

  if (av === bv) {
    score += 0.38 + high / 28;
  } else {
    if (suited) score += 0.06;
    if (gap === 1) score += 0.07;
    else if (gap === 2) score += 0.04;
    else if (gap === 3) score += 0.02;
    if (high >= 13) score += 0.08;
    if (high >= 11 && low >= 10) score += 0.08;
    if (high === 14 && low >= 10) score += 0.08;
    if (high <= 8 && suited && gap <= 2) score += 0.03;
  }

  return clamp01(score);
}

function postflopStrength(holeCards: [Card, Card], board: Card[]): number {
  const result = evaluateHand(holeCards, board);
  let score = madeHandStrength(result.name);

  if (result.name.includes('Pair')) {
    score += pairQualityBonus(holeCards, board);
  }

  score += flushDrawBonus(holeCards, board);
  score += straightDrawBonus(holeCards, board);
  return clamp01(score);
}

/**
 * Monte Carlo postflop equity estimation.
 * Simulates against `opponents` random hands, completing the board randomly.
 * Includes draw bonus smoothing for flush/straight draws.
 */
export function postflopStrengthMC(
  holeCards: [Card, Card],
  board: Card[],
  opponents: number,
): number {
  const iterations = Math.max(500, Math.round(1500 / Math.max(opponents, 1)));
  const usedCards = new Set<Card>([...holeCards, ...board]);
  const remaining = freshDeck().filter(c => !usedCards.has(c));

  let wins = 0;
  let ties = 0;

  for (let i = 0; i < iterations; i++) {
    // Fisher-Yates partial shuffle
    const deck = [...remaining];
    const needed = opponents * 2 + (5 - board.length);
    for (let j = 0; j < needed && j < deck.length; j++) {
      const idx = j + Math.floor(Math.random() * (deck.length - j));
      [deck[j], deck[idx]] = [deck[idx], deck[j]];
    }

    // Deal opponent hands
    let di = 0;
    const oppHands: Array<[Card, Card]> = [];
    for (let o = 0; o < opponents; o++) {
      oppHands.push([deck[di++], deck[di++]]);
    }

    // Complete the board
    const simBoard = [...board];
    while (simBoard.length < 5) {
      simBoard.push(deck[di++]);
    }

    // Evaluate hands
    const myHand = Hand.solve([...holeCards, ...simBoard]);
    const oppSolved = oppHands.map(h => Hand.solve([...h, ...simBoard]));

    // Check if we win against all opponents
    let iWin = true;
    let isTie = false;
    for (const oh of oppSolved) {
      const winners = Hand.winners([myHand, oh]);
      if (winners.length === 2) {
        isTie = true;
      } else if (winners[0] !== myHand) {
        iWin = false;
        break;
      }
    }
    if (iWin && !isTie) wins++;
    else if (iWin && isTie) ties++;
  }

  const equity = (wins + ties * 0.5) / iterations;

  // Draw bonus smoothing (MC with limited iterations has noise on draws)
  const drawBonus = flushDrawBonus(holeCards, board) * 0.5
                  + straightDrawBonus(holeCards, board) * 0.5;

  return clamp01(equity + drawBonus);
}

function madeHandStrength(name: string): number {
  if (name.includes('Royal Flush') || name.includes('Straight Flush')) return 0.99;
  if (name.includes('Four of a Kind')) return 0.97;
  if (name.includes('Full House')) return 0.94;
  if (name.includes('Flush')) return 0.89;
  if (name.includes('Straight')) return 0.84;
  if (name.includes('Three of a Kind')) return 0.74;
  if (name.includes('Two Pair')) return 0.65;
  if (name.includes('Pair')) return 0.48;
  return 0.22;
}

function pairQualityBonus(holeCards: [Card, Card], board: Card[]): number {
  const hole = holeCards.map(card => RANK_VALUE[card[0]]).sort((a, b) => b - a);
  const boardRanks = board.map(card => RANK_VALUE[card[0]]).sort((a, b) => b - a);
  const topBoard = boardRanks[0] ?? 0;

  if (hole[0] === hole[1] && hole[0] > topBoard) return 0.16;
  if (hole.includes(topBoard)) return 0.1;
  if (hole.some(rank => boardRanks.slice(1, 3).includes(rank))) return 0.05;
  return 0;
}

function flushDrawBonus(holeCards: [Card, Card], board: Card[]): number {
  const suitCounts = new Map<string, number>();
  for (const card of [...holeCards, ...board]) {
    suitCounts.set(card[1], (suitCounts.get(card[1]) ?? 0) + 1);
  }
  const maxSuit = Math.max(...suitCounts.values(), 0);
  if (maxSuit >= 5) return 0; // Already a made flush — strength handled by hand evaluator
  if (maxSuit === 4) return 0.08;
  if (maxSuit === 3 && board.length === 3) return 0.03;
  return 0;
}

function straightDrawBonus(holeCards: [Card, Card], board: Card[]): number {
  const ranks = [...new Set([...holeCards, ...board].map(card => RANK_VALUE[card[0]]))];
  if (ranks.includes(14)) ranks.push(1);
  ranks.sort((a, b) => a - b);

  let best = 0;
  for (let start = 1; start <= 10; start++) {
    const window = new Set([start, start + 1, start + 2, start + 3, start + 4]);
    const hits = ranks.filter(rank => window.has(rank)).length;
    best = Math.max(best, hits);
  }

  if (best >= 5) return 0;
  if (best === 4) return 0.07;
  if (best === 3 && board.length === 3) return 0.02;
  return 0;
}

function describeHolding(street: ActionRequest['street'], holeCards: [Card, Card], board: Card[]): string {
  if (street === 'preflop') {
    const [a, b] = holeCards;
    return `preflop with ${a}${b} (${suitedLabel(holeCards)})`;
  }
  return `postflop ${evaluateHand(holeCards, board).name.toLowerCase()}`;
}

function suitedLabel([a, b]: [Card, Card]): string {
  return a[1] === b[1] ? 'suited' : 'offsuit';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function roll(probability: number): boolean {
  return Math.random() < probability;
}

export function createBotAgent(
  userId: string,
  binaryPath: string,
  botId: string,
): PlayerAgent {
  const builtin = getSystemBotByBinaryPath(binaryPath);
  if (builtin) return new BuiltinBotAgent(userId, builtin);
  return new BotAgent(userId, binaryPath, botId);
}

export const STYLE_CONFIG_FOR_TEST = STYLE_CONFIG;
