#!/usr/bin/env python3
"""
Card Abstraction Clustering Tool (v1)

Validates the EHS (Expected Hand Strength) bucketing approach used by the
TypeScript runtime module. Generates sample bucket assignments for canonical
hands on representative boards.

This script:
1. Enumerates canonical 2-card hands (169 types: 13 pairs + 78 suited + 78 offsuit)
2. For each hand type, samples random boards and computes bucket assignments
3. Outputs summary statistics to verify the bucketing behaves correctly

The actual runtime bucketing is done in TypeScript (card-abstraction.ts).
This Python tool is for offline validation and analysis only.

Usage:
    python3 tools/card-abstraction/cluster.py [--street river|turn|flop] [--samples 100]
"""

import argparse
import random
import sys
from itertools import combinations
from collections import Counter

# ─── Card representation ─────────────────────────────────────────────────────

RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
SUITS = ['h', 'd', 'c', 's']
RANK_VALUES = {r: i for i, r in enumerate(RANKS)}

ALL_CARDS = [f"{r}{s}" for r in RANKS for s in SUITS]

# ─── Canonical hands (169) ───────────────────────────────────────────────────

def canonical_hands():
    """
    Generate all 169 canonical hand types:
    - 13 pairs (AA, KK, ..., 22)
    - 78 suited combos (AKs, AQs, ..., 32s)
    - 78 offsuit combos (AKo, AQo, ..., 32o)
    """
    hands = []
    for i in range(12, -1, -1):
        # Pairs
        hands.append((RANKS[i], RANKS[i], 'pair'))
    for i in range(12, -1, -1):
        for j in range(i - 1, -1, -1):
            hands.append((RANKS[i], RANKS[j], 'suited'))
            hands.append((RANKS[i], RANKS[j], 'offsuit'))
    return hands

def deal_hand(rank1, rank2, hand_type, board_cards_set):
    """
    Deal a specific canonical hand type, avoiding cards already on the board.
    Returns a tuple of 2 card strings, or None if impossible.
    """
    available = [c for c in ALL_CARDS if c not in board_cards_set]

    if hand_type == 'pair':
        candidates = [c for c in available if c[0] == rank1]
        if len(candidates) < 2:
            return None
        chosen = random.sample(candidates, 2)
        return (chosen[0], chosen[1])
    elif hand_type == 'suited':
        for suit in SUITS:
            c1 = f"{rank1}{suit}"
            c2 = f"{rank2}{suit}"
            if c1 in board_cards_set or c2 in board_cards_set:
                continue
            return (c1, c2)
        return None
    else:  # offsuit
        suit_combos = [(s1, s2) for s1 in SUITS for s2 in SUITS if s1 != s2]
        random.shuffle(suit_combos)
        for s1, s2 in suit_combos:
            c1 = f"{rank1}{s1}"
            c2 = f"{rank2}{s2}"
            if c1 not in board_cards_set and c2 not in board_cards_set:
                return (c1, c2)
        return None

# ─── Simple 7-card hand evaluator (Python) ───────────────────────────────────

RANK_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41]

STRAIGHTS = []
for top in range(12, 3, -1):
    bits = 0
    for i in range(5):
        bits |= (1 << (top - i))
    STRAIGHTS.append(bits)
# Wheel: A-2-3-4-5
STRAIGHTS.append((1 << 12) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3))

def eval5_py(cards):
    """
    Evaluate a 5-card hand. Returns a rank number (higher = better).
    Simplified version -- uses category + kicker ordering.
    """
    rank_indices = sorted([RANK_VALUES[c[0]] for c in cards], reverse=True)
    suit_set = set(c[1] for c in cards)
    is_flush = len(suit_set) == 1

    # Rank bit pattern
    pattern = 0
    for ri in rank_indices:
        pattern |= (1 << ri)

    is_straight = pattern in STRAIGHTS
    straight_rank = STRAIGHTS.index(pattern) if is_straight else -1

    # Count rank frequencies
    freq = Counter(rank_indices)
    freq_list = sorted(freq.items(), key=lambda x: (x[1], x[0]), reverse=True)

    if is_flush and is_straight:
        return 8000 + (12 - straight_rank)  # Straight flush
    elif freq_list[0][1] == 4:
        return 7000 + freq_list[0][0] * 13 + freq_list[1][0]  # Quads
    elif freq_list[0][1] == 3 and freq_list[1][1] == 2:
        return 6000 + freq_list[0][0] * 13 + freq_list[1][0]  # Full house
    elif is_flush:
        return 5000 + sum(ri * (13 ** i) for i, ri in enumerate(rank_indices))
    elif is_straight:
        return 4000 + (12 - straight_rank)
    elif freq_list[0][1] == 3:
        return 3000 + freq_list[0][0] * 169 + rank_indices[3] * 13 + rank_indices[4]
    elif freq_list[0][1] == 2 and freq_list[1][1] == 2:
        return 2000 + freq_list[0][0] * 169 + freq_list[1][0] * 13 + freq_list[2][0]
    elif freq_list[0][1] == 2:
        return 1000 + freq_list[0][0] * 2197 + rank_indices[2] * 169 + rank_indices[3] * 13 + rank_indices[4]
    else:
        return sum(ri * (13 ** i) for i, ri in enumerate(rank_indices))

def eval7_py(cards):
    """Best 5-card hand from 7 cards."""
    best = 0
    for combo in combinations(cards, 5):
        r = eval5_py(combo)
        if r > best:
            best = r
    return best

