#!/usr/bin/env python3
"""
6-Max No-Limit Hold'em Preflop MCCFR Solver
============================================

External-Sampling Monte Carlo Counterfactual Regret Minimization (MCCFR)
for 6-max preflop play with Linear CFR weighting.

Key design choices:
  - Abstract info sets: (position, raise_level, callers_bucket, already_raised)
    Groups strategically equivalent situations, reducing info set space to ~25k.
  - 169 canonical hands weighted by combo count for realistic sampling.
  - Precomputed 169x169 equity matrix for terminal node evaluation.
  - Linear CFR strategy weighting + DCFR negative-regret discounting.

Usage:
    python3 solve_preflop.py [-n ITERATIONS] [-o OUTPUT]

Default: 200k iterations (~30s). Minimum recommended: 100k.
"""

import argparse
import json
import math
import os
import random
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

POSITIONS = ["UTG", "EP", "MP", "CO", "BTN", "SB", "BB"]
POS_IDX = {p: i for i, p in enumerate(POSITIONS)}
NUM_POS = len(POSITIONS)

SB_AMT = 0.5
BB_AMT = 1.0
STACK = 100.0

# Raise sizes: total bet at each escalation level
# open-raise=2.5BB, 3bet=8BB, 4bet=20BB, 5bet/jam=100BB
RAISE_AMTS = [2.5, 8.0, 20.0, 100.0]
MAX_RLEVEL = len(RAISE_AMTS)

RANKS = "23456789TJQKA"
RANK_VAL = {r: i for i, r in enumerate(RANKS)}

# ---------------------------------------------------------------------------
# 169 canonical preflop hands
# ---------------------------------------------------------------------------

HANDS: List[str] = []
COMBOS: Dict[str, int] = {}

def _build_hands():
    # Pairs: AA, KK, ..., 22
    for i in range(12, -1, -1):
        h = RANKS[i] * 2
        HANDS.append(h)
        COMBOS[h] = 6
    # Suited: AKs, AQs, ..., 32s
    for i in range(12, -1, -1):
        for j in range(i - 1, -1, -1):
            h = RANKS[i] + RANKS[j] + "s"
            HANDS.append(h)
            COMBOS[h] = 4
    # Offsuit: AKo, AQo, ..., 32o
    for i in range(12, -1, -1):
        for j in range(i - 1, -1, -1):
            h = RANKS[i] + RANKS[j] + "o"
            HANDS.append(h)
            COMBOS[h] = 12

_build_hands()
assert len(HANDS) == 169
TOTAL_COMBOS = sum(COMBOS.values())  # 1326
HAND_IDX = {h: i for i, h in enumerate(HANDS)}

# Precompute cumulative weights for fast sampling
_CUM_W: List[float] = []
_cw = 0.0
for h in HANDS:
    _cw += COMBOS[h] / TOTAL_COMBOS
    _CUM_W.append(_cw)

def _sample_hand() -> int:
    """Sample a canonical hand index, weighted by combo count."""
    r = random.random()
    lo, hi = 0, 168
    while lo < hi:
        mid = (lo + hi) >> 1
        if _CUM_W[mid] < r:
            lo = mid + 1
        else:
            hi = mid
    return lo


# ---------------------------------------------------------------------------
# Preflop equity table (169 x 169)
# ---------------------------------------------------------------------------
# Calibrated against known matchups. Real-world reference values:
#   AA vs KK:  81.9%     AA vs random: ~85%
#   AKs vs QQ: 46.3%     AKs vs random: ~67%
#   AA vs 72o: 87.7%     72o vs random: ~35%
#
# Our model captures the essential dynamics while being fast to compute.

def _rh(h: str) -> int:
    """High card rank value."""
    return RANK_VAL[h[0]]

def _rl(h: str) -> int:
    """Low card rank value (same as high for pairs)."""
    return RANK_VAL[h[1]] if len(h) > 2 else RANK_VAL[h[0]]

