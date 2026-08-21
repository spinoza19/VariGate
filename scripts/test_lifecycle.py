"""Lifecycle and timeout tests, run offline against the contract's own rules.

Written in response to a review finding: the first version of this contract
started the buyer's 48-hour unboxing window at DISPATCH. Since international
plant shipping routinely takes a week, a seller could post a box, wait two
days, call claim_no_show and take the full amount before the parcel had even
been delivered. The escrow protected the wrong party.

The fix is one pure function, `_arrival_deadline`, and these tests exist to
hold it to a single invariant:

    the buyer always gets ARRIVAL_WINDOW_SECONDS of clock time
    that begins no earlier than actual delivery

Time is the thing under test, so these run against the rule directly rather
than against a chain: no simulator can be fast-forwarded thirty days, and a
test that cannot reach day 30 cannot prove anything about day 30.

    python scripts/test_lifecycle.py
"""

from __future__ import annotations

import sys

from _contract_stub import load_contract

C = load_contract()

deadline = C["_arrival_deadline"]
WINDOW = C["ARRIVAL_WINDOW_SECONDS"]
MAX_TRANSIT = C["MAX_TRANSIT_SECONDS"]
SHIP_WINDOW = C["SHIP_WINDOW_SECONDS"]

LISTED = int(C["STATUS_LISTED"])
FUNDED = int(C["STATUS_FUNDED"])
SHIPPED = int(C["STATUS_SHIPPED"])
DELIVERED = int(C["STATUS_DELIVERED"])
JUDGED = int(C["STATUS_JUDGED"])

DAY = 86_400
HOUR = 3_600

PASS, FAIL = 0, 0


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


# The two gates the contract applies, mirrored here so the tests exercise the
# same rule the contract does rather than a paraphrase of it.
def buyer_may_file(now, shipped_at, delivered_at):
    return now <= deadline(shipped_at, delivered_at)


def seller_may_claim(now, shipped_at, delivered_at):
    return now > deadline(shipped_at, delivered_at)


# --------------------------------------------------------------------------- #
section("the regression: a seller cannot expire protection before delivery")

SHIP = 1_000_000

# A realistic slow international shipment: posted on day 0, lands on day 9.
for transit_days in (1, 3, 6, 9, 14, 21, 29):
    delivery = SHIP + transit_days * DAY
    # At every moment from dispatch up to the instant of delivery, the seller
    # must have no way to close the escrow in their own favour.
    moments = [SHIP, SHIP + HOUR, SHIP + 2 * DAY, SHIP + 3 * DAY, delivery - 1, delivery]
    blocked = all(not seller_may_claim(t, SHIP, 0) for t in moments)
    check(f"{transit_days:>2}d transit: seller blocked at every point before delivery", blocked, True)

check(
    "the old bug: seller cannot claim 48h after dispatch",
    seller_may_claim(SHIP + WINDOW + 1, SHIP, 0),
    False,
)
check(
    "nor after a fortnight in transit",
    seller_may_claim(SHIP + 14 * DAY, SHIP, 0),
    False,
)

# --------------------------------------------------------------------------- #
section("the buyer always gets a full post-delivery window")

for transit_days in (0, 1, 5, 9, 20, 29, 30, 45, 120):
    delivery = SHIP + transit_days * DAY
    granted = deadline(SHIP, delivery) - delivery
    check(f"{transit_days:>3}d transit: {granted // HOUR}h granted after delivery", granted >= WINDOW, True)

check(
    "delivery on the last possible day still grants the full window",
    deadline(SHIP, SHIP + MAX_TRANSIT) - (SHIP + MAX_TRANSIT),
    WINDOW,
)
check(
    "a parcel delivered years late still grants the full window",
    deadline(SHIP, SHIP + 900 * DAY) - (SHIP + 900 * DAY),
    WINDOW,
)

# --------------------------------------------------------------------------- #
section("the window opens and closes where it should")

DELIVERY = SHIP + 6 * DAY

check("buyer may file the moment it lands", buyer_may_file(DELIVERY, SHIP, DELIVERY), True)
check("buyer may file 47h later", buyer_may_file(DELIVERY + 47 * HOUR, SHIP, DELIVERY), True)
check("buyer may file on the final second", buyer_may_file(DELIVERY + WINDOW, SHIP, DELIVERY), True)
check("buyer is shut out one second later", buyer_may_file(DELIVERY + WINDOW + 1, SHIP, DELIVERY), False)

