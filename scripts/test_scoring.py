"""Offline regression tests for the payout arithmetic.

The whole point of the contract's design is that the money side is ordinary
Python with no model in it. That makes it testable on a laptop in milliseconds,
without a chain, a validator or an API key — so it should be tested that way.

    python scripts/test_scoring.py

The contract imports `from genlayer import *`, which only exists inside GenVM.
We stub just enough of it to exec the module and reach the pure functions.
"""

from __future__ import annotations

import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_contract():
    """Exec contracts/varigate.py against a minimal fake `genlayer` module."""
    gl = types.SimpleNamespace()
    gl.Contract = type("Contract", (), {})
    gl.vm = types.SimpleNamespace(UserError=type("UserError", (Exception,), {}))
    gl.evm = types.SimpleNamespace(contract_interface=lambda c: c)
    gl.public = types.SimpleNamespace()

    stub = types.ModuleType("genlayer")
    stub.gl = gl
    stub.u8 = int
    stub.u32 = int
    stub.u64 = int
    stub.u256 = int
    stub.Address = str
    stub.DynArray = {}
    stub.TreeMap = {}
    stub.allow_storage = lambda c: c
    stub.__all__ = [
        "gl", "u8", "u32", "u64", "u256", "Address", "DynArray", "TreeMap", "allow_storage",
    ]
    sys.modules["genlayer"] = stub

    src = open(os.path.join(ROOT, "contracts", "varigate.py"), encoding="utf-8").read()
    # The class body annotates storage with types the stub cannot model, and the
    # decorators do not exist. Only the module-level helpers matter here, so cut
    # the contract class out and keep everything around it.
    start = src.index("class VariGate(gl.Contract):")
    end = src.index("# ------", src.index("Module-level helpers") - 400)
    trimmed = src[:start] + src[end:]

    ns: dict = {}
    exec(compile(trimmed, "varigate.py", "exec"), ns)
    return ns


C = load_contract()
score_it = C["_score_observations"]
consistent = C["_self_consistent"]
agree = C["_verdicts_agree"]
well_formed = C["_well_formed"]
normalise = C["_normalise"]
TIERS = C["TIER_SELLER_PCT"]

PASS, FAIL = 0, 0


def obs(**over):
    base = {
        "cultivar_match": True,
        "cultivar_note": "",
        "leaves_before": 4,
        "leaves_after": 4,
        "variegation_before": "mid",
        "variegation_after": "mid",
        "claim_supported": True,
        "claim_note": "",
        "damage_level": "none",
        "damage_cause": "none",
        "rot_present": False,
        "confidence": 85,
        "notes": "",
    }
    base.update(over)
    return base


def check(name, got, want):
    global PASS, FAIL
    if got == want:
        PASS += 1
        print(f"  \033[32mok\033[0m   {name}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {name}\n         got {got!r}\n        want {want!r}")


def section(t):
    print(f"\n\033[1m{t}\033[0m")


# --------------------------------------------------------------------------- #
section("tiers")

tier, score, _ = score_it(obs())
check("pristine arrival -> full release", (tier, score), (5, 100))

tier, score, _ = score_it(obs(damage_level="minor", damage_cause="transit"))
check("one bruised leaf in transit stays full release", (tier, score), (5, 98))

tier, score, _ = score_it(obs(leaves_before=4, leaves_after=3))
check("one leaf lost -> 75%", (tier, TIERS[tier]), (4, 75))

tier, score, _ = score_it(obs(variegation_before="high", variegation_after="low"))
check("variegation collapses two bands -> 50%", (tier, TIERS[tier]), (3, 50))

tier, score, _ = score_it(
    obs(leaves_before=5, leaves_after=3, variegation_before="high",
        variegation_after="low", claim_supported=False,
        damage_level="moderate", damage_cause="seller")
)
check("oversold and damaged -> full refund", (tier, TIERS[tier]), (1, 0))

# --------------------------------------------------------------------------- #
section("fatal findings")

tier, score, why = score_it(obs(cultivar_match=False, claim_supported=False, confidence=95))
check("confident cultivar mismatch -> 0%", (tier, score), (1, 0))
check("mismatch is explained", "Cultivar mismatch" in why[0], True)

# A mismatch always drags claim_supported down with it (_self_consistent
# rejects the pair otherwise), so the hesitant case is -55 and -25 = 20: a
# heavy deduction that still leaves the seller a quarter, rather than nothing.
tier, score, _ = score_it(obs(cultivar_match=False, claim_supported=False, confidence=45))
check("hesitant mismatch deducts but does not zero", (tier, score, TIERS[tier]), (2, 20, 25))