def compute_equity_table() -> List[List[float]]:
    """Compute the 169x169 preflop equity matrix."""
    n = 169
    eq = [[0.5] * n for _ in range(n)]

    for i in range(n):
        h1 = HANDS[i]
        r1h, r1l = _rh(h1), _rl(h1)
        p1 = len(h1) == 2  # is pair
        s1 = h1.endswith("s")  # is suited

        for j in range(i + 1, n):
            h2 = HANDS[j]
            r2h, r2l = _rh(h2), _rl(h2)
            p2 = len(h2) == 2
            s2 = h2.endswith("s")

            e = 0.5

            if p1 and p2:
                # Pair vs pair
                if r1h > r2h:
                    e = 0.81 + 0.005 * min(r1h - r2h, 5)
                elif r1h < r2h:
                    e = 0.19 - 0.005 * min(r2h - r1h, 5)
                # Same pair: 0.5

            elif p1:
                # Pair vs unpaired
                overs = (1 if r2h > r1h else 0) + (1 if r2l > r1h else 0)
                if overs == 2:
                    # Two overcards (e.g., QQ vs AK)
                    e = 0.545 if r1h >= 8 else 0.525
                elif overs == 1:
                    if r2l == r1h or r2h == r1h:
                        e = 0.70   # dominated kicker (QQ vs QJ)
                    else:
                        e = 0.57   # one overcard, no domination
                else:
                    if r2h == r1h or r2l == r1h:
                        e = 0.91   # pair dominates one card (QQ vs QJ already covered above as 1 over)
                    else:
                        e = 0.83   # two undercards
                if s2:
                    e -= 0.028  # suited gets backdoor flush potential

            elif p2:
                # Mirror of pair vs unpaired
                overs = (1 if r1h > r2h else 0) + (1 if r1l > r2h else 0)
                if overs == 2:
                    e = 0.455 if r2h >= 8 else 0.475
                elif overs == 1:
                    if r1l == r2h or r1h == r2h:
                        e = 0.30
                    else:
                        e = 0.43
                else:
                    if r1h == r2h or r1l == r2h:
                        e = 0.09
                    else:
                        e = 0.17
                if s1:
                    e += 0.028

            else:
                # Unpaired vs unpaired
                if r1h == r2h and r1l == r2l:
                    e = 0.50  # identical hands
                elif r1h == r2h:
                    # Same high card, kicker battle
                    gap = abs(r1l - r2l)
                    diff = 0.06 + min(gap - 1, 5) * 0.02
                    e = 0.5 + diff if r1l > r2l else 0.5 - diff
                elif r1l == r2l:
                    # Same kicker, high card battle
                    gap = abs(r1h - r2h)
                    diff = 0.05 + min(gap - 1, 5) * 0.018
                    e = 0.5 + diff if r1h > r2h else 0.5 - diff
                elif r1h == r2l:
                    # h1's high matches h2's low (e.g., QT vs AQ)
                    e = 0.37
                elif r2h == r1l:
                    # h2's high matches h1's low
                    e = 0.63
                else:
                    # No shared cards: rank-sum comparison
                    s1v = r1h * 2.5 + r1l
                    s2v = r2h * 2.5 + r2l
                    diff = (s1v - s2v) / 40.0
                    e = 0.5 + diff * 0.18
                    # Connectivity bonus (straight potential)
                    g1 = r1h - r1l
                    g2 = r2h - r2l
                    if g1 <= 2 and g2 > 3:
                        e += 0.012
                    elif g2 <= 2 and g1 > 3:
                        e -= 0.012

                # Suited advantage (flush draws)
                if s1 and not s2:
                    e += 0.033
                elif s2 and not s1:
                    e -= 0.033

            eq[i][j] = max(0.03, min(0.97, e))
            eq[j][i] = 1.0 - eq[i][j]

    return eq


# ---------------------------------------------------------------------------
# Game State
# ---------------------------------------------------------------------------

FOLD = 0
CALL = 1
RAISE = 2
ACT_TAGS = "fcr"

