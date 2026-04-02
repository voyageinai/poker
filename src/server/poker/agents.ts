

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
// ─── New strategy modules (v2 upgrade) ─────────────────────────────────────
import { analyzeBoard, type BoardTexture } from './strategy/board-texture';
import { preflopHandStrength as preflopHandStrengthV2, getPreflopAction } from './strategy/preflop-ranges';
import { adjustForStackDepth } from './strategy/stack-depth';
import { postflopStrengthMC as postflopStrengthMCV2 } from './strategy/equity';
import { chooseBalancedAction, type BalancedActionRequest } from './strategy/balanced-strategy';
import { OpponentTracker } from './strategy/opponent-model';
import { chooseBetSize, type LegalConstraints } from './strategy/bet-sizing';
import { solverDecision } from './solver/solver-integration';
import { matchPlaybook, type PlaybookContext, type Position as PlaybookPosition } from './strategy/playbook';
import { checkUnconditionalBluff } from './strategy/unconditional-bluff';

const BOT_ACTION_TIMEOUT_MS = parseInt(process.env.BOT_ACTION_TIMEOUT_MS ?? '5000', 10);
const HUMAN_ACTION_TIMEOUT_MS = parseInt(process.env.HUMAN_ACTION_TIMEOUT_MS ?? '30000', 10);
const ENABLE_BUILTIN_BOT_TIMING =
  process.env.BOT_PERSONALITY_TIMING === '1'
  || (process.env.BOT_PERSONALITY_TIMING !== '0' && process.env.NODE_ENV !== 'test');

export interface ActionRequest {
  street: 'preflop' | 'flop' | 'turn' | 'river';
  board: Card[];
  pot: number;
  currentBet: number;
  toCall: number;
  minRaise: number;
  stack: number;
  /** Stack at the start of this hand (before any bets). Falls back to stack if not provided. */
  initialStack?: number;
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
  preflopCommitCap: number;
}

interface AdaptivePersonalityPlan {
  mimicStyle: SystemBotStyle;
  reason: string;
}

interface HeuristicLineContext {
  checkedThisStreet: boolean;
  dryBoard: boolean;
  wetBoard: boolean;
  latePosition: boolean;
}

type RaiseIntent = 'value' | 'bluff' | 'pressure';

interface TimingProfile {
  minMs: number;
  maxMs: number;
  facingBetBonus: number;
  riverBonus: number;
  foldMult: number;
  allinMult: number;
  raiseMult: number;
  freeActionMult: number;
}

const STYLE_CONFIG: Record<SystemBotStyle, StyleParams> = {
  nit:        { label: '司马懿', aggression: 0.28, looseness: 0.18, bluffRate: 0.01, raiseBias: 0.08, crowdSensitivity: 1.0,  slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.5, sizingSensitivity: 0.8, patternSensitivity: 0.6, exploitWeight: 0.3, preflopCommitCap: 0.25 },
  tag:        { label: '赵云',   aggression: 0.52, looseness: 0.42, bluffRate: 0.04, raiseBias: 0.18, crowdSensitivity: 0.7,  slowplayRate: 0,    checkRaiseRate: 0.05, positionSensitivity: 0.9, sizingSensitivity: 0.7, patternSensitivity: 0.6, exploitWeight: 0.7, preflopCommitCap: 0.25 },
  lag:        { label: '孙悟空', aggression: 0.72, looseness: 0.65, bluffRate: 0.08, raiseBias: 0.28, crowdSensitivity: 0.4,  slowplayRate: 0,    checkRaiseRate: 0.08, positionSensitivity: 0.7, sizingSensitivity: 0.5, patternSensitivity: 0.4, exploitWeight: 0.7, preflopCommitCap: 0.35 },
  station:    { label: '猪八戒', aggression: 0.16, looseness: 0.72, bluffRate: 0,    raiseBias: 0.04, crowdSensitivity: 0.15, slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.1, sizingSensitivity: 0.1, patternSensitivity: 0.1, exploitWeight: 0.1, preflopCommitCap: 0.25 },
  maniac:     { label: '张飞',   aggression: 0.88, looseness: 0.82, bluffRate: 0.18, raiseBias: 0.45, crowdSensitivity: 0.2,  slowplayRate: 0,    checkRaiseRate: 0.10, positionSensitivity: 0.1, sizingSensitivity: 0.2, patternSensitivity: 0.1, exploitWeight: 0.3, preflopCommitCap: 0.50 },
  trapper:    { label: '王熙凤', aggression: 0.38, looseness: 0.45, bluffRate: 0.03, raiseBias: 0.12, crowdSensitivity: 0.6,  slowplayRate: 0.55, checkRaiseRate: 0.40, positionSensitivity: 0.6, sizingSensitivity: 0.5, patternSensitivity: 0.8, exploitWeight: 0.6, preflopCommitCap: 0.25 },
  bully:      { label: '鲁智深', aggression: 0.62, looseness: 0.55, bluffRate: 0.10, raiseBias: 0.30, crowdSensitivity: 0.5,  slowplayRate: 0,    checkRaiseRate: 0.06, positionSensitivity: 0.5, sizingSensitivity: 0.5, patternSensitivity: 0.4, exploitWeight: 0.5, preflopCommitCap: 0.30 },
  tilter:     { label: '林冲',   aggression: 0.48, looseness: 0.38, bluffRate: 0.03, raiseBias: 0.15, crowdSensitivity: 0.7,  slowplayRate: 0,    checkRaiseRate: 0.04, positionSensitivity: 0.7, sizingSensitivity: 0.5, patternSensitivity: 0.5, exploitWeight: 0.5, preflopCommitCap: 0.25 },
  shortstack: { label: '燕青',   aggression: 0.55, looseness: 0.40, bluffRate: 0.05, raiseBias: 0.20, crowdSensitivity: 0.6,  slowplayRate: 0,    checkRaiseRate: 0,    positionSensitivity: 0.4, sizingSensitivity: 0.5, patternSensitivity: 0.3, exploitWeight: 0.4, preflopCommitCap: 0.25 },
  adaptive:   { label: '曹操',   aggression: 0.50, looseness: 0.45, bluffRate: 0.06, raiseBias: 0.20, crowdSensitivity: 0.5,  slowplayRate: 0.05, checkRaiseRate: 0.08, positionSensitivity: 0.8, sizingSensitivity: 0.8, patternSensitivity: 1.0, exploitWeight: 1.0, preflopCommitCap: 0.25 },
  gto:        { label: '诸葛亮', aggression: 0.50, looseness: 0.42, bluffRate: 0.07, raiseBias: 0.22, crowdSensitivity: 0.5,  slowplayRate: 0.10, checkRaiseRate: 0.12, positionSensitivity: 0.9, sizingSensitivity: 0.9, patternSensitivity: 0.7, exploitWeight: 0.2, preflopCommitCap: 0.25 },
};

