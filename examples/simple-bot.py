#!/usr/bin/env python3
"""
Minimal PBP (Poker Bot Protocol) bot example.

Reads JSON messages from stdin, writes actions to stdout.
Implements a simple tight-aggressive strategy:
  - Premium hands (AA, KK, QQ, AKs): raise 3x
  - Decent hands (pairs, suited connectors): call
  - Everything else: fold

This bot also provides debug info for the data-art UI.

Usage:
  chmod +x simple-bot.py
  # Upload via the /bots page or test directly:
  echo '{"type":"action_request","street":"preflop","board":[],"pot":30,"toCall":20,"minRaise":20,"stack":980,"history":[]}' | python3 simple-bot.py
"""

import sys
import json
import random

RANK_ORDER = "23456789TJQKA"

def rank_value(card: str) -> int:
    return RANK_ORDER.index(card[0])

def is_pair(cards: list[str]) -> bool:
    return cards[0][0] == cards[1][0]

def is_suited(cards: list[str]) -> bool:
    return cards[0][1] == cards[1][1]

def hand_strength(cards: list[str]) -> str:
    """Classify starting hand into tiers."""
    r1, r2 = sorted([rank_value(c) for c in cards], reverse=True)
    paired = is_pair(cards)
    suited = is_suited(cards)

    # Premium: AA, KK, QQ, AKs
    if paired and r1 >= 10:  # QQ+
        return "premium"
    if r1 == 12 and r2 == 11 and suited:  # AKs
        return "premium"

    # Strong: JJ, TT, AK, AQs
    if paired and r1 >= 8:  # TT+
        return "strong"
    if r1 == 12 and r2 >= 10:  # AK, AQ
        return "strong"

    # Medium: pairs, suited connectors, suited aces
    if paired:
        return "medium"
    if suited and abs(r1 - r2) == 1 and r1 >= 6:
        return "medium"
    if suited and r1 == 12:  # Axs
        return "medium"

    # Weak: everything else
    return "weak"


hole_cards = None

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        continue

    msg_type = msg.get("type")

    if msg_type == "hole_cards":
        hole_cards = msg["cards"]

    elif msg_type == "action_request":
        to_call = msg["toCall"]
        min_raise = msg["minRaise"]
        stack = msg["stack"]
        pot = msg["pot"]
        street = msg["street"]

        # Default: fold
        action = {"action": "fold"}
        debug = {"reasoning": "Weak hand, folding"}

        if hole_cards and street == "preflop":
            tier = hand_strength(hole_cards)

            if tier == "premium":
                raise_to = min(to_call + min_raise * 3, stack)
                action = {"action": "raise", "amount": raise_to}
                debug = {
                    "equity": 0.75 + random.uniform(-0.05, 0.05),
                    "ev": round(pot * 0.3, 1),
                    "foldFreq": 0.0,
                    "callFreq": 0.1,
                    "raiseFreq": 0.9,
                    "reasoning": f"Premium hand, 3-bet",
                }
            elif tier == "strong":
                if to_call <= pot * 0.5:
                    action = {"action": "raise", "amount": min(to_call + min_raise * 2, stack)}
                    debug = {
                        "equity": 0.60 + random.uniform(-0.05, 0.05),
                        "ev": round(pot * 0.15, 1),
                        "foldFreq": 0.05,
                        "callFreq": 0.3,
                        "raiseFreq": 0.65,
                        "reasoning": "Strong hand, raising",
                    }
                else:
                    action = {"action": "call"}
                    debug = {"equity": 0.55, "reasoning": "Strong hand, calling raise"}
            elif tier == "medium":
                if to_call == 0:
                    action = {"action": "check"}
                    debug = {"equity": 0.40, "reasoning": "Check with medium hand"}
                elif to_call <= pot * 0.3:
                    action = {"action": "call"}
                    debug = {"equity": 0.40, "reasoning": "Cheap call with medium hand"}
                else:
                    debug = {"equity": 0.35, "reasoning": "Medium hand, too expensive"}
            # weak → fold (default)

        elif street in ("flop", "turn", "river"):
            # Post-flop: simple strategy — check if free, call small bets, fold big ones
            if to_call == 0:
                action = {"action": "check"}
                debug = {"reasoning": "Check post-flop"}
            elif to_call <= pot * 0.4:
                action = {"action": "call"}
                pot_odds = to_call / (pot + to_call) if (pot + to_call) > 0 else 0
                debug = {"potOdds": round(pot_odds, 2), "reasoning": "Calling — decent pot odds"}
            else:
                debug = {"reasoning": "Folding — bet too large"}

        action["debug"] = debug
        print(json.dumps(action), flush=True)

    elif msg_type == "hand_over":
        hole_cards = None  # Reset for next hand