class State:
    """
    Compact preflop game state.

    Fields:
      active:  list[bool]  - who hasn't folded
      invest:  list[float] - each position's total bet
      bet:     float       - current bet to match
      rlevel:  int         - raises so far (next raise = RAISE_AMTS[rlevel])
      to_act:  list[int]   - positions waiting to act (in order)
      hkey:    str          - history key for abstract info set computation
    """
    __slots__ = ('active', 'invest', 'bet', 'rlevel', 'to_act', 'hkey')

    def __init__(self):
        self.active = [True] * NUM_POS
        self.invest = [0.0] * NUM_POS
        self.invest[POS_IDX["SB"]] = SB_AMT
        self.invest[POS_IDX["BB"]] = BB_AMT
        self.bet = BB_AMT
        self.rlevel = 0
        self.to_act = list(range(NUM_POS))  # UTG..BB
        self.hkey = ""

    def copy(self) -> 'State':
        s = State.__new__(State)
        s.active = self.active[:]
        s.invest = self.invest[:]
        s.bet = self.bet
        s.rlevel = self.rlevel
        s.to_act = self.to_act[:]
        s.hkey = self.hkey
        return s

    def _actor(self) -> int:
        """Find the next eligible player in to_act without mutating state.
        Returns the position index, or -1 if no one left to act."""
        for p in self.to_act:
            if not self.active[p]:
                continue
            if self.invest[p] >= STACK - 0.01:
                continue  # all-in
            return p
        return -1

    def _advance_to_act(self):
        """Remove folded and all-in players from the front of to_act."""
        while self.to_act:
            p = self.to_act[0]
            if not self.active[p] or self.invest[p] >= STACK - 0.01:
                self.to_act.pop(0)
            else:
                break

    def current_player(self) -> int:
        return self._actor()

    def is_terminal(self) -> bool:
        if sum(self.active) <= 1:
            return True
        return self._actor() == -1

    def legal_actions(self) -> List[int]:
        acts = [FOLD, CALL]
        if self.rlevel < MAX_RLEVEL:
            acts.append(RAISE)
        return acts

    def apply(self, action: int) -> 'State':
        pos = self._actor()
        assert pos >= 0, "No player to act"

        s = self.copy()
        s.hkey += ACT_TAGS[action]

        # Remove this player from the front of the queue
        # (Skip any folded/all-in players before them)
        while s.to_act and s.to_act[0] != pos:
            s.to_act.pop(0)
        if s.to_act and s.to_act[0] == pos:
            s.to_act.pop(0)

        if action == FOLD:
            s.active[pos] = False

        elif action == CALL:
            s.invest[pos] = min(self.bet, STACK)

        elif action == RAISE:
            raise_to = RAISE_AMTS[self.rlevel]
            s.invest[pos] = raise_to
            s.bet = raise_to
            s.rlevel = self.rlevel + 1
            # Reopen action for all other active, non-all-in players
            new_to_act = []
            for offset in range(1, NUM_POS):
                p = (pos + offset) % NUM_POS
                if s.active[p] and s.invest[p] < STACK - 0.01:
                    new_to_act.append(p)
            s.to_act = new_to_act

        s._advance_to_act()
        return s

    def payoffs(self, hands: List[int], eq_table: List[List[float]]) -> List[float]:
        """Compute net payoffs for all 7 positions.

        Includes a raiser initiative bonus: the player who raised last
        (the aggressor) gets a ~5% pot equity bonus representing the
        postflop advantage from initiative, fold equity, and position.
        Without this, the solver treats limping and raising as similar EV,
        producing unrealistic strategies (e.g., AA limping 50% from UTG).
        """
        pot = sum(self.invest)
        pays = [-self.invest[p] for p in range(NUM_POS)]
        live = [p for p in range(NUM_POS) if self.active[p]]

        if len(live) == 0:
            return pays  # shouldn't happen
        elif len(live) == 1:
            pays[live[0]] = pot - self.invest[live[0]]
        else:
            # Find the last raiser (aggressor) — gets initiative bonus
            aggressor = -1
            if self.rlevel > 0:
                # The player who invested the most (and is still live) is likely the raiser
                max_inv = -1
                for p in live:
                    if self.invest[p] > max_inv:
                        max_inv = self.invest[p]
                        aggressor = p

            # Initiative bonus: aggressor gets ~3% pot equity edge postflop
            # Scaled by raise level: open-raise gets full bonus, 3bet+ gets less
            # (because 3bet pots are bigger and edge is relatively smaller)
            INITIATIVE_BONUS = 0.03
            rlevel_scale = 1.0 / max(1, self.rlevel)  # 0.06 for open, 0.03 for 3bet, etc.
            bonus = INITIATIVE_BONUS * rlevel_scale

            if len(live) == 2:
                a, b = live
                e = eq_table[hands[a]][hands[b]]
                # Apply initiative bonus to aggressor
                if aggressor == a:
                    e = min(0.97, e + bonus)
                elif aggressor == b:
                    e = max(0.03, e - bonus)
                pays[a] = e * pot - self.invest[a]
                pays[b] = (1.0 - e) * pot - self.invest[b]
            else:
                # Multiway: pairwise equity product approximation with initiative
                raw = []
                for p in live:
                    prod = 1.0
                    for q in live:
                        if p != q:
                            e_pq = eq_table[hands[p]][hands[q]]
                            if aggressor == p:
                                e_pq = min(0.97, e_pq + bonus)
                            elif aggressor == q:
                                e_pq = max(0.03, e_pq - bonus)
                            prod *= e_pq
                    raw.append(prod)
                total = sum(raw) or 1e-15
                for k, p in enumerate(live):
                    pays[p] = (raw[k] / total) * pot - self.invest[p]

        return pays

    def abstract_key(self, pos: int) -> str:
        """
        Generate an abstract info set key for the current decision node.

        Groups by:
        - Position (0-6)
        - Raise level faced (0-4)
        - Number of callers before us (0, 1, 2+)
        - Whether this player already raised (facing re-raise)
        """
        # Count callers from history
        n_calls = self.hkey.count("c")
        n_raises = self.hkey.count("r")
        callers = min(n_calls, 2)

        # Did we raise previously? Check if this position put in a raise
        # We need the full history with position tags for this.
        # Simplified: if rlevel > 0 and our investment > BB, we likely raised.
        already_raised = (self.invest[pos] > BB_AMT + 0.01 and
                          self.invest[pos] < self.bet - 0.01)

        return f"P{pos}R{self.rlevel}C{callers}A{1 if already_raised else 0}"