tier, _, _ = score_it(obs(rot_present=True, damage_level="severe", damage_cause="seller"))
check("seller rot -> 0%", TIERS[tier], 0)

tier, score, _ = score_it(obs(rot_present=True, damage_level="severe", damage_cause="transit"))
check("rot the carrier caused is not fatal", (tier, score), (2, 38))

# --------------------------------------------------------------------------- #
section("damage attribution changes the bill")

_, seller_fault, _ = score_it(obs(damage_level="moderate", damage_cause="seller"))
_, unclear, _ = score_it(obs(damage_level="moderate", damage_cause="unclear"))
_, transit, _ = score_it(obs(damage_level="moderate", damage_cause="transit"))
check("seller < unclear < transit", seller_fault < unclear < transit, True)
check("exact ladder", (seller_fault, unclear, transit), (80, 85, 90))

# --------------------------------------------------------------------------- #
section("low confidence")

_, pulled, _ = score_it(obs(leaves_before=4, leaves_after=2, confidence=25))
_, sure, _ = score_it(obs(leaves_before=4, leaves_after=2, confidence=90))
check("a blurry read is pulled toward neutral", pulled > sure, True)
check("but a flagged one is not", score_it(obs(rot_present=True, damage_level="severe",
      damage_cause="transit", confidence=20))[1], 38)

# --------------------------------------------------------------------------- #
section("self-consistency rejects impossible reports")

check("leaves cannot grow in a box", consistent(obs(leaves_before=2, leaves_after=5)), False)
check("one extra leaf is tolerated (counting slop)",
      consistent(obs(leaves_before=4, leaves_after=5)), True)
check("rot with no damage is incoherent",
      consistent(obs(rot_present=True, damage_level="none")), False)
check("damage with cause 'none' is incoherent",
      consistent(obs(damage_level="moderate", damage_cause="none")), False)
check("no damage with a cause is incoherent",
      consistent(obs(damage_level="none", damage_cause="seller")), False)
check("a different plant cannot support the claim",
      consistent(obs(cultivar_match=False, claim_supported=True)), False)
check("an ordinary report passes", consistent(obs()), True)

# --------------------------------------------------------------------------- #
section("validator agreement")

check("identical readings agree", agree(obs(), obs()), True)
check("one tier apart is tolerated",
      agree(obs(), obs(leaves_before=4, leaves_after=3)), True)
check("three tiers apart is not",
      agree(obs(), obs(leaves_before=5, leaves_after=2, claim_supported=False,
                       damage_level="severe", damage_cause="seller")), False)
check("disagreeing on cultivar never agrees",
      agree(obs(), obs(cultivar_match=False, claim_supported=False)), False)
check("disagreeing on rot never agrees",
      agree(obs(), obs(rot_present=True, damage_level="severe")), False)

# --------------------------------------------------------------------------- #
section("normalising sloppy model output")

n = normalise({
    "cultivar_match": "true",
    "leaves_before": "4",
    "leaves_after": 3,
    "variegation_before": "MID",
    "variegation_after": "purple",     # not in the vocabulary
    "claim_supported": False,
    "damage_level": "minor",
    "damage_cause": "transit",
    "rot_present": "no",
    "confidence": 9000,                # out of range
})
check("string booleans coerce", n["cultivar_match"], True)
check("string integers coerce", n["leaves_before"], 4)
check("case is normalised", n["variegation_before"], "mid")
check("unknown enum falls back", n["variegation_after"], "none")
check("confidence is clamped", n["confidence"], 100)
check("normalised output is well formed", well_formed(n), True)
check("junk is rejected", well_formed({"cultivar_match": True}), False)

# --------------------------------------------------------------------------- #
section("payout arithmetic mirrors the contract")


def payout(total_wei: int, tier: int, fee_bps: int = 200):
    fee = (total_wei * fee_bps) // 10_000
    dist = total_wei - fee
    seller = (dist * TIERS[tier]) // 100
    return seller, dist - seller, fee


check("2 GEN at full release", payout(2 * 10**18, 5),
      (1_960_000_000_000_000_000, 0, 40_000_000_000_000_000))
check("5 GEN at 25%", payout(5 * 10**18, 2),
      (1_225_000_000_000_000_000, 3_675_000_000_000_000_000, 100_000_000_000_000_000))
check("nothing is ever created or destroyed",
      all(sum(payout(n * 10**18, t)) == n * 10**18 for n in (1, 3, 7, 11) for t in TIERS),
      True)

# --------------------------------------------------------------------------- #
print(f"\n\033[1m{PASS} passed, {FAIL} failed\033[0m\n")
sys.exit(1 if FAIL else 0)