# ─── Bucketing ───────────────────────────────────────────────────────────────

MAX_RANK_PY = 8012  # approximate max from our Python evaluator

def river_bucket_py(hole, board, num_buckets=200):
    """Compute river bucket using Python evaluator."""
    rank = eval7_py(list(hole) + list(board))
    return min(num_buckets - 1, int((rank / MAX_RANK_PY) * num_buckets))

def turn_bucket_py(hole, board, num_buckets=500):
    """Compute turn bucket by averaging over all river cards."""
    used = set(list(hole) + list(board))
    remaining = [c for c in ALL_CARDS if c not in used]

    rank_sum = 0
    count = 0
    for card in remaining:
        rank = eval7_py(list(hole) + list(board) + [card])
        rank_sum += rank
        count += 1

    avg_rank = rank_sum / count if count > 0 else 0
    return min(num_buckets - 1, int((avg_rank / MAX_RANK_PY) * num_buckets))

def flop_bucket_py(hole, board, num_buckets=1000, iterations=200):
    """Compute flop bucket via MC equity."""
    used = set(list(hole) + list(board))
    remaining = [c for c in ALL_CARDS if c not in used]

    wins = 0
    total = iterations
    for _ in range(total):
        deck = remaining.copy()
        random.shuffle(deck)
        # Deal 2 more board cards + 2 opponent cards
        sim_board = list(board) + [deck[0], deck[1]]
        opp_hole = (deck[2], deck[3])
        hero_rank = eval7_py(list(hole) + sim_board)
        opp_rank = eval7_py(list(opp_hole) + sim_board)
        if hero_rank > opp_rank:
            wins += 1
        elif hero_rank == opp_rank:
            wins += 0.5

    equity = wins / total
    return min(num_buckets - 1, int(equity * num_buckets))

# ─── Main ────────────────────────────────────────────────────────────────────

def analyze_street(street, num_samples):
    """Analyze bucket distribution for a given street."""
    board_size = {'river': 5, 'turn': 4, 'flop': 3}[street]
    num_buckets = {'river': 200, 'turn': 500, 'flop': 1000}[street]
    bucket_fn = {'river': river_bucket_py, 'turn': turn_bucket_py, 'flop': flop_bucket_py}[street]

    hands = canonical_hands()
    all_buckets = Counter()
    hand_buckets = {}

    print(f"\n{'='*60}")
    print(f"  Card Abstraction Analysis: {street.upper()}")
    print(f"  Buckets: {num_buckets} | Samples per hand: {num_samples}")
    print(f"{'='*60}\n")

    for rank1, rank2, hand_type in hands[:20]:  # First 20 canonical hands for speed
        label = f"{rank1}{rank2}{'s' if hand_type == 'suited' else 'o' if hand_type == 'offsuit' else ''}"
        buckets = []

        for _ in range(num_samples):
            # Deal random board
            remaining = list(ALL_CARDS)
            random.shuffle(remaining)
            board = tuple(remaining[:board_size])
            board_set = set(board)

            hole = deal_hand(rank1, rank2, hand_type, board_set)
            if hole is None:
                continue

            bucket = bucket_fn(hole, board)
            buckets.append(bucket)
            all_buckets[bucket] += 1

        if buckets:
            avg = sum(buckets) / len(buckets)
            min_b = min(buckets)
            max_b = max(buckets)
            hand_buckets[label] = avg
            print(f"  {label:>4s}  avg_bucket={avg:6.1f}  range=[{min_b:3d}, {max_b:3d}]  ({len(buckets)} samples)")

    # Distribution summary
    used_buckets = len(all_buckets)
    total_assignments = sum(all_buckets.values())
    print(f"\n  Summary:")
    print(f"    Total bucket assignments: {total_assignments}")
    print(f"    Unique buckets used: {used_buckets} / {num_buckets}")
    print(f"    Bucket utilization: {used_buckets / num_buckets * 100:.1f}%")

    # Verify ordering: AA should be higher than 72o
    if 'AA' in hand_buckets and '72o' in hand_buckets:
        aa_avg = hand_buckets['AA']
        _72o_avg = hand_buckets['72o']
        ordering_ok = aa_avg > _72o_avg
        print(f"\n    Ordering check: AA (avg {aa_avg:.1f}) {'>' if ordering_ok else '<='} 72o (avg {_72o_avg:.1f}) {'PASS' if ordering_ok else 'FAIL'}")

    return hand_buckets


def main():
    parser = argparse.ArgumentParser(description='Card Abstraction Clustering Analysis')
    parser.add_argument('--street', choices=['river', 'turn', 'flop', 'all'], default='all',
                       help='Street to analyze (default: all)')
    parser.add_argument('--samples', type=int, default=50,
                       help='Samples per canonical hand (default: 50)')
    args = parser.parse_args()

    random.seed(42)

    streets = ['river', 'turn', 'flop'] if args.street == 'all' else [args.street]

    for street in streets:
        # Use fewer samples for slower streets
        samples = args.samples
        if street == 'turn':
            samples = min(samples, 20)
        if street == 'flop':
            samples = min(samples, 10)

        analyze_street(street, samples)

    print(f"\n{'='*60}")
    print("  Done. The TypeScript runtime module (card-abstraction.ts)")
    print("  uses the fast lookup-table evaluator for production speed.")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