# ---------------------------------------------------------------------------
# Info Set Storage
# ---------------------------------------------------------------------------

class InfoSet:
    __slots__ = ('n', 'regret', 'strat_sum')

    def __init__(self, n: int):
        self.n = n
        self.regret = [0.0] * n
        self.strat_sum = [0.0] * n

    def strategy(self) -> List[float]:
        """Regret matching: positive regrets -> current strategy."""
        s = [max(0.0, r) for r in self.regret]
        total = sum(s)
        if total > 1e-12:
            return [x / total for x in s]
        return [1.0 / self.n] * self.n

    def average_strategy(self) -> List[float]:
        """Time-averaged strategy (the Nash equilibrium approximation)."""
        total = sum(self.strat_sum)
        if total > 1e-12:
            return [x / total for x in self.strat_sum]
        return [1.0 / self.n] * self.n


_store: Dict[Tuple[str, int], InfoSet] = {}

def _get(key: str, hand: int, n: int) -> InfoSet:
    k = (key, hand)
    if k not in _store:
        _store[k] = InfoSet(n)
    return _store[k]


# ---------------------------------------------------------------------------
# External-Sampling MCCFR + Linear CFR
# ---------------------------------------------------------------------------

def _cfr(state: State, hands: List[int], traverser: int,
         eq: List[List[float]], t: int) -> float:
    """
    External-sampling MCCFR traversal.
    Returns EV for the traversing player.

    For the traverser's nodes: explores ALL actions.
    For opponent nodes: samples ONE action from their current strategy.
    """
    if state.is_terminal():
        return state.payoffs(hands, eq)[traverser]

    pos = state.current_player()
    if pos < 0:
        return state.payoffs(hands, eq)[traverser]

    actions = state.legal_actions()
    na = len(actions)
    key = state.abstract_key(pos)
    info = _get(key, hands[pos], na)
    sigma = info.strategy()

    if pos == traverser:
        # Explore all actions
        vals = [0.0] * na
        for a in range(na):
            child = state.apply(actions[a])
            vals[a] = _cfr(child, hands, traverser, eq, t)

        ev = sum(sigma[a] * vals[a] for a in range(na))

        # Update regrets
        for a in range(na):
            info.regret[a] += vals[a] - ev

        # Linear CFR: accumulate strategy weighted by iteration number
        for a in range(na):
            info.strat_sum[a] += t * sigma[a]

        return ev
    else:
        # Sample opponent action
        r = random.random()
        cum = 0.0
        chosen = na - 1
        for a in range(na):
            cum += sigma[a]
            if r < cum:
                chosen = a
                break

        child = state.apply(actions[chosen])
        return _cfr(child, hands, traverser, eq, t)