const TIMING_PROFILES: Record<SystemBotStyle, TimingProfile> = {
  nit:        { minMs: 420, maxMs: 980, facingBetBonus: 180, riverBonus: 140, foldMult: 1.10, allinMult: 1.20, raiseMult: 1.05, freeActionMult: 0.95 },
  tag:        { minMs: 240, maxMs: 520, facingBetBonus: 110, riverBonus: 90, foldMult: 1.00, allinMult: 1.10, raiseMult: 1.00, freeActionMult: 0.90 },
  lag:        { minMs: 140, maxMs: 360, facingBetBonus: 70, riverBonus: 60, foldMult: 0.95, allinMult: 0.90, raiseMult: 0.90, freeActionMult: 0.85 },
  station:    { minMs: 260, maxMs: 560, facingBetBonus: 80, riverBonus: 100, foldMult: 0.90, allinMult: 1.00, raiseMult: 0.95, freeActionMult: 0.88 },
  maniac:     { minMs: 60, maxMs: 180, facingBetBonus: 25, riverBonus: 20, foldMult: 0.80, allinMult: 0.60, raiseMult: 0.75, freeActionMult: 0.80 },
  trapper:    { minMs: 320, maxMs: 760, facingBetBonus: 160, riverBonus: 120, foldMult: 1.05, allinMult: 1.10, raiseMult: 1.15, freeActionMult: 0.95 },
  bully:      { minMs: 120, maxMs: 300, facingBetBonus: 60, riverBonus: 60, foldMult: 0.90, allinMult: 0.85, raiseMult: 0.85, freeActionMult: 0.85 },
  tilter:     { minMs: 150, maxMs: 360, facingBetBonus: 70, riverBonus: 50, foldMult: 0.85, allinMult: 0.70, raiseMult: 0.85, freeActionMult: 0.82 },
  shortstack: { minMs: 80, maxMs: 220, facingBetBonus: 40, riverBonus: 30, foldMult: 0.85, allinMult: 0.75, raiseMult: 0.80, freeActionMult: 0.82 },
  adaptive:   { minMs: 220, maxMs: 520, facingBetBonus: 110, riverBonus: 100, foldMult: 1.00, allinMult: 1.00, raiseMult: 1.00, freeActionMult: 0.90 },
  gto:        { minMs: 280, maxMs: 620, facingBetBonus: 130, riverBonus: 120, foldMult: 1.00, allinMult: 1.08, raiseMult: 1.05, freeActionMult: 0.92 },
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

export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

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
  return posInMiddle < epCount ? 'UTG' : 'MP';
}

export function getPositionFactor(position: Position): number {
  switch (position) {
    case 'BTN': return 0.08;
    case 'CO':  return 0.06;
    case 'MP':  return 0;
    case 'UTG': return -0.06;
    case 'SB':  return -0.06;
    case 'BB':  return -0.02;
  }
}

// ─── Human pressure module ──────────────────────────────────────────────────

export type HumanSkillLevel = 'low' | 'mid' | 'high';

export function assessHumanSkill(
  elo: number | undefined,
  stats: { hands: number; vpipRate: number; af: number } | undefined,
): HumanSkillLevel {
  const eloScore = elo ?? 1200;
  if (stats && stats.hands >= 20) {
    if (eloScore < 1100 || stats.vpipRate > 0.55 || stats.af < 0.5) return 'low';
    if (eloScore > 1400 && stats.vpipRate >= 0.22 && stats.vpipRate <= 0.38 && stats.af > 1.5) return 'high';
  } else {
    if (eloScore < 1100) return 'low';
    if (eloScore > 1400) return 'high';
  }
  return 'mid';
}

export function calcHumanPressure(skill: HumanSkillLevel, style: SystemBotStyle): number {
  const base: Record<HumanSkillLevel, number> = {
    low: 0.08,
    mid: 0.05,
    high: 0.01,
  };
  const cap: Partial<Record<SystemBotStyle, number>> = {
    station: 0.05,
    maniac: 0.05,
    nit: 0.12,
  };
  const pressure = base[skill] + 0.03;
  const maxPressure = cap[style] ?? 0.10;
  return Math.min(pressure, maxPressure);
}

function blendStyleParams(base: StyleParams, mimic: StyleParams, weight: number): StyleParams {
  const w = clamp01(weight);
  const mix = (a: number, b: number) => a * (1 - w) + b * w;

  return {
    label: base.label,
    aggression: clamp01(mix(base.aggression, mimic.aggression)),
    looseness: clamp01(mix(base.looseness, mimic.looseness)),
    bluffRate: clamp01(mix(base.bluffRate, mimic.bluffRate)),
    raiseBias: clamp01(mix(base.raiseBias, mimic.raiseBias)),
    crowdSensitivity: clamp01(mix(base.crowdSensitivity, mimic.crowdSensitivity)),
    slowplayRate: clamp01(mix(base.slowplayRate, mimic.slowplayRate)),
    checkRaiseRate: clamp01(mix(base.checkRaiseRate, mimic.checkRaiseRate)),
    positionSensitivity: clamp01(mix(base.positionSensitivity, mimic.positionSensitivity)),
    sizingSensitivity: clamp01(mix(base.sizingSensitivity, mimic.sizingSensitivity)),
    patternSensitivity: clamp01(mix(base.patternSensitivity, mimic.patternSensitivity)),
    exploitWeight: clamp01(mix(base.exploitWeight, mimic.exploitWeight)),
    preflopCommitCap: clamp01(mix(base.preflopCommitCap, mimic.preflopCommitCap)),
  };
}

export function resolveAdaptivePersonality(
  profile: OpponentProfile | null | undefined,
  stackRatio: number,
): AdaptivePersonalityPlan {
  if (!profile || profile.hands < 8) {
    if (stackRatio > 1.2) {
      return { mimicStyle: 'bully', reason: '样本不足但我有码差, 先用压迫线试探谁会退让.' };
    }
    return { mimicStyle: 'lag', reason: '样本不足, 先用高压探路线收集反应.' };
  }

  if (profile.af > 2.5) {
    if (profile.vpipRate < 0.28 && profile.foldToCbetRate > 0.45) {
      return { mimicStyle: 'lag', reason: '对手紧但主动, 不跟他玩埋伏, 直接用高压偷走弃牌率.' };
    }
    return { mimicStyle: 'trapper', reason: '对手过于好斗, 借王熙凤的伏击线反制.' };
  }

  if (profile.vpipRate < 0.25 || profile.foldToCbetRate > 0.60 || profile.wtsdRate < 0.20) {
    if (profile.foldToCbetRate > 0.70 || profile.vpipRate < 0.18) {
      return { mimicStyle: 'maniac', reason: '对手太紧, 借张飞的疯压线强行偷池.' };
    }
    return { mimicStyle: 'lag', reason: '对手偏紧, 借孙悟空的高压位置线持续施压.' };
  }

  if (profile.vpipRate > 0.55 && profile.af < 0.8) {
    if (stackRatio > 1.25) {
      return { mimicStyle: 'bully', reason: '对手跟注过宽且我有码差, 借鲁智深的碾压线榨值.' };
    }
    return { mimicStyle: 'tag', reason: '对手愿意跟到底, 收敛诈唬改打薄价值.' };
  }

  if (profile.af < 0.8) {
    return { mimicStyle: 'bully', reason: '对手被动退让, 借鲁智深的压力线逼弃.' };
  }

  if (profile.pfrRate < 0.16 && profile.wtsdRate < 0.24) {
    return { mimicStyle: 'lag', reason: '对手主动性不足又不肯摊牌, 借孙悟空的偷压线持续拿小池.' };
  }

  if (stackRatio > 1.15) {
    return { mimicStyle: 'bully', reason: '暂无明确漏洞, 但我有码差, 先用碾压线制造弃牌.' };
  }

  return { mimicStyle: 'lag', reason: '暂无明显破绽, 先用高频施压线逼出更多信息.' };
}

