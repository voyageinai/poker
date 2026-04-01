/**
 * Bot validation — similar to the chess platform's engine coordinate probe.
 *
 * Spawns the bot, sends a test hand with a known action_request,
 * and verifies the response is a valid PBP action.
 *
 * Returns null on success, or a diagnostic error string on failure.
 */
import { spawn } from 'child_process';
import * as readline from 'readline';
import type { PbpServerMessage, PbpBotMessage, ActionType } from '@/lib/types';
import fs from 'fs';

const VALID_ACTIONS = new Set<ActionType>(['fold', 'check', 'call', 'raise', 'allin']);
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export async function validateBot(binaryPath: string): Promise<ValidationResult> {
  // 1. Check file exists and is executable
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch {
    return { ok: false, error: 'File is not executable or does not exist' };
  }

  return new Promise<ValidationResult>(resolve => {
    const proc = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = readline.createInterface({ input: proc.stdout });
    let settled = false;
    let gotResponse = false;

    const done = (result: ValidationResult) => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      rl.close();
      resolve(result);
    };

    const timer = setTimeout(
      () => done({ ok: false, error: `Bot did not respond within ${HANDSHAKE_TIMEOUT_MS}ms` }),
      HANDSHAKE_TIMEOUT_MS,
    );

    proc.on('error', (err) => {
      clearTimeout(timer);
      done({ ok: false, error: `Failed to spawn bot: ${err.message}` });
    });

    proc.on('exit', (code) => {
      if (!gotResponse) {
        clearTimeout(timer);
        done({ ok: false, error: `Bot exited early with code ${code}` });
      }
    });

    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      gotResponse = true;
      clearTimeout(timer);

      let msg: PbpBotMessage;
      try {
        msg = JSON.parse(line) as PbpBotMessage;
      } catch {
        done({ ok: false, error: `Bot returned invalid JSON: ${line.slice(0, 100)}` });
        return;
      }

      if (!VALID_ACTIONS.has(msg.action)) {
        done({ ok: false, error: `Bot returned unknown action: "${msg.action}"` });
        return;
      }

      if (msg.action === 'raise' && (typeof msg.amount !== 'number' || msg.amount <= 0)) {
        done({ ok: false, error: 'Raise action must include a positive numeric amount' });
        return;
      }

      done({ ok: true });
    });

    // Send a probe hand: the bot should call or fold
    const newHand: PbpServerMessage = {
      type: 'new_hand',
      handId: 'probe',
      seat: 0,
      stack: 1000,
      players: [
        { seat: 0, displayName: 'probe', stack: 1000 },
        { seat: 1, displayName: 'opponent', stack: 1000 },
      ],
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
    };

    const holeCards: PbpServerMessage = {
      type: 'hole_cards',
      cards: ['Ah', 'Kd'],
    };

    const actionReq: PbpServerMessage = {
      type: 'action_request',
      street: 'preflop',
      board: [],
      pot: 30,
      currentBet: 20,
      toCall: 20,
      minRaise: 20,
      stack: 990,
      history: [],
    };

    try {
      proc.stdin.write(JSON.stringify(newHand) + '\n');
      proc.stdin.write(JSON.stringify(holeCards) + '\n');
      proc.stdin.write(JSON.stringify(actionReq) + '\n');
    } catch (err) {
      clearTimeout(timer);
      done({ ok: false, error: `Failed to write to bot stdin: ${(err as Error).message}` });
    }
  });
}