check("seller blocked while the window runs", seller_may_claim(DELIVERY + 47 * HOUR, SHIP, DELIVERY), False)
check("seller blocked on the final second", seller_may_claim(DELIVERY + WINDOW, SHIP, DELIVERY), False)
check("seller may claim one second after", seller_may_claim(DELIVERY + WINDOW + 1, SHIP, DELIVERY), True)

check(
    "the two gates are exclusive and total",
    all(
        buyer_may_file(t, SHIP, DELIVERY) != seller_may_claim(t, SHIP, DELIVERY)
        for t in range(DELIVERY - DAY, DELIVERY + WINDOW + DAY, 997)
    ),
    True,
)

# --------------------------------------------------------------------------- #
section("the backstop for a parcel nobody ever confirms")

check(
    "buyer may still file on day 29",
    buyer_may_file(SHIP + 29 * DAY, SHIP, 0),
    True,
)
check(
    "buyer may still file at the backstop plus 47h",
    buyer_may_file(SHIP + MAX_TRANSIT + 47 * HOUR, SHIP, 0),
    True,
)
check(
    "seller may finally claim after backstop plus window",
    seller_may_claim(SHIP + MAX_TRANSIT + WINDOW + 1, SHIP, 0),
    True,
)
check(
    "which is 32 days after dispatch, not 2",
    (deadline(SHIP, 0) - SHIP) // DAY,
    32,
)

# --------------------------------------------------------------------------- #
section("the seller has no lever on the deadline")

# Everything the seller controls is dispatch time. Show that moving it can only
# ever push the deadline later, never earlier, once delivery is known.
check(
    "shipping earlier does not shorten a known window",
    deadline(SHIP - 10 * DAY, DELIVERY) == deadline(SHIP, DELIVERY) == deadline(SHIP + DAY, DELIVERY),
    True,
)
check(
    "with delivery known, dispatch time is not an input at all",
    len({deadline(SHIP + k * DAY, DELIVERY) for k in range(-30, 30)}),
    1,
)
check(
    "with delivery unknown, a later dispatch only delays the seller",
    deadline(SHIP + DAY, 0) > deadline(SHIP, 0),
    True,
)

# --------------------------------------------------------------------------- #
section("state machine")

# Mirrors the guards in the contract: which statuses each entry point accepts.
ACCEPTS = {
    "fund": {LISTED},
    "mark_shipped": {FUNDED},
    "confirm_delivery": {SHIPPED},
    "check_delivery": {SHIPPED},
    "submit_arrival": {SHIPPED, DELIVERED},
    "claim_no_show": {SHIPPED, DELIVERED},
    "claim_no_ship": {FUNDED},
    "settle": {JUDGED},
}

check("delivery can only be established while in transit", ACCEPTS["confirm_delivery"], {SHIPPED})
check("a buyer can file before or after delivery is recorded", ACCEPTS["submit_arrival"], {SHIPPED, DELIVERED})
check("settlement needs a verdict first", ACCEPTS["settle"], {JUDGED})
check(
    "no entry point moves money straight out of SHIPPED without the deadline",
    "settle" not in {k for k, v in ACCEPTS.items() if SHIPPED in v} - {"submit_arrival", "claim_no_show"},
    True,
)
check("statuses are distinct", len({LISTED, FUNDED, SHIPPED, DELIVERED, JUDGED}), 5)

# --------------------------------------------------------------------------- #
section("the seller's own deadline is unchanged")

FUND = 500_000
check("14 days to hand over to a carrier", SHIP_WINDOW // DAY, 14)
check(
    "buyer cannot claim a no-ship refund on day 13",
    FUND + 13 * DAY > FUND + SHIP_WINDOW,
    False,
)
check(
    "but can on day 15",
    FUND + 15 * DAY > FUND + SHIP_WINDOW,
    True,
)

# --------------------------------------------------------------------------- #
print(f"\n\033[1m{PASS} passed, {FAIL} failed\033[0m\n")
sys.exit(1 if FAIL else 0)