export function computePersonalityThinkTime(
  style: SystemBotStyle,
  action: PokerAction,
  req: ActionRequest,
  rollValue: number = Math.random(),
): number {
  const profile = TIMING_PROFILES[style];
  const base = profile.minMs + (profile.maxMs - profile.minMs) * clamp01(rollValue);
  let thinkMs = base;

  if (req.toCall > 0) thinkMs += profile.facingBetBonus;
  if (req.street === 'river') thinkMs += profile.riverBonus;

  if (req.toCall === 0 && (action.action === 'check' || action.action === 'raise')) {
    thinkMs *= profile.freeActionMult;
  }

  switch (action.action) {
    case 'fold':
      thinkMs *= profile.foldMult;
      break;
    case 'raise':
      thinkMs *= profile.raiseMult;
      break;
    case 'allin':
      thinkMs *= profile.allinMult;
      break;
    default:
      break;
  }

  return clampInt(Math.round(thinkMs), 0, Math.max(0, BOT_ACTION_TIMEOUT_MS - 150));
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

  // ─── Opponent modeling (v2: per-player, per-street) ─────────────────────
  private opponentTracker = new OpponentTracker();
  private opponentStats = new Map<number, OpponentStats>(); // legacy seat-keyed (used by getAverageOpponentProfile)
  private seatToPlayerId = new Map<number, string>();  // seat → playerId mapping for current hand
  private currentStreet: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop';
  private preflopActors = new Set<number>();  // seats that acted preflop (non-blind)
  private preflopAggressor: string | null = null;  // playerId of last preflop raiser (for cbet tracking)
  private flopPlayerIds: string[] = [];  // players who saw the flop (for WTSD)

  // ─── Multi-street memory ─────────────────────────────────────────────────
  private handActions: HandActionRecord = { preflop: [], flop: [], turn: [], river: [] };

  // ─── Playbook & bluff line state ─────────────────────────────────────────
  private currentBluffLine = false;
  private bluffStreetCount = 0;
  private myActionsThisHand: Array<{ street: 'preflop' | 'flop' | 'turn' | 'river'; action: string }> = [];

  // ─── Human pressure tracking ────────────────────────────────────────────
  private playerMeta = new Map<number, { isBot: boolean; elo?: number }>();

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
        this.currentBluffLine = false;
        this.bluffStreetCount = 0;
        this.myActionsThisHand = [];
        this.myPosition = calcPosition(
          msg.seat,
          msg.buttonSeat,
          msg.players.map(p => p.seat),
        );
        // Track player metadata for human pressure
        this.playerMeta.clear();
        this.seatToPlayerId.clear();
        this.preflopAggressor = null;
        this.flopPlayerIds = [];
        for (const p of msg.players) {
          this.playerMeta.set(p.seat, { isBot: p.isBot, elo: p.elo });
          this.seatToPlayerId.set(p.seat, p.playerId);
        }
        // v2: per-player tracking via OpponentTracker
        for (const p of msg.players) {
          if (p.seat !== this.mySeat) {
            this.opponentTracker.recordNewHand(p.playerId);
          }
        }
        // Legacy: ensure stats exist for all opponents (kept for backward compat)
        for (const p of msg.players) {
          if (p.seat !== this.mySeat && !this.opponentStats.has(p.seat)) {
            this.opponentStats.set(p.seat, { hands: 0, vpip: 0, pfr: 0, aggActions: 0, passActions: 0, cbetOpportunities: 0, cbets: 0, foldToCbetCount: 0, foldToCbetOpportunities: 0, wtsdCount: 0, wtsdOpportunities: 0 });
          }
        }
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
        // v2: track players who saw the flop (for WTSD opportunity)
        if (this.currentStreet === 'flop') {
          const activeOpponents = new Set(this.getActiveOpponentSeats());
          this.flopPlayerIds = [];
          for (const [seat, pid] of this.seatToPlayerId) {
            if (activeOpponents.has(seat)) this.flopPlayerIds.push(pid);
          }
          this.opponentTracker.recordSawFlop(this.flopPlayerIds);
        }
        break;
      case 'player_action': {
        // Track all actions for multi-street pattern detection
        this.handActions[this.currentStreet].push({ seat: msg.seat, action: msg.action, amount: msg.amount });
        // Track my own actions for playbook priorMyActions matching
        if (msg.seat === this.mySeat) {
          this.myActionsThisHand.push({ street: this.currentStreet, action: msg.action });
          break;
        }
        const s = this.opponentStats.get(msg.seat);
        if (!s) break;
        // Legacy seat-keyed stats
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
        // v2: per-player OpponentTracker
        const pid = this.seatToPlayerId.get(msg.seat);
        if (pid) {
          const isVpip = this.currentStreet === 'preflop'
            && (msg.action === 'call' || msg.action === 'raise' || msg.action === 'allin')
            && !this.preflopActors.has(msg.seat);
          const isPfr = this.currentStreet === 'preflop'
            && (msg.action === 'raise' || msg.action === 'allin');
          this.opponentTracker.recordAction(pid, this.currentStreet, msg.action as 'fold'|'check'|'call'|'raise'|'allin', {
            isVpip,
            isPfr,
          });
          // Track preflop aggressor for cbet
          if (this.currentStreet === 'preflop' && (msg.action === 'raise' || msg.action === 'allin')) {
            this.preflopAggressor = pid;
          }
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
      case 'showdown_result':
        // v2: track who reached showdown (for WTSD)
        this.opponentTracker.recordShowdown(msg.players.map(p => p.playerId));
        break;
      case 'action_request':
        break;
    }
  }

  requestAction(req: ActionRequest): Promise<PokerAction & { debug?: BotDebugInfo }> {
    if (!this.holeCards) {
      return this.finalizeBuiltinDecision({
        action: req.toCall > 0 ? 'fold' : 'check',
        debug: { reasoning: `${this.definition.name}: 无手牌信息，安全弃牌.` },
      }, this.definition.style, req);
    }

    const style = this.definition.style;
    let cfg = { ...STYLE_CONFIG[style] };
    let extraReasoning = '';
    let personalityStyle: SystemBotStyle = style;
    const avgOppStack = this.players
      .filter(p => p.seat !== this.mySeat)
      .reduce((s, p) => s + p.stack, 0) / Math.max(1, this.players.length - 1);
    const stackRatio = req.stack / Math.max(avgOppStack, 1);

    // ─── Adaptive (曹操): mimic the weakness we currently observe ────────────
    if (style === 'adaptive') {
      const lastActor = req.history.length > 0 ? req.history[req.history.length - 1] : null;
      const targetPid = lastActor ? this.seatToPlayerId.get(lastActor.seat) : undefined;
      const targetProfile = targetPid ? this.opponentTracker.getProfile(targetPid) : undefined;
      const profile = targetProfile && targetProfile.hands >= 8
        ? targetProfile
        : this.getAverageOpponentProfile();
      const plan = resolveAdaptivePersonality(profile, stackRatio);
      personalityStyle = plan.mimicStyle;
      cfg = blendStyleParams(cfg, STYLE_CONFIG[personalityStyle], 0.70);
      extraReasoning = ` 变色龙→${STYLE_CONFIG[personalityStyle].label}. ${plan.reason}`;
    }

    // ─── Bully (鲁智深): boost aggression vs short stacks ────────────────
    if (style === 'bully') {
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
      if (bbCount <= 18 && req.street === 'preflop') {
        const action = choosePushFold(this.holeCards, bbCount, req, this.players.length);
        return this.finalizeBuiltinDecision({
          ...action,
          debug: {
            equity: preflopStrength(this.holeCards),
            reasoning: `${this.definition.name}: ${bbCount.toFixed(0)}BB 短码模式, ${action.action === 'allin' ? '全下!' : '弃牌等待.'}`,
          },
        }, 'shortstack', req);
      }
    }

    // ─── Playbook: signature moves (checked before solver/heuristic) ────────
    {
      const opponents = req.street === 'preflop'
        ? Math.max(1, this.players.length - 1)
        : this.getActiveOpponentCount();
      const earlyStrength = req.street === 'preflop'
        ? preflopHandStrengthV2(this.holeCards, this.myPosition, personalityStyle)
        : postflopStrengthMCV2(this.holeCards, req.board, opponents);

      const facingAction: 'none' | 'bet' | 'raise' = req.toCall <= 0 ? 'none'
        : (req.history.length > 0 && req.history[req.history.length - 1].action === 'raise') ? 'raise' : 'bet';

      const pbCtx: PlaybookContext = {
        street: req.street,
        position: this.myPosition as PlaybookPosition,
        facingAction,
        opponents,
        stackBB: req.stack / Math.max(this.bigBlind, 1),
        pot: req.pot,
        stack: req.stack,
        toCall: req.toCall,
        minRaise: req.minRaise,
        currentBet: req.currentBet,
        boardTexture: req.street !== 'preflop' ? analyzeBoard(req.board) : null,
        strength: earlyStrength,
        priorMyActions: this.myActionsThisHand,
        chipAdvantageRatio: req.stack / Math.max(avgOppStack, 1),
        tiltLevel: this.tiltLevel,
        bigBlind: this.bigBlind,
      };

      // [1] Playbook signature moves
      const pbResult = matchPlaybook(personalityStyle, pbCtx);
      if (pbResult) {
        const action: PokerAction = pbResult.amount > 0
          ? { action: pbResult.action as 'raise', amount: pbResult.amount }
          : { action: pbResult.action as 'fold' | 'check' | 'call' | 'allin' };
        return this.finalizeBuiltinDecision({
          ...action,
          debug: {
            equity: earlyStrength,
            reasoning: `${this.definition.name}: [${pbResult.patternName}] 签名招式!${extraReasoning} ${describeHolding(req.street, this.holeCards, req.board)}.`,
          },
        }, personalityStyle, req);
      }

      // [2] Unconditional bluff engine (postflop only)
      if (req.street !== 'preflop') {
        const bluffResult = checkUnconditionalBluff(
          personalityStyle,
          this.myPosition as 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB',
          req.street,
          pbCtx.boardTexture,
          req.toCall > 0,
          this.currentBluffLine,
          this.bluffStreetCount,
          req.pot, req.stack, req.minRaise, req.currentBet, req.toCall, this.bigBlind,
        );
        if (bluffResult) {
          this.currentBluffLine = bluffResult.isBluffLine;
          this.bluffStreetCount++;
          const action: PokerAction = bluffResult.amount >= req.stack
            ? { action: 'allin' }
            : { action: bluffResult.action, amount: bluffResult.amount };
          return this.finalizeBuiltinDecision({
            ...action,
            debug: {
              equity: earlyStrength,
              reasoning: `${this.definition.name}: [${bluffResult.source}] ${this.bluffStreetCount > 1 ? `连续施压第${this.bluffStreetCount}街` : '位置 bluff'} @ ${this.myPosition}.${extraReasoning} ${describeHolding(req.street, this.holeCards, req.board)}.`,
            },
          }, personalityStyle, req);
        }
        // If bluff engine didn't fire, reset bluff line for this street
        if (this.currentBluffLine && req.toCall <= 0) {
          // We were in a bluff line but chose not to continue — end the line
          this.currentBluffLine = false;
          this.bluffStreetCount = 0;
        }
      }
    }

    // ─── Universal opponent modeling (v2: per-player, scaled by exploitWeight) ─
    // Try per-player exploit first (v2), fall back to legacy average
    let exploitApplied = false;
    let callThresholdDelta = 0;  // v2: exploit-driven call threshold adjustment
    if (req.history.length > 0) {
      const lastActor = req.history[req.history.length - 1];
      const targetPid = this.seatToPlayerId.get(lastActor.seat);
      if (targetPid) {
        const exploit = this.opponentTracker.computeExploit(targetPid);
        if (exploit) {
          cfg.aggression = clamp01(cfg.aggression + exploit.aggressionDelta * cfg.exploitWeight);
          cfg.bluffRate = clamp01(cfg.bluffRate + exploit.bluffDelta * cfg.exploitWeight);
          cfg.slowplayRate = clamp01(cfg.slowplayRate + exploit.slowplayDelta * cfg.exploitWeight);
          cfg.checkRaiseRate = clamp01(cfg.checkRaiseRate + exploit.checkRaiseDelta * cfg.exploitWeight);
          callThresholdDelta = exploit.callThresholdDelta * cfg.exploitWeight;
          const profile = this.opponentTracker.getProfile(targetPid);
          if (profile && !extraReasoning) {
            extraReasoning = ` 对手${targetPid}(VPIP ${Math.round(profile.vpipRate * 100)}% AF ${profile.af.toFixed(1)}).`;
          }
          exploitApplied = true;
        }
      }
    }
    // Legacy fallback: average opponent profile
    if (!exploitApplied) {
      const oppProfile = this.getAverageOpponentProfile();
      if (oppProfile.hands >= 8) {
        const exploit = computeExploit(oppProfile);
        cfg.aggression = clamp01(cfg.aggression + exploit.aggressionDelta * cfg.exploitWeight);
        cfg.bluffRate = clamp01(cfg.bluffRate + exploit.bluffDelta * cfg.exploitWeight);
        cfg.slowplayRate = clamp01(cfg.slowplayRate + exploit.slowplayDelta * cfg.exploitWeight);
        cfg.checkRaiseRate = clamp01(cfg.checkRaiseRate + exploit.checkRaiseDelta * cfg.exploitWeight);
        callThresholdDelta = exploit.callThresholdDelta * cfg.exploitWeight;
        if (!extraReasoning) {
          extraReasoning = ` 对手画像(VPIP ${Math.round(oppProfile.vpipRate * 100)}% AF ${oppProfile.af.toFixed(1)}).`;
        }
      }
    }

    // ─── Solver path: DCFR / Blueprint for postflop decisions ─────────
    // Try solver-based decision first, BUT respect personality overrides above:
    // - Shortstack push/fold already returned above (never reaches here)
    // - Bully/tilter cfg mutations carry into heuristic fallback below
    // - Solver applies its own style deviations (style-deviations.ts)
    // Dynamic style shifting based on bot state:
    // 林冲 (tilter): tilted → plays like 张飞 (maniac)
    // 鲁智深 (bully): chip advantage → plays like 孙悟空 (lag)
    let effectiveStyle: SystemBotStyle = personalityStyle;
    if (style === 'tilter' && this.tiltLevel > 0.3) {
      effectiveStyle = this.tiltLevel > 0.7 ? 'maniac' : 'lag';
      extraReasoning += this.tiltLevel > 0.7 ? ' 风雪山神庙!' : ' 渐失冷静.';
    }
    if (style === 'bully') {
      if (stackRatio > 1.5) {
        effectiveStyle = 'lag'; // 碾压模式: 宽范围高压
        extraReasoning += ` 筹码碾压(${stackRatio.toFixed(1)}x)!`;
      }
    }
    if (req.street !== 'preflop') {
      const numOpponents = this.getActiveOpponentCount();
      // Build opponent model for adaptive (曹操) exploitation
      const oppProfile = this.getAverageOpponentProfile();
      const oppModel = oppProfile.hands >= 5 ? {
        foldToCbet: oppProfile.foldToCbetRate,
        foldTo3bet: oppProfile.foldToCbetRate, // approximate
        vpip: oppProfile.vpipRate,
        af: oppProfile.af,
        wtsd: oppProfile.wtsdRate,
        hands: oppProfile.hands,
      } : undefined;
      const solverResult = solverDecision(
        this.holeCards, req.board, req.pot, req.stack,
        req.toCall, req.minRaise, req.currentBet,
        req.street as 'flop' | 'turn' | 'river', effectiveStyle, numOpponents,
        oppModel,
      );
      if (solverResult) {
        const action: PokerAction = solverResult.amount > 0
          ? { action: solverResult.action as 'raise', amount: solverResult.amount }
          : { action: solverResult.action as 'fold' | 'check' | 'call' | 'allin' };
        return this.finalizeBuiltinDecision({
          ...action,
          debug: {
            equity: solverResult.debug?.strength ?? 0,
            potOdds: req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0,
            reasoning: `${this.definition.name}: DCFR solver [${solverResult.debug?.source}] ${solverResult.debug?.iterations ?? 0} iterations.${extraReasoning} ${describeHolding(req.street, this.holeCards, req.board)}.`,
          },
        }, effectiveStyle, req);
      }
    }

    // ─── GTO (诸葛亮): use balanced mixed strategy (postflop only) ─────
    // Preflop: use position-aware ranges like other styles. MDF defense
    // doesn't apply preflop and inflates VPIP to ~70%.
    if (style === 'gto' && req.street !== 'preflop') {
      const opponents = this.getActiveOpponentCount();
      const gtoStrength = postflopStrengthMCV2(this.holeCards, req.board, opponents);
      const texture = analyzeBoard(req.board);
      const balancedReq: BalancedActionRequest = {
        street: req.street,
        board: req.board,
        pot: req.pot,
        currentBet: req.currentBet,
        toCall: req.toCall,
        minRaise: req.minRaise,
        stack: req.stack,
        initialStack: req.initialStack,
      };
      const decision = chooseBalancedAction(gtoStrength, balancedReq, texture, opponents + 1);
      const { frequencies } = decision;
      return this.finalizeBuiltinDecision({
        action: decision.action,
        ...(decision.amount > 0 ? { amount: decision.amount } : {}),
        debug: {
          equity: decision.strength,
          potOdds: req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0,
          foldFreq: frequencies.fold,
          callFreq: frequencies.call,
          raiseFreq: frequencies.raise,
          reasoning: `${this.definition.name}: 均衡策略 [F${Math.round(frequencies.fold * 100)}% C${Math.round(frequencies.call * 100)}% R${Math.round(frequencies.raise * 100)}%] ${decision.reasoning}. ${describeHolding(req.street, this.holeCards, req.board)}.`,
        },
      }, 'gto', req);
    }

    // ─── v2 Preflop: use getPreflopAction for position-aware decisions ────
    const opponents = req.street === 'preflop'
      ? Math.max(1, this.players.length - 1)
      : this.getActiveOpponentCount();
    const bbCount = req.stack / Math.max(this.bigBlind, 1);

    if (req.street === 'preflop') {
      // Human pressure: boost raise frequency preflop vs humans
      let humanPressureBoost = 0;
      for (const [seat, meta] of this.playerMeta) {
        if (seat === this.mySeat || meta.isBot) continue;
        const oppStats = this.opponentStats.get(seat);
        let statsForAssess: { hands: number; vpipRate: number; af: number } | undefined;
        if (oppStats && oppStats.hands >= 3) {
          statsForAssess = {
            hands: oppStats.hands,
            vpipRate: oppStats.vpip / oppStats.hands,
            af: oppStats.passActions > 0 ? oppStats.aggActions / oppStats.passActions : 1,
          };
        }
        const skill = assessHumanSkill(meta.elo, statsForAssess);
        humanPressureBoost = calcHumanPressure(skill, this.definition.style);
        break;
      }

      const raisersAhead = req.history.filter(h => h.action === 'raise' || h.action === 'allin').length;
      const toCallBB = req.toCall / Math.max(this.bigBlind, 1);
      const potOdds = req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0;
      const preflopDecision = getPreflopAction(this.holeCards, this.myPosition, effectiveStyle, {
        facing3Bet: raisersAhead >= 2,
        raisersAhead,
        stackBB: bbCount,
        toCallBB,
        potOdds,
      });

      // Apply frequency-based randomization (boosted by human pressure)
      const roll = Math.random();
      let preflopAction: PokerAction;

      // When full CFR mixed-strategy frequencies are available, use proper
      // 3-way randomization instead of the binary dominant-action approach.
      // This prevents the old bug where call-dominant hands (e.g. station TT:
      // 53% call, 47% raise, 0% fold) had the raise portion incorrectly
      // converted to fold.
      if (preflopDecision.frequencies) {
        let { fold: pFold, call: pCall, raise: pRaise } = preflopDecision.frequencies;
        // Boost raise frequency with human pressure, but ONLY on hands that
        // are already in the play range. Boosting garbage hands (fold>85%)
        // causes absurd plays like TAG raising J5o from MP.
        if (humanPressureBoost > 0 && pFold < 0.85) {
          pRaise = Math.min(1, pRaise + humanPressureBoost);
          pFold = Math.max(0, pFold - humanPressureBoost * 0.5);
          pCall = Math.max(0, pCall - humanPressureBoost * 0.5);
          const total = pFold + pCall + pRaise;
          if (total > 0) { pFold /= total; pCall /= total; pRaise /= total; }
        }
        if (roll < pFold) {
          preflopAction = req.toCall > 0 ? { action: 'fold' } : { action: 'check' };
        } else if (roll < pFold + pCall) {
          preflopAction = req.toCall > 0 ? { action: 'call' } : { action: 'check' };
        } else {
          const raiseStrength = preflopHandStrengthV2(this.holeCards, this.myPosition, effectiveStyle);
          preflopAction = chooseRaiseAction(req, raiseStrength, cfg, effectiveStyle);
        }
      } else {
        // Heuristic fallback: binary randomization on dominant action
        const boostedFreq = Math.min(1, preflopDecision.frequency + humanPressureBoost);
        if (preflopDecision.action === 'raise') {
          if (roll < boostedFreq) {
            const raiseStrength = preflopHandStrengthV2(this.holeCards, this.myPosition, effectiveStyle);
            preflopAction = chooseRaiseAction(req, raiseStrength, cfg, effectiveStyle);
          } else {
            preflopAction = req.toCall > 0 ? { action: 'call' } : { action: 'check' };
          }
        } else if (preflopDecision.action === 'call') {
          if (roll < boostedFreq) {
            preflopAction = req.toCall > 0 ? { action: 'call' } : { action: 'check' };
          } else {
            preflopAction = req.toCall > 0 ? { action: 'fold' } : { action: 'check' };
          }
        } else {
          preflopAction = req.toCall > 0 ? { action: 'fold' } : { action: 'check' };
        }
      }

      const preflopStrengthVal = preflopHandStrengthV2(this.holeCards, this.myPosition, effectiveStyle);
      return this.finalizeBuiltinDecision({
        ...preflopAction,
        debug: {
          equity: preflopStrengthVal,
          potOdds,
          reasoning: `${this.definition.name}: preflop ${this.myPosition} ${preflopDecision.action}(${Math.round(preflopDecision.frequency * 100)}%). ${describeHolding(req.street, this.holeCards, req.board)}.${extraReasoning}`,
        },
      }, effectiveStyle, req);
    }

    // ─── Postflop path (standard engine) ─────────────────────────────────
    // v2: MC equity (no looseness inflation, no stack-depth on postflop)
    const strength = postflopStrengthMCV2(this.holeCards, req.board, opponents);
    // v2: board texture analysis
    const texture: BoardTexture | null = analyzeBoard(req.board);
    const crowdPenalty = Math.max(0, opponents - 2) * 0.03 * cfg.crowdSensitivity;
    const posFactor = getPositionFactor(this.myPosition) * cfg.positionSensitivity;
    const isLatePosition = this.myPosition === 'BTN' || this.myPosition === 'CO';
    cfg.bluffRate = clamp01(cfg.bluffRate + (isLatePosition ? 0.03 : -0.02) * cfg.positionSensitivity);
    // v2 fix: NO looseness*0.25 inflation — looseness only affects callThreshold
    let adjustedStrength = clamp01(strength - crowdPenalty + posFactor);
    // v2: texture-aware bluff adjustment
    if (texture) {
      if (texture.wetness < 0.25) cfg.bluffRate = clamp01(cfg.bluffRate + 0.03);
      if (texture.wetness > 0.55) cfg.bluffRate = clamp01(cfg.bluffRate - 0.03);
    }

    // Bluff decay: reduce bluff rate when opponents called on prior streets
    const bluffDecay = computeBluffDecay(this.handActions, this.mySeat, req.street);
    if (bluffDecay > 0) {
      cfg.bluffRate = clamp01(cfg.bluffRate - bluffDecay);
    }

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
        // Cap total pattern penalty to prevent over-folding on multi-action boards
        patternPenalty = Math.min(patternPenalty, 0.15);
        adjustedStrength = clamp01(adjustedStrength - patternPenalty * cfg.patternSensitivity);
      }
    }

    // Human pressure (final adjustment layer)
    for (const [seat, meta] of this.playerMeta) {
      if (seat === this.mySeat || meta.isBot) continue;
      const oppStats = this.opponentStats.get(seat);
      let statsForAssess: { hands: number; vpipRate: number; af: number } | undefined;
      if (oppStats && oppStats.hands >= 3) {
        statsForAssess = {
          hands: oppStats.hands,
          vpipRate: oppStats.vpip / oppStats.hands,
          af: oppStats.passActions > 0 ? oppStats.aggActions / oppStats.passActions : 1,
        };
      }
      const skill = assessHumanSkill(meta.elo, statsForAssess);
      const pressure = calcHumanPressure(skill, this.definition.style);
      cfg.aggression = clamp01(cfg.aggression + pressure);
      cfg.bluffRate = clamp01(cfg.bluffRate + pressure * 0.5);
      break; // Apply pressure based on first human found
    }

    const potOdds = req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0;
    const action = chooseBuiltinAction(
      effectiveStyle,
      adjustedStrength,
      potOdds,
      req,
      cfg,
      texture,
      callThresholdDelta,
      {
        checkedThisStreet: this.myActionsThisHand.some(a => a.street === req.street && a.action === 'check'),
        dryBoard: texture?.wetness !== undefined ? texture.wetness < 0.25 : false,
        wetBoard: texture?.wetness !== undefined ? texture.wetness > 0.55 : false,
        latePosition: isLatePosition,
      },
    );

    return this.finalizeBuiltinDecision({
      ...action,
      debug: {
        equity: adjustedStrength,
        potOdds,
        foldFreq: clamp01(1 - adjustedStrength - cfg.looseness * 0.35),
        callFreq: clamp01(cfg.looseness * 0.55 + (req.toCall > 0 ? 0.15 : 0.05)),
        raiseFreq: clamp01(cfg.raiseBias + adjustedStrength * cfg.aggression),
        reasoning: `${this.definition.name}: ${describeHolding(req.street, this.holeCards, req.board)}.${extraReasoning}`,
      },
    }, effectiveStyle, req);
  }

  private finalizeBuiltinDecision<T extends PokerAction & { debug?: BotDebugInfo }>(
    result: T,
    style: SystemBotStyle,
    req: ActionRequest,
  ): Promise<T> {
    const thinkMs = computePersonalityThinkTime(style, result, req);

    if (result.debug) {
      result.debug.thinkMs = thinkMs;
    }

    if (!ENABLE_BUILTIN_BOT_TIMING || thinkMs <= 0) {
      return Promise.resolve(result);
    }

    return new Promise((resolve) => {
      setTimeout(() => resolve(result), thinkMs);
    });
  }

  private getFoldedSeatsThisHand(): Set<number> {
    return getFoldedSeats(this.handActions);
  }

  private getActiveOpponentSeats(): number[] {
    const folded = this.getFoldedSeatsThisHand();
    return this.players
      .map(p => p.seat)
      .filter(seat => seat !== this.mySeat && !folded.has(seat));
  }

  private getActiveOpponentCount(): number {
    return countActiveOpponents(
      this.players.map(p => p.seat),
      this.mySeat,
      this.handActions,
    );
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

export function getFoldedSeats(actions: HandActionRecord): Set<number> {
  const folded = new Set<number>();
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    for (const action of actions[street]) {
      if (action.action === 'fold') {
        folded.add(action.seat);
      }
    }
  }
  return folded;
}

