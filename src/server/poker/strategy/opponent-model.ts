/**
 * Per-player opponent modeling with per-street stats, cbet/WTSD tracking,
 * and exploit adjustments. Fixes the bug where cbet/WTSD counters were
 * never incremented.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface StreetStats {
  bets: number
  checks: number
  calls: number
  raises: number
  folds: number
}

export interface OpponentStats {
  playerId: string
  hands: number
  vpip: number
  pfr: number
  streets: Record<'preflop' | 'flop' | 'turn' | 'river', StreetStats>
  cbetOpportunities: number
  cbets: number
  foldToCbetOpportunities: number
  foldToCbetCount: number
  wtsdOpportunities: number
  wtsdCount: number
}

export interface OpponentProfile {
  hands: number
  vpipRate: number
  pfrRate: number
  af: number
  cbetRate: number
  foldToCbetRate: number
  wtsdRate: number
  streetAF: Record<'preflop' | 'flop' | 'turn' | 'river', number>
}

export interface ExploitDeltas {
  aggressionDelta: number
  bluffDelta: number
  slowplayDelta: number
  checkRaiseDelta: number
  callThresholdDelta: number
}

// ── Helpers ───────────────────────────────────────────────────────────

const STREETS = ['preflop', 'flop', 'turn', 'river'] as const

function emptyStreetStats(): StreetStats {
  return { bets: 0, checks: 0, calls: 0, raises: 0, folds: 0 }
}

// ── Public functions ──────────────────────────────────────────────────

export function createEmptyStats(playerId: string): OpponentStats {
  return {
    playerId,
    hands: 0,
    vpip: 0,
    pfr: 0,
    streets: {
      preflop: emptyStreetStats(),
      flop: emptyStreetStats(),
      turn: emptyStreetStats(),
      river: emptyStreetStats(),
    },
    cbetOpportunities: 0,
    cbets: 0,
    foldToCbetOpportunities: 0,
    foldToCbetCount: 0,
    wtsdOpportunities: 0,
    wtsdCount: 0,
  }
}

export function getProfile(stats: OpponentStats): OpponentProfile {
  const h = Math.max(1, stats.hands)

  // Overall aggression factor: totalAgg / totalPass
  let totalAgg = 0
  let totalPass = 0
  const streetAF: Record<'preflop' | 'flop' | 'turn' | 'river', number> = {
    preflop: 0,
    flop: 0,
    turn: 0,
    river: 0,
  }

  for (const street of STREETS) {
    const s = stats.streets[street]
    const agg = s.raises
    const pass = s.calls
    totalAgg += agg
    totalPass += pass
    streetAF[street] = agg / Math.max(1, pass)
  }

  // Cbet rate with default when insufficient data
  const cbetRate =
    stats.cbetOpportunities < 3
      ? 0.5
      : stats.cbets / Math.max(1, stats.cbetOpportunities)

  // Fold-to-cbet rate with default
  const foldToCbetRate =
    stats.foldToCbetOpportunities < 3
      ? 0.4
      : stats.foldToCbetCount / Math.max(1, stats.foldToCbetOpportunities)

  // WTSD rate with default
  const wtsdRate =
    stats.wtsdOpportunities < 3
      ? 0.25
      : stats.wtsdCount / Math.max(1, stats.wtsdOpportunities)

  return {
    hands: stats.hands,
    vpipRate: stats.vpip / h,
    pfrRate: stats.pfr / h,
    af: totalAgg / Math.max(1, totalPass),
    cbetRate,
    foldToCbetRate,
    wtsdRate,
    streetAF,
  }
}

export function computeExploit(profile: OpponentProfile): ExploitDeltas {
  const deltas: ExploitDeltas = {
    aggressionDelta: 0,
    bluffDelta: 0,
    slowplayDelta: 0,
    checkRaiseDelta: 0,
    callThresholdDelta: 0,
  }

  if (profile.hands < 8) return deltas

  // ── Pattern-based exploits (checked in order, cumulative) ─────

  // Calling station: vpipRate > 0.55 AND af < 0.8
  if (profile.vpipRate > 0.55 && profile.af < 0.8) {
    deltas.aggressionDelta += 0.12
    deltas.bluffDelta += -0.06
    deltas.callThresholdDelta += -0.05
  }

  // Nit: vpipRate < 0.25
  if (profile.vpipRate < 0.25) {
    deltas.aggressionDelta += 0.08
    deltas.bluffDelta += 0.08
    deltas.callThresholdDelta += 0.03
  }

  // Passive: af < 0.8 AND vpipRate <= 0.55
  if (profile.af < 0.8 && profile.vpipRate <= 0.55) {
    deltas.aggressionDelta += 0.05
    deltas.bluffDelta += 0.05
  }

  // Aggro: af > 2.5
  if (profile.af > 2.5) {
    deltas.slowplayDelta += 0.12
    deltas.checkRaiseDelta += 0.10
  }

  // High fold-to-cbet: foldToCbetRate > 0.6
  if (profile.foldToCbetRate > 0.6) {
    deltas.aggressionDelta += 0.08
    deltas.bluffDelta += 0.04
  }

  // Low fold-to-cbet: foldToCbetRate < 0.3
  if (profile.foldToCbetRate < 0.3) {
    deltas.bluffDelta += -0.04
    deltas.callThresholdDelta += -0.03
  }

  // High WTSD: wtsdRate > 0.35
  if (profile.wtsdRate > 0.35) {
    deltas.aggressionDelta += 0.06
    deltas.bluffDelta += -0.04
    deltas.callThresholdDelta += -0.04
  }

  // ── Per-street exploits ───────────────────────────────────────

  // Bluff-then-give-up: flop AF > 2.5 AND turn AF < 0.8
  if (profile.streetAF.flop > 2.5 && profile.streetAF.turn < 0.8) {
    deltas.aggressionDelta += 0.05
    deltas.callThresholdDelta += -0.04
  }

  // Double barrel: turn AF > 2.0 AND river AF > 2.0
  if (profile.streetAF.turn > 2.0 && profile.streetAF.river > 2.0) {
    deltas.callThresholdDelta += 0.06
  }

  return deltas
}

// ── Tracker class ─────────────────────────────────────────────────────

export class OpponentTracker {
  private stats: Map<string, OpponentStats> = new Map()

  getStats(playerId: string): OpponentStats | undefined {
    return this.stats.get(playerId)
  }

  getOrCreate(playerId: string): OpponentStats {
    let s = this.stats.get(playerId)
    if (!s) {
      s = createEmptyStats(playerId)
      this.stats.set(playerId, s)
    }
    return s
  }

  recordNewHand(playerId: string): void {
    this.getOrCreate(playerId).hands++
  }

  recordAction(
    playerId: string,
    street: 'preflop' | 'flop' | 'turn' | 'river',
    action: 'fold' | 'check' | 'call' | 'raise' | 'allin',
    context: {
      isVpip?: boolean
      isPfr?: boolean
      isPreflopAggressor?: boolean
      isFacingCbet?: boolean
    },
  ): void {
    const s = this.getOrCreate(playerId)
    const st = s.streets[street]

    switch (action) {
      case 'fold':
        st.folds++
        break
      case 'check':
        st.checks++
        break
      case 'call':
        st.calls++
        break
      case 'raise':
      case 'allin':
        st.raises++
        break
    }

    if (context.isVpip) s.vpip++
    if (context.isPfr) s.pfr++

    // Track fold-to-cbet
    if (context.isFacingCbet) {
      s.foldToCbetOpportunities++
      if (action === 'fold') {
        s.foldToCbetCount++
      }
    }
  }

  recordCbetOpportunity(playerId: string, didCbet: boolean): void {
    const s = this.getOrCreate(playerId)
    s.cbetOpportunities++
    if (didCbet) s.cbets++
  }

  recordShowdown(playerIds: string[]): void {
    for (const pid of playerIds) {
      this.getOrCreate(pid).wtsdCount++
    }
  }

  recordSawFlop(playerIds: string[]): void {
    for (const pid of playerIds) {
      this.getOrCreate(pid).wtsdOpportunities++
    }
  }

  getProfile(playerId: string): OpponentProfile | undefined {
    const s = this.stats.get(playerId)
    if (!s) return undefined
    return getProfile(s)
  }

  computeExploit(playerId: string): ExploitDeltas | undefined {
    const profile = this.getProfile(playerId)
    if (!profile) return undefined
    return computeExploit(profile)
  }
}