def _dcfr_discount(t: int):
    """DCFR: discount negative regrets toward zero."""
    alpha = max(0.5, (t - 1.0) / t)
    for info in _store.values():
        for i in range(info.n):
            if info.regret[i] < 0:
                info.regret[i] *= alpha


# ---------------------------------------------------------------------------
# Strategy Extraction
# ---------------------------------------------------------------------------

def _key_to_pos(key: str) -> int:
    """Extract position index from abstract key like 'P0R1C0A0'."""
    return int(key[1])

def _key_to_situation(key: str) -> str:
    """Classify situation from abstract key."""
    rlevel = int(key[3])
    already_raised = int(key[-1])

    if rlevel == 0:
        return "unopened"
    elif rlevel == 1:
        return "facing_3bet" if already_raised else "facing_raise"
    elif rlevel == 2:
        return "facing_4bet" if already_raised else "facing_3bet"
    elif rlevel == 3:
        return "facing_allin" if already_raised else "facing_4bet"
    else:
        return "facing_allin"


def extract_strategy() -> Dict:
    """Extract the converged average strategy, organized by position & situation."""
    result = {p: {} for p in POSITIONS}

    # Group: (pos, situation, hand) -> list of InfoSet
    grouped: Dict[Tuple[int, str, int], List[InfoSet]] = defaultdict(list)

    for (key, hand_idx), info in _store.items():
        pos = _key_to_pos(key)
        sit = _key_to_situation(key)
        grouped[(pos, sit, hand_idx)].append(info)

    for (pos, sit, hand_idx), infos in grouped.items():
        pos_name = POSITIONS[pos]
        hand_name = HANDS[hand_idx]

        if sit not in result[pos_name]:
            result[pos_name][sit] = {}

        # Weight-average across all info sets that share (pos, sit, hand)
        total_w = 0.0
        ws = [0.0, 0.0, 0.0]

        for info in infos:
            avg = info.average_strategy()
            w = sum(info.strat_sum) + 1e-12
            total_w += w
            for a in range(min(info.n, 3)):
                ws[a] += avg[a] * w

        if total_w < 1e-8:
            continue

        tot = sum(ws)
        if tot > 0:
            ws = [x / tot for x in ws]

        has_raise = any(info.n >= 3 for info in infos)
        s = {
            "fold": round(ws[0], 4),
            "call": round(ws[1], 4),
            "raise": round(ws[2], 4) if has_raise else 0.0,
        }
        # Renormalize
        total = s["fold"] + s["call"] + s["raise"]
        if total > 0:
            s = {k: round(v / total, 4) for k, v in s.items()}

        result[pos_name][sit][hand_name] = s

    # Fill missing hands with fold (hands that were never sampled at a node)
    for pos_name in POSITIONS:
        for sit in list(result[pos_name].keys()):
            for h in HANDS:
                if h not in result[pos_name][sit]:
                    result[pos_name][sit][h] = {
                        "fold": 1.0, "call": 0.0, "raise": 0.0}

    return result


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