export function countActiveOpponents(
  seats: number[],
  mySeat: number,
  actions: HandActionRecord,
): number {
  const folded = getFoldedSeats(actions);
  return Math.max(1, seats.filter(seat => seat !== mySeat && !folded.has(seat)).length);
}

/**
 * Compute bluff decay based on opponent calls on prior streets.
 * When opponents called our bets on previous streets, they've shown strength,
 * so we should bluff less on later streets. Returns 0..0.15 decay amount.
 */
export function computeBluffDecay(
  actions: HandActionRecord,
  mySeat: number,
  currentStreet: 'preflop' | 'flop' | 'turn' | 'river',
): number {
  const STREET_ORDER: Array<'preflop' | 'flop' | 'turn' | 'river'> = ['preflop', 'flop', 'turn', 'river'];
  const currentIdx = STREET_ORDER.indexOf(currentStreet);

  // Only count postflop calls on streets before the current one (skip preflop)
  let opponentCalls = 0;
  for (let i = 1; i < currentIdx; i++) {  // start at 1 to skip preflop
    const streetActions = actions[STREET_ORDER[i]];
    for (const a of streetActions) {
      if (a.seat !== mySeat && a.action === 'call') {
        opponentCalls++;
      }
    }
  }

  if (opponentCalls === 0) return 0;

  // Each opponent call reduces bluff rate by 0.04, capped at 0.15
  return Math.min(opponentCalls * 0.04, 0.15);
}

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
  texture?: BoardTexture | null,
  callThresholdDelta: number = 0,
  lineContext: HeuristicLineContext = {
    checkedThisStreet: false,
    dryBoard: false,
    wetBoard: false,
    latePosition: false,
  },
): PokerAction {
  if (!cfg) cfg = STYLE_CONFIG[style];

  // ─── SPR / pot commitment awareness ──────────────────────────────────
  const initStack = req.initialStack ?? req.stack;
  const chipsInPot = initStack - req.stack;
  const commitment = chipsInPot / Math.max(initStack, 1); // 0..1
  const spr = req.stack / Math.max(req.pot, 1); // stack-to-pot ratio

  // When deeply committed (>40% of stack in pot), shove or call — never fold
  if (req.street !== 'preflop' && commitment > 0.40 && spr < 2) {
    if (req.toCall === 0) {
      // No bet to face but pot-committed: shove for value/protection
      if (strength > 0.25) return { action: 'allin' };
      return { action: 'check' };
    }
    // Facing a bet while pot-committed: call (or shove) with almost anything
    if (strength > 0.20) return { action: 'allin' };
    // Even trash hands get good odds when this committed
    if (req.toCall <= req.stack * 0.5) return { action: 'call' };
    return { action: 'allin' };
  }

  // Moderate commitment (>25% stack in pot, SPR < 4): lower fold thresholds
  const commitmentDiscount = (req.street !== 'preflop' && commitment > 0.25 && spr < 4)
    ? 0.10 + commitment * 0.15 // up to ~0.25 discount at full commitment
    : 0;

  const callPressure = req.toCall / Math.max(req.stack + req.toCall, 1);

  // Call threshold: weighted blend of style floor and pot-odds threshold.
  // Old Math.max(base, odds) was too tight — pot odds couldn't lower the threshold.
  // Now loose styles weight pot odds more (call when price is right),
  // tight styles weight base threshold more (need hand strength regardless of price).
  // Nit: base ~0.29, oddsW 0.42   TAG: base ~0.21, oddsW 0.52
  // Station: base ~0.12, oddsW 0.64   Maniac: base ~0.09, oddsW 0.68
  const baseThreshold = 0.34 - cfg.looseness * 0.30 + callPressure * 0.10 - commitmentDiscount;
  const oddsThreshold = potOdds * (1 - cfg.looseness * 0.5);
  const oddsWeight = 0.35 + cfg.looseness * 0.40;
  // v2: apply exploit callThresholdDelta (negative = easier to call, positive = tighter)
  const callThreshold = baseThreshold * (1 - oddsWeight) + oddsThreshold * oddsWeight + callThresholdDelta;

  // Raise threshold: aggressive styles raise thinner
  // Nit: 0.65  TAG: 0.55  LAG: 0.44  Station: 0.66
  const raiseThreshold = 0.70 - cfg.aggression * 0.36 + potOdds * 0.04 - commitmentDiscount;

  // Bet sizing adjustment
  const betSizeRatio = req.toCall / Math.max(req.pot, 1);
  const sizingMult = getBetSizingMultiplier(betSizeRatio);
  // Pot-odds-anchored call threshold already encodes bet sizing; only apply mild
  // sensitivity so extreme overbets still feel slightly scarier for cautious styles.
  const sizedCallThreshold = callThreshold * lerp(1.0, sizingMult, cfg.sizingSensitivity * 0.25);
  const sizedRaiseThreshold = raiseThreshold * lerp(1.0, sizingMult, cfg.sizingSensitivity);

  // Raise cap sentinel: MAX_SAFE_INTEGER signals "no more raises allowed"
  const effectiveMinRaise = req.minRaise > req.stack * 2 ? req.stack : req.minRaise;
  const minRaiseTotal = req.currentBet + effectiveMinRaise;
  const maxRaiseTotal = req.currentBet + req.stack - req.toCall;
  const canRaise = req.stack > req.toCall && minRaiseTotal <= maxRaiseTotal;

  const raiseBiasFloor = 0.42 - cfg.looseness * 0.15;
  // Thin value bet floor: allows medium-strength hands to bet for value
  const valueBetFloor = sizedRaiseThreshold - 0.12 - cfg.aggression * 0.08;

  // No bet to face: check or bet
  if (req.toCall === 0) {
    // Low SPR: prefer shoving over slowplaying
    if (spr < 3 && strength > 0.40) {
      return { action: 'allin' };
    }
    // Slowplay is no longer nuts-only. Trappy styles can check medium-strong
    // hands on calmer boards to preserve a later raise line.
    const slowplayFreq = clamp01(
      cfg.slowplayRate
      * (0.20 + Math.max(0, strength - valueBetFloor + 0.20) * 1.10)
      * (lineContext.dryBoard ? 1.15 : 0.85),
    );
    if (strength > Math.max(0.42, valueBetFloor) && roll(slowplayFreq)) {
      return { action: 'check' };
    }
    if (canRaise && strength > sizedRaiseThreshold) {
      return chooseRaiseAction(req, strength, cfg, style, texture, 'value');
    }
    // Thin value bet: medium-strength hands bet smaller for value
    if (canRaise && strength > valueBetFloor && strength <= sizedRaiseThreshold) {
      const thinBetAmount = Math.round(req.pot * (0.40 + strength * 0.25));
      const raiseTotal = clampInt(
        req.currentBet + Math.max(thinBetAmount, req.minRaise),
        minRaiseTotal, maxRaiseTotal,
      );
      return raiseTotal >= maxRaiseTotal ? { action: 'allin' } : { action: 'raise', amount: raiseTotal };
    }
    // Bluff bet: garbage can now bluff too. Position/board texture change the
    // frequency, instead of a hard hand-strength floor locking trash out.
    const bluffBetFreq = clamp01(
      cfg.bluffRate
      * (0.35 + (1 - strength) * 0.85)
      * (lineContext.latePosition ? 1.20 : 0.95)
      * (lineContext.dryBoard ? 1.15 : lineContext.wetBoard ? 0.85 : 1.0),
    );
    if (canRaise && strength < valueBetFloor && roll(bluffBetFreq)) {
      return chooseRaiseAction(req, strength, cfg, style, texture, 'bluff');
    }
    return { action: 'check' };
  }

  // Facing a bet: fold / call / raise
  // Check-raise now has both value and bluff branches. Trappy styles can
  // spring with medium strength; aggressive styles can bluff-raise after checking.
  if (canRaise && lineContext.checkedThisStreet) {
    const valueCheckRaiseFreq = clamp01(
      cfg.checkRaiseRate * (0.25 + Math.max(0, strength - valueBetFloor + 0.10) * 1.20),
    );
    if (strength >= Math.max(valueBetFloor, sizedCallThreshold) && roll(valueCheckRaiseFreq)) {
      return chooseRaiseAction(req, strength, cfg, style, texture, 'value');
    }

    const bluffCheckRaiseFreq = clamp01(
      cfg.bluffRate
      * (0.22 + (1 - strength) * 0.45)
      * (lineContext.dryBoard ? 1.20 : lineContext.wetBoard ? 0.80 : 1.0),
    );
    if (strength < sizedCallThreshold && roll(bluffCheckRaiseFreq)) {
      return chooseRaiseAction(req, strength, cfg, style, texture, 'bluff');
    }
  }

  if (strength < sizedCallThreshold) {
    // Below calling threshold — some styles still fire a light raise line.
    const bluffRaiseFreq = clamp01(
      cfg.bluffRate
      * (0.18 + (1 - strength) * 0.40)
      * (lineContext.dryBoard ? 1.12 : lineContext.wetBoard ? 0.82 : 1.0),
    );
    if (canRaise && roll(bluffRaiseFreq)) {
      return chooseRaiseAction(req, strength, cfg, style, texture, 'bluff');
    }
    return { action: 'fold' };
  }

  // Above calling threshold — consider raising
  if (canRaise && (strength > sizedRaiseThreshold || (strength > raiseBiasFloor && roll(cfg.raiseBias)))) {
    return chooseRaiseAction(req, strength, cfg, style, texture, 'value');
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
  style: SystemBotStyle = 'tag',
  texture?: BoardTexture | null,
  intent: RaiseIntent = strength < 0.35 ? 'bluff' : 'value',
): PokerAction {
  if (req.stack <= req.toCall) return { action: 'allin' };

  // Raise cap sentinel: MAX_SAFE_INTEGER signals "no more raises allowed"
  const effectiveMinRaise = req.minRaise > req.stack * 2 ? req.stack : req.minRaise;
  const minRaiseTotal = req.currentBet + effectiveMinRaise;
  const maxRaiseTotal = req.currentBet + req.stack - req.toCall;
  if (maxRaiseTotal <= minRaiseTotal) return { action: 'allin' };

  if (strength > 0.92 && maxRaiseTotal <= minRaiseTotal + req.minRaise * 2) {
    return { action: 'allin' };
  }

  // v2: use geometric bet sizing module with texture awareness
  const streetsLeft = req.street === 'preflop' ? 4 : req.street === 'flop' ? 3 : req.street === 'turn' ? 2 : 1;
  const isBluff = intent !== 'value';
  const legalConstraints: LegalConstraints = {
    minRaise: effectiveMinRaise,
    currentBet: req.currentBet,
  };
  const sizing = chooseBetSize(req.pot, req.stack, streetsLeft, texture ?? null, strength, style, isBluff, legalConstraints);

  let raiseTotal = clampInt(
    Math.max(minRaiseTotal, req.currentBet + sizing.amount),
    minRaiseTotal,
    maxRaiseTotal,
  );

  // Preflop sizing cap: non-premium hands shouldn't over-commit
  if (req.street === 'preflop' && strength < 0.75) {
    const rInitStack = req.initialStack ?? req.stack;
    const maxPreflop = Math.round(rInitStack * cfg.preflopCommitCap);
    const chipsInPot = rInitStack - req.stack;
    const wouldCommit = chipsInPot + (raiseTotal - req.currentBet + req.toCall);
    if (wouldCommit > maxPreflop) {
      const capped = req.currentBet + Math.max(maxPreflop - chipsInPot - req.toCall, effectiveMinRaise);
      raiseTotal = clampInt(capped, minRaiseTotal, maxRaiseTotal);
    }
  }

  // Don't leave crumbs: if raise commits >50% of stack, just shove.
  // Raising and leaving a tiny stack behind is strategically wrong.
  const commitAmount = raiseTotal - req.currentBet + req.toCall;
  if (commitAmount >= req.stack * 0.5) {
    return { action: 'allin' };
  }

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
  const opponents = Math.max(1, playerCount - 1);
  const strength = req.street === 'preflop'
    ? preflopStrength(holeCards)
    : postflopStrengthMC(holeCards, req.board, opponents);
  const potOdds = req.toCall > 0 ? req.toCall / Math.max(req.pot + req.toCall, 1) : 0;

  // SPR / commitment check — even GTO should never fold when pot-committed
  const gtoInitStack = req.initialStack ?? req.stack;
  const gtoChipsIn = gtoInitStack - req.stack;
  const gtoCommitment = gtoChipsIn / Math.max(gtoInitStack, 1);
  const gtoSpr = req.stack / Math.max(req.pot, 1);
  if (req.street !== 'preflop' && gtoCommitment > 0.40 && gtoSpr < 2) {
    if (req.toCall === 0) {
      const result: PokerAction = strength > 0.25 ? { action: 'allin' } : { action: 'check' };
      return { result, strength, potOdds, foldFreq: 0, callFreq: 0, raiseFreq: strength > 0.25 ? 1 : 0 };
    }
    const result: PokerAction = { action: 'allin' };
    return { result, strength, potOdds, foldFreq: 0, callFreq: 0, raiseFreq: 1 };
  }

  // MDF (Minimum Defense Frequency) = 1 - bet/(bet+pot)
  // This is how often we must continue to prevent opponent from profiting with any two cards
  const mdf = req.toCall > 0 ? 1 - req.toCall / Math.max(req.pot + req.toCall, 1) : 1;

  let foldFreq: number, callFreq: number, raiseFreq: number;

  if (req.toCall === 0) {
    // No bet to face: choose between check and bet
    // Continuous bet frequency curve — value bets scale with strength, bluffs at bottom of range
    let betFreq: number;
    if (strength > 0.75) {
      betFreq = 0.80;                              // Premium: high-frequency value bet
    } else if (strength > 0.45) {
      betFreq = 0.35 + (strength - 0.45) * 1.5;    // Medium+: 35%→80% linear
    } else if (strength > 0.25) {
      betFreq = 0.15 + (strength - 0.25) * 1.0;    // Medium-: 15%→35% linear
    } else if (strength > 0.10) {
      betFreq = 0.20;                              // Weak: bluff ~20%
    } else {
      betFreq = 0.05;                              // Air: mostly check
    }
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

  const effectiveMinRaise_ = req.minRaise > req.stack * 2 ? req.stack : req.minRaise;
  const minRaiseTotal = req.currentBet + effectiveMinRaise_;
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
    // Auto all-in when raise commits >90% of remaining stack — leaving crumbs has no strategic value
    const remainingAfterRaise = req.stack - req.toCall - (raiseTotal - req.currentBet);
    if (raiseTotal >= maxRaiseTotal || remainingAfterRaise < req.stack * 0.10) {
      result = { action: 'allin' };
    } else {
      result = { action: 'raise', amount: raiseTotal };
    }
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
export const chooseBuiltinActionForTest = chooseBuiltinAction;
