import { describe, it, expect } from 'vitest'
import {
  createEmptyStats,
  getProfile,
  computeExploit,
  OpponentTracker,
} from '../strategy/opponent-model'

describe('opponent-model', () => {
  // ── createEmptyStats ──────────────────────────────────────────────
  describe('createEmptyStats', () => {
    it('returns all counters at 0 with matching playerId', () => {
      const stats = createEmptyStats('player-1')
      expect(stats.playerId).toBe('player-1')
      expect(stats.hands).toBe(0)
      expect(stats.vpip).toBe(0)
      expect(stats.pfr).toBe(0)
      expect(stats.cbetOpportunities).toBe(0)
      expect(stats.cbets).toBe(0)
      expect(stats.foldToCbetOpportunities).toBe(0)
      expect(stats.foldToCbetCount).toBe(0)
      expect(stats.wtsdOpportunities).toBe(0)
      expect(stats.wtsdCount).toBe(0)
      for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
        expect(stats.streets[street]).toEqual({
          bets: 0,
          checks: 0,
          calls: 0,
          raises: 0,
          folds: 0,
        })
      }
    })
  })

  // ── getProfile ────────────────────────────────────────────────────
  describe('getProfile', () => {
    it('computes vpipRate and pfrRate from raw counters', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 12
      stats.pfr = 6
      const profile = getProfile(stats)
      expect(profile.hands).toBe(20)
      expect(profile.vpipRate).toBeCloseTo(0.6)
      expect(profile.pfrRate).toBeCloseTo(0.3)
    })

    it('computes per-street AF correctly', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.streets.flop.raises = 10
      stats.streets.flop.calls = 5
      const profile = getProfile(stats)
      expect(profile.streetAF.flop).toBeCloseTo(2.0)
    })

    it('defaults cbetRate to 0.50 when fewer than 3 opportunities', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 10
      stats.cbetOpportunities = 1
      stats.cbets = 1
      const profile = getProfile(stats)
      expect(profile.cbetRate).toBeCloseTo(0.5)
    })

    it('uses actual cbetRate when enough samples', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.cbetOpportunities = 10
      stats.cbets = 7
      const profile = getProfile(stats)
      expect(profile.cbetRate).toBeCloseTo(0.7)
    })

    it('defaults foldToCbetRate to 0.40 when fewer than 3 opportunities', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 10
      stats.foldToCbetOpportunities = 2
      stats.foldToCbetCount = 2
      const profile = getProfile(stats)
      expect(profile.foldToCbetRate).toBeCloseTo(0.4)
    })

    it('defaults wtsdRate to 0.25 when fewer than 3 opportunities', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 10
      stats.wtsdOpportunities = 1
      stats.wtsdCount = 1
      const profile = getProfile(stats)
      expect(profile.wtsdRate).toBeCloseTo(0.25)
    })

    it('computes overall AF as totalAgg / totalPass', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.streets.preflop.raises = 4
      stats.streets.flop.raises = 6
      stats.streets.turn.raises = 2
      stats.streets.river.raises = 0
      // total agg = 12
      stats.streets.preflop.calls = 3
      stats.streets.flop.calls = 3
      stats.streets.turn.calls = 2
      stats.streets.river.calls = 0
      // total pass = 8
      const profile = getProfile(stats)
      expect(profile.af).toBeCloseTo(1.5)
    })
  })

  // ── computeExploit ────────────────────────────────────────────────
  describe('computeExploit', () => {
    it('returns all zeros when hands < 8', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 5
      const profile = getProfile(stats)
      const exploit = computeExploit(profile)
      expect(exploit.aggressionDelta).toBe(0)
      expect(exploit.bluffDelta).toBe(0)
      expect(exploit.slowplayDelta).toBe(0)
      expect(exploit.checkRaiseDelta).toBe(0)
      expect(exploit.callThresholdDelta).toBe(0)
    })

    it('identifies calling station (vpipRate > 0.55, af < 0.8)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 14 // vpipRate = 0.70
      stats.streets.flop.raises = 1
      stats.streets.flop.calls = 10 // af will be low
      const profile = getProfile(stats)
      expect(profile.vpipRate).toBeGreaterThan(0.55)
      expect(profile.af).toBeLessThan(0.8)
      const exploit = computeExploit(profile)
      expect(exploit.aggressionDelta).toBeCloseTo(0.12)
      expect(exploit.bluffDelta).toBeCloseTo(-0.06)
    })

    it('identifies nit (vpipRate < 0.25)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 4 // vpipRate = 0.20
      // Need AF >= 0.8 to avoid passive trigger too
      stats.streets.preflop.raises = 4
      stats.streets.preflop.calls = 2
      const profile = getProfile(stats)
      expect(profile.vpipRate).toBeLessThan(0.25)
      const exploit = computeExploit(profile)
      expect(exploit.bluffDelta).toBeCloseTo(0.08)
      expect(exploit.aggressionDelta).toBeCloseTo(0.08)
    })

    it('identifies passive player (af < 0.8, vpipRate <= 0.55)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 8 // vpipRate = 0.40
      stats.streets.flop.raises = 1
      stats.streets.flop.calls = 10 // low AF
      const profile = getProfile(stats)
      expect(profile.af).toBeLessThan(0.8)
      expect(profile.vpipRate).toBeLessThanOrEqual(0.55)
      const exploit = computeExploit(profile)
      // passive: agg +0.05, bluff +0.05
      expect(exploit.aggressionDelta).toBeGreaterThanOrEqual(0.05)
      expect(exploit.bluffDelta).toBeGreaterThanOrEqual(0.05)
    })

    it('identifies aggro player (af > 2.5)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 10
      stats.streets.flop.raises = 15
      stats.streets.flop.calls = 2 // af = 7.5
      const profile = getProfile(stats)
      expect(profile.af).toBeGreaterThan(2.5)
      const exploit = computeExploit(profile)
      expect(exploit.slowplayDelta).toBeCloseTo(0.12)
      expect(exploit.checkRaiseDelta).toBeCloseTo(0.10)
    })

    it('identifies high fold-to-cbet (foldToCbetRate > 0.6)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 10
      stats.streets.preflop.raises = 5
      stats.streets.preflop.calls = 5 // af = 1.0
      stats.foldToCbetOpportunities = 10
      stats.foldToCbetCount = 8 // foldToCbetRate = 0.80
      const profile = getProfile(stats)
      expect(profile.foldToCbetRate).toBeGreaterThan(0.6)
      const exploit = computeExploit(profile)
      expect(exploit.aggressionDelta).toBeCloseTo(0.08)
      expect(exploit.bluffDelta).toBeCloseTo(0.04)
    })

    it('identifies low fold-to-cbet (foldToCbetRate < 0.3)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 10
      stats.streets.preflop.raises = 5
      stats.streets.preflop.calls = 5
      stats.foldToCbetOpportunities = 10
      stats.foldToCbetCount = 2 // foldToCbetRate = 0.20
      const profile = getProfile(stats)
      expect(profile.foldToCbetRate).toBeLessThan(0.3)
      const exploit = computeExploit(profile)
      expect(exploit.bluffDelta).toBeCloseTo(-0.04)
      expect(exploit.callThresholdDelta).toBeCloseTo(-0.03)
    })

    it('identifies high WTSD (wtsdRate > 0.35)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 10
      stats.streets.preflop.raises = 5
      stats.streets.preflop.calls = 5
      stats.wtsdOpportunities = 10
      stats.wtsdCount = 5 // wtsdRate = 0.50
      const profile = getProfile(stats)
      expect(profile.wtsdRate).toBeGreaterThan(0.35)
      const exploit = computeExploit(profile)
      expect(exploit.aggressionDelta).toBeCloseTo(0.06)
      expect(exploit.bluffDelta).toBeCloseTo(-0.04)
      expect(exploit.callThresholdDelta).toBeCloseTo(-0.04)
    })

    it('per-street exploit: bluff-then-give-up (flop AF > 2.5, turn AF < 0.8)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 10
      stats.streets.preflop.raises = 5
      stats.streets.preflop.calls = 5
      stats.streets.flop.raises = 10
      stats.streets.flop.calls = 2 // flop AF = 5.0
      stats.streets.turn.raises = 1
      stats.streets.turn.calls = 5 // turn AF = 0.2
      const profile = getProfile(stats)
      expect(profile.streetAF.flop).toBeGreaterThan(2.5)
      expect(profile.streetAF.turn).toBeLessThan(0.8)
      const exploit = computeExploit(profile)
      // base aggro (af > 2.5) + bluff-then-give-up
      expect(exploit.aggressionDelta).toBeCloseTo(0.05)
      expect(exploit.callThresholdDelta).toBeCloseTo(-0.04)
    })

    it('per-street exploit: double barrel (turn AF > 2.0, river AF > 2.0)', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 10
      stats.streets.preflop.raises = 5
      stats.streets.preflop.calls = 5
      stats.streets.turn.raises = 8
      stats.streets.turn.calls = 2 // turn AF = 4.0
      stats.streets.river.raises = 6
      stats.streets.river.calls = 2 // river AF = 3.0
      const profile = getProfile(stats)
      expect(profile.streetAF.turn).toBeGreaterThan(2.0)
      expect(profile.streetAF.river).toBeGreaterThan(2.0)
      const exploit = computeExploit(profile)
      // aggro (af > 2.5) triggers too since total raises = 19, calls = 9, af ~2.1
      // Actually let's check: total agg = 5+0+8+6 = 19, total pass = 5+0+2+2 = 9, af = 2.11
      // That's < 2.5, so no aggro trigger
      expect(exploit.callThresholdDelta).toBeCloseTo(0.06)
    })

    it('cumulative: calling station + high WTSD', () => {
      const stats = createEmptyStats('p1')
      stats.hands = 20
      stats.vpip = 14 // vpipRate = 0.70
      stats.streets.flop.raises = 1
      stats.streets.flop.calls = 10
      stats.wtsdOpportunities = 10
      stats.wtsdCount = 5 // wtsdRate = 0.50
      const profile = getProfile(stats)
      const exploit = computeExploit(profile)
      // calling station: agg +0.12, bluff -0.06, callThreshold -0.05
      // passive (af < 0.8, vpipRate > 0.55 so NOT passive, only calling station)
      // high WTSD: agg +0.06, bluff -0.04, callThreshold -0.04
      expect(exploit.aggressionDelta).toBeCloseTo(0.18) // 0.12 + 0.06
      expect(exploit.bluffDelta).toBeCloseTo(-0.10) // -0.06 + -0.04
      expect(exploit.callThresholdDelta).toBeCloseTo(-0.09) // -0.05 + -0.04
    })
  })

  // ── OpponentTracker ───────────────────────────────────────────────
  describe('OpponentTracker', () => {
    it('recordNewHand increments hands', () => {
      const tracker = new OpponentTracker()
      tracker.recordNewHand('p1')
      tracker.recordNewHand('p1')
      tracker.recordNewHand('p1')
      expect(tracker.getStats('p1')!.hands).toBe(3)
    })

    it('recordAction tracks street stats', () => {
      const tracker = new OpponentTracker()
      tracker.recordNewHand('p1')
      tracker.recordAction('p1', 'preflop', 'raise', { isVpip: true, isPfr: true })
      tracker.recordAction('p1', 'flop', 'call', {})
      tracker.recordAction('p1', 'turn', 'check', {})
      tracker.recordAction('p1', 'river', 'fold', {})

      const stats = tracker.getStats('p1')!
      expect(stats.streets.preflop.raises).toBe(1)
      expect(stats.streets.flop.calls).toBe(1)
      expect(stats.streets.turn.checks).toBe(1)
      expect(stats.streets.river.folds).toBe(1)
      expect(stats.vpip).toBe(1)
      expect(stats.pfr).toBe(1)
    })

    it('recordAction maps allin to raises', () => {
      const tracker = new OpponentTracker()
      tracker.recordNewHand('p1')
      tracker.recordAction('p1', 'flop', 'allin', {})
      const stats = tracker.getStats('p1')!
      expect(stats.streets.flop.raises).toBe(1)
    })

    it('recordCbetOpportunity tracks cbet', () => {
      const tracker = new OpponentTracker()
      tracker.recordNewHand('p1')
      tracker.recordCbetOpportunity('p1', true)
      tracker.recordCbetOpportunity('p1', false)
      const stats = tracker.getStats('p1')!
      expect(stats.cbetOpportunities).toBe(2)
      expect(stats.cbets).toBe(1)
    })

    it('recordShowdown tracks WTSD count', () => {
      const tracker = new OpponentTracker()
      tracker.recordNewHand('p1')
      tracker.recordNewHand('p2')
      tracker.recordShowdown(['p1', 'p2'])
      expect(tracker.getStats('p1')!.wtsdCount).toBe(1)
      expect(tracker.getStats('p2')!.wtsdCount).toBe(1)
    })

    it('recordSawFlop tracks WTSD opportunity', () => {
      const tracker = new OpponentTracker()
      tracker.recordNewHand('p1')
      tracker.recordNewHand('p2')
      tracker.recordSawFlop(['p1', 'p2'])
      expect(tracker.getStats('p1')!.wtsdOpportunities).toBe(1)
      expect(tracker.getStats('p2')!.wtsdOpportunities).toBe(1)
    })

    it('getProfile returns undefined for unknown player', () => {
      const tracker = new OpponentTracker()
      expect(tracker.getProfile('unknown')).toBeUndefined()
    })

    it('computeExploit returns undefined for unknown player', () => {
      const tracker = new OpponentTracker()
      expect(tracker.computeExploit('unknown')).toBeUndefined()
    })

    it('full scenario: simulate 10 hands of a calling station', () => {
      const tracker = new OpponentTracker()
      const pid = 'station-bot'

      // Simulate 10 hands where the player calls a lot and rarely raises
      for (let i = 0; i < 10; i++) {
        tracker.recordNewHand(pid)

        // Voluntarily puts chips in preflop most hands (8/10)
        if (i < 8) {
          tracker.recordAction(pid, 'preflop', 'call', { isVpip: true })
        } else {
          tracker.recordAction(pid, 'preflop', 'fold', {})
        }
      }

      // Post-flop: lots of calls, very few raises
      for (let i = 0; i < 8; i++) {
        tracker.recordAction(pid, 'flop', 'call', {})
        tracker.recordAction(pid, 'turn', 'call', {})
      }
      // One raise total
      tracker.recordAction(pid, 'flop', 'raise', {})

      // Saw flop 8 times, went to showdown 5 times
      const flopPlayers = [pid]
      for (let i = 0; i < 8; i++) {
        tracker.recordSawFlop(flopPlayers)
      }
      for (let i = 0; i < 5; i++) {
        tracker.recordShowdown(flopPlayers)
      }

      // Faced cbets 6 times, folded to cbet 1 time
      for (let i = 0; i < 6; i++) {
        tracker.recordAction(pid, 'flop', 'call', { isFacingCbet: true })
      }
      tracker.recordCbetOpportunity(pid, false) // Not the aggressor here
      // Actually, foldToCbet tracking is via recordAction context
      // Let me set up foldToCbet stats directly for clarity
      // The tracker should track foldToCbet in recordAction when isFacingCbet
      // But per spec, recordCbetOpportunity is separate. Let me just verify profile.

      const profile = tracker.getProfile(pid)!
      expect(profile.hands).toBe(10)
      expect(profile.vpipRate).toBeCloseTo(0.8)
      // AF: total raises = 1 (flop), total calls = 8 (flop) + 8 (turn) + 6 (flop facing cbet) = 22
      // Actually the 6 facing cbet calls are also flop calls, so flop calls = 8 + 6 = 14
      // total raises = 1, total calls = 14 + 8 = 22
      // af = 1 / 22 ≈ 0.045
      expect(profile.af).toBeLessThan(0.8)
      expect(profile.vpipRate).toBeGreaterThan(0.55)

      // This should trigger calling station exploit
      const exploit = tracker.computeExploit(pid)!
      expect(exploit.aggressionDelta).toBeGreaterThan(0)
      expect(exploit.bluffDelta).toBeLessThan(0)
    })
  })
})