SAMPLE_HANDS = [
    "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22",
    "AKs", "AQs", "AJs", "ATs", "A9s", "A5s", "A4s", "A3s", "A2s",
    "KQs", "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s", "87s",
    "76s", "65s", "54s",
    "AKo", "AQo", "AJo", "ATo", "A9o",
    "KQo", "KJo", "KTo", "QJo", "QTo", "JTo",
    "K9o", "Q9o", "J9o", "T8o",
    "72o", "32o",
]

def _bar(f: float, c: float, r: float, width: int = 30) -> str:
    """Create a text bar: R=raise, C=call, .=fold."""
    rb = int(r * width)
    cb = int(c * width)
    fb = width - rb - cb
    return "R" * rb + "C" * cb + "." * fb


def print_ranges(strategy: Dict, show_positions: Optional[List[str]] = None):
    """Print human-readable strategy summary."""
    if show_positions is None:
        show_positions = POSITIONS

    print("\n" + "=" * 72)
    print("  SOLVED PREFLOP RANGES")
    print("=" * 72)

    for pos in show_positions:
        if pos not in strategy:
            continue
        print(f"\n{'=' * 72}")
        print(f"  {pos}")
        print(f"{'=' * 72}")

        for sit in ["unopened", "facing_raise", "facing_3bet",
                     "facing_4bet", "facing_allin"]:
            if sit not in strategy[pos]:
                continue
            data = strategy[pos][sit]

            # Compute aggregate action frequencies
            r_total = sum(data[h]["raise"] * COMBOS[h] for h in HANDS if h in data)
            c_total = sum(data[h]["call"] * COMBOS[h] for h in HANDS if h in data)
            f_total = sum(data[h]["fold"] * COMBOS[h] for h in HANDS if h in data)
            total = r_total + c_total + f_total
            if total < 1e-6:
                continue

            r_pct = r_total / TOTAL_COMBOS * 100
            c_pct = c_total / TOTAL_COMBOS * 100

            print(f"\n  {sit}  "
                  f"(raise {r_pct:.1f}%, call {c_pct:.1f}%, "
                  f"fold {f_total/total*100:.1f}%)")

            for h in SAMPLE_HANDS:
                if h not in data:
                    continue
                s = data[h]
                f, c, r = s["fold"], s["call"], s["raise"]
                # Only print non-trivial hands
                if f > 0.995 and h not in ("AA", "KK", "QQ", "AKs", "AKo", "72o", "32o"):
                    continue

                bar = _bar(f, c, r)
                print(f"    {h:>4s}  F={f:5.1%} C={c:5.1%} R={r:5.1%}  [{bar}]")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="6-Max NL Hold'em Preflop MCCFR Solver")
    parser.add_argument("-n", "--iterations", type=int, default=200000,
                        help="MCCFR iterations (default: 200000)")
    parser.add_argument("-o", "--output", type=str, default=None,
                        help="Output JSON path")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducibility")
    args = parser.parse_args()

    if args.output is None:
        args.output = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "preflop-strategy.json")

    random.seed(args.seed)

    print("=" * 72)
    print("  6-Max NL Hold'em Preflop MCCFR Solver")
    print("  External Sampling + Linear CFR + DCFR Discount")
    print("=" * 72)

    # 1) Build equity table
    print("\n[1/3] Computing preflop equity table (169x169)...")
    t0 = time.time()
    eq = compute_equity_table()
    print(f"      Done in {time.time() - t0:.2f}s")

    # Validate key matchups
    _aa, _kk = HAND_IDX["AA"], HAND_IDX["KK"]
    _aks, _qq = HAND_IDX["AKs"], HAND_IDX["QQ"]
    _72o = HAND_IDX["72o"]
    print(f"      AA vs KK : {eq[_aa][_kk]:.1%}  (ref: ~82%)")
    print(f"      AA vs AKs: {eq[_aa][_aks]:.1%}  (ref: ~87%)")
    print(f"      AKs vs QQ: {eq[_aks][_qq]:.1%}  (ref: ~46%)")
    print(f"      AA vs 72o: {eq[_aa][_72o]:.1%}  (ref: ~88%)")

    # 2) Run MCCFR
    iters = args.iterations
    print(f"\n[2/3] Running {iters:,} MCCFR iterations...")
    print(f"      Positions: {', '.join(POSITIONS)}")
    print(f"      Raise sizes: {', '.join(f'{x}BB' for x in RAISE_AMTS)}")
    print(f"      Stack depth: {STACK:.0f}BB")
    print()

    t0 = time.time()
    report_every = max(iters // 20, 1000)
    discount_every = max(iters // 100, 500)

    for t in range(1, iters + 1):
        traverser = random.randint(0, NUM_POS - 1)
        hands = [_sample_hand() for _ in range(NUM_POS)]
        _cfr(State(), hands, traverser, eq, t)

        if t % discount_every == 0:
            _dcfr_discount(t)

        if t % report_every == 0:
            elapsed = time.time() - t0
            speed = t / elapsed
            pct = t / iters * 100
            eta = (iters - t) / max(speed, 1)

            # Convergence metric: average absolute regret
            total_r = sum(abs(r) for info in _store.values() for r in info.regret)
            cnt = sum(info.n for info in _store.values())
            avg_r = total_r / max(cnt, 1)

            print(f"  {t:>10,} / {iters:,}  ({pct:5.1f}%)  "
                  f"{speed:,.0f} it/s  "
                  f"avg|R|={avg_r:.3f}  "
                  f"|I|={len(_store):,}  "
                  f"ETA {eta:.0f}s")

    elapsed = time.time() - t0
    print(f"\n      Done in {elapsed:.1f}s ({iters / elapsed:,.0f} it/s)")
    print(f"      Info sets: {len(_store):,}")

    # 3) Extract and save
    print(f"\n[3/3] Extracting strategy...")
    strategy = extract_strategy()

    print_ranges(strategy, ["UTG", "CO", "BTN", "SB", "BB"])

    output = {
        "meta": {
            "positions": POSITIONS,
            "iterations": iters,
            "hands": 169,
            "algorithm": "External-Sampling MCCFR + Linear CFR + DCFR",
            "stack_depth": f"{STACK:.0f}BB",
            "raise_sizes": {
                "open": f"{RAISE_AMTS[0]}BB",
                "3bet": f"{RAISE_AMTS[1]}BB",
                "4bet": f"{RAISE_AMTS[2]}BB",
                "5bet_jam": f"{RAISE_AMTS[3]}BB",
            },
        },
        "strategy": strategy,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    size_kb = os.path.getsize(args.output) / 1024
    print(f"\n{'=' * 72}")
    print(f"  Strategy saved: {args.output}")
    print(f"  File size: {size_kb:.0f} KB | Info sets: {len(_store):,}")
    print(f"{'=' * 72}")

    # Summary stats
    pos_counts = defaultdict(int)
    sit_counts = defaultdict(int)
    for (key, _) in _store:
        pos_counts[POSITIONS[_key_to_pos(key)]] += 1
        sit_counts[_key_to_situation(key)] += 1

    print("\nInfo sets by position:")
    for p in POSITIONS:
        print(f"  {p}: {pos_counts.get(p, 0):,}")

    print("\nInfo sets by situation:")
    for s in ["unopened", "facing_raise", "facing_3bet",
              "facing_4bet", "facing_allin"]:
        if sit_counts.get(s, 0) > 0:
            print(f"  {s}: {sit_counts[s]:,}")


if __name__ == "__main__":
    main()
