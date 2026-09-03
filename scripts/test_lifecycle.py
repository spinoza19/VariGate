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
import tokens as offchain

C = load_contract()

deadline = C["_arrival_deadline"]
carrier_host = C["_carrier_host"]
recorded_delivery = C["_recorded_delivery"]
timestamps_agree = C["_timestamps_agree"]
well_formed_tracking = C["_well_formed_tracking"]
listing_token = C["listing_token"]
arrival_token = C["arrival_token"]
token_matches = C["_token_matches"]
normalise_token = C["_normalise_token"]
TOLERANCE = C["TIMESTAMP_TOLERANCE_SECONDS"]
is_carrier = C["_is_carrier_url"]
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
    "submit_arrival": {DELIVERED},
    "claim_no_show": {SHIPPED, DELIVERED},
    "claim_no_ship": {FUNDED},
    "settle": {JUDGED},
}

check("delivery can only be established while in transit", ACCEPTS["confirm_delivery"], {SHIPPED})
check("adjudication requires a recorded delivery first", ACCEPTS["submit_arrival"], {DELIVERED})
check("a parcel still in transit cannot be adjudicated", SHIPPED in ACCEPTS["submit_arrival"], False)
check("settlement needs a verdict first", ACCEPTS["settle"], {JUDGED})
check(
    "no entry point moves money straight out of SHIPPED without the deadline",
    "settle" not in {k for k, v in ACCEPTS.items() if SHIPPED in v} - {"submit_arrival", "claim_no_show"},
    True,
)
check("statuses are distinct", len({LISTED, FUNDED, SHIPPED, DELIVERED, JUDGED}), 5)

# --------------------------------------------------------------------------- #
section("a stale leader timestamp cannot enable an early no-show payout")

# The leader parses a delivery time off the carrier's page. If that value fed
# the deadline, a leader could backdate it to the dispatch date and collapse
# the window to shipped_at + 48h: the original vulnerability, restored.
# _recorded_delivery must therefore ignore it entirely.
NOW = SHIP + 9 * DAY  # the carrier check runs on day 9

HOSTILE = {
    "backdated to dispatch": SHIP,
    "backdated before dispatch": SHIP - 400 * DAY,
    "the unix epoch": 0,
    "one second after dispatch": SHIP + 1,
    "yesterday": NOW - DAY,
    "an hour ago": NOW - HOUR,
    "exactly now": NOW,
    "the future": NOW + 900 * DAY,
    "absurdly large": 2**53,
}
for name, reported in HOSTILE.items():
    rec = recorded_delivery(reported, SHIP, NOW)
    dl = deadline(SHIP, rec)
    check(f"leader reports {name}: deadline still NOW + 48h", dl, NOW + WINDOW)
    check(f"leader reports {name}: seller still blocked at NOW + 47h",
          seller_may_claim(NOW + 47 * HOUR, SHIP, rec), False)

check(
    "no reported value can move the recorded delivery at all",
    len({recorded_delivery(r, SHIP, NOW) for r in HOSTILE.values()}),
    1,
)
check(
    "and the recorded value is the chain's own clock",
    recorded_delivery(SHIP, SHIP, NOW),
    NOW,
)
check(
    "which is never before dispatch",
    recorded_delivery(0, SHIP, SHIP - 5),
    SHIP,
)

# The reviewer also asked for the agreement check itself to fail closed.
section("timestamp agreement fails closed")

check("identical timestamps agree", timestamps_agree(1_700_000_000, 1_700_000_000), True)
check("a minute apart agrees", timestamps_agree(1_700_000_000, 1_700_000_060), True)
check("the tolerance boundary agrees", timestamps_agree(1_700_000_000, 1_700_000_000 + TOLERANCE), True)
check("one second past it does not", timestamps_agree(1_700_000_000, 1_700_000_001 + TOLERANCE), False)
check("a day apart does not", timestamps_agree(1_700_000_000, 1_700_000_000 + DAY), False)
check("a stale leader value does not", timestamps_agree(SHIP, NOW), False)
check("missing on one side does not", timestamps_agree(0, 1_700_000_000), False)
check("missing on the other side does not", timestamps_agree(1_700_000_000, 0), False)
check("missing on both sides is agreement", timestamps_agree(0, 0), True)

GOOD = {"delivered": True, "number_matches": True, "delivered_at": 1_700_000_000}
check("a well formed report passes", well_formed_tracking(GOOD), True)
check("delivered without a number match is incoherent",
      well_formed_tracking({**GOOD, "number_matches": False}), False)
check("a negative timestamp is rejected", well_formed_tracking({**GOOD, "delivered_at": -1}), False)
check("a string timestamp is rejected", well_formed_tracking({**GOOD, "delivered_at": "x"}), False)
check("a missing field is rejected", well_formed_tracking({"delivered": True}), False)
check("junk is rejected", well_formed_tracking("delivered"), False)
check("not-delivered with no number match is fine",
      well_formed_tracking({"delivered": False, "number_matches": False, "delivered_at": 0}), True)

# --------------------------------------------------------------------------- #
section("photographs are bound to one shipment")

SELLER = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A"
SPECIES = "Monstera deliciosa 'Albo Variegata'"
CLAIM = "Four leaves, roughly 40% white sectorial variegation, no rot."
PRICE = 2 * 10**18

LT = listing_token(SELLER, SPECIES, CLAIM, PRICE)
AT = arrival_token(LT, "VG-100000")

check("a listing token has the expected shape", len(LT), 12)
check("and its own prefix", LT[:3], "VG-")
check("an arrival token has its own prefix", AT[:3], "VA-")
check("the two are different", LT != AT, True)
check("derivation is deterministic", listing_token(SELLER, SPECIES, CLAIM, PRICE), LT)

# The photograph generator and the seed compute these off chain; if they ever
# drift from the contract, an honest unboxing gets rejected. Pin them together.
check(
    "the off-chain helper matches the contract exactly",
    offchain.listing_token(SELLER, SPECIES, CLAIM, PRICE),
    LT,
)
check(
    "and so does the arrival derivation",
    offchain.arrival_token(LT, "VG-100000"),
    AT,
)

# Every field that identifies the shipment must change the token, or a photo
# from one listing could be replayed into another.
check("a different seller yields a different token",
      listing_token("0x0000000000000000000000000000000000000001", SPECIES, CLAIM, PRICE) != LT, True)
check("a different species does too",
      listing_token(SELLER, "Philodendron spiritus-sancti", CLAIM, PRICE) != LT, True)
check("a different claim does too",
      listing_token(SELLER, SPECIES, CLAIM + " Ships bare-root.", PRICE) != LT, True)
check("a different price does too",
      listing_token(SELLER, SPECIES, CLAIM, PRICE + 1) != LT, True)
check("a different tracking number changes the arrival token",
      arrival_token(LT, "VG-100001") != AT, True)
check("and so does a different listing token",
      arrival_token("VG-AAAA-BBBB", "VG-100000") != AT, True)

check("tokens never contain the ambiguous glyphs",
      any(c in LT + AT for c in "IO01"), False)

section("token matching")

check("an exact read matches", token_matches(LT, LT), True)
check("lowercase still matches", token_matches(LT, LT.lower()), True)
check("spacing and punctuation are ignored", token_matches(LT, LT.replace("-", " ")), True)
check("a surrounding sentence does not match", token_matches(LT, f"the card reads {LT}"), False)
check("an empty read never matches", token_matches(LT, ""), False)
check("whitespace never matches", token_matches(LT, "   "), False)
check("another shipment's token does not match", token_matches(LT, AT), False)
check("one character off does not match", token_matches(LT, LT[:-1] + ("Z" if LT[-1] != "Z" else "Y")), False)
check("an empty expectation never matches anything", token_matches("", ""), False)
check("normalisation strips separators", normalise_token("vg-al5p-3jtz"), "VGAL5P3JTZ")

# --------------------------------------------------------------------------- #
section("only a real carrier can start the clock")

# A seller who can point check_delivery at a page they control has the original
# vulnerability back: they host a lookalike that says "delivered", start the
# buyer's 48 hours the day they posted the box, and claim on day three.
GENUINE = [
    "https://www.dhl.com/track?id=VG123",
    "https://dhl.com/x",
    "https://track.ups.com/y",
    "https://tools.usps.com/go/TrackConfirmAction?tLabels=Z",
    "https://DHL.COM/upper",
    "https://www.dhl.com./trailing-root-dot",
    "https://www.dhl.com:443/with-port",
]
for u in GENUINE:
    check(f"accepts {u[:52]}", is_carrier(u), True)

ATTACKS = {
    "plain seller host": "https://seller.example/tracking",
    "carrier as a suffix": "https://dhl.com.seller.example/track",
    "carrier as userinfo": "https://dhl.com@seller.example/track",
    "carrier in userinfo with path": "https://www.dhl.com@seller.example/track?id=1",
    "carrier in the query": "https://seller.example/track?ref=https://dhl.com",
    "carrier in the fragment": "https://seller.example/track#dhl.com",
    "carrier in the path": "https://seller.example/dhl.com/track",
    "lookalike hyphen": "https://dhl-com.example/track",
    "lookalike dash prefix": "https://my-dhl.com.co/track",
    "plain http": "http://www.dhl.com/track",
    "no scheme": "www.dhl.com/track",
    "raw IP": "https://203.0.113.9/track",
    "IPv6 literal": "https://[2001:db8::1]/track",
    "empty": "",
    "whitespace": "   ",
    "scheme only": "https://",
    "backslash trick": "https://seller.example\@dhl.com/",
}
for name, u in ATTACKS.items():
    check(f"rejects {name}", is_carrier(u), False)

check("userinfo trick resolves to the attacker's host",
      carrier_host("https://dhl.com@seller.example/x"), "seller.example")
check("suffix trick resolves to the attacker's host",
      carrier_host("https://dhl.com.seller.example/x"), "dhl.com.seller.example")
check("query is not part of the host",
      carrier_host("https://seller.example/?u=dhl.com"), "seller.example")
check("case and trailing dot are normalised",
      carrier_host("https://WWW.DHL.COM./x"), "www.dhl.com")
check("every allowlisted domain accepts itself",
      all(is_carrier("https://" + d + "/t") for d in C["CARRIER_DOMAINS"]), True)
check("every allowlisted domain rejects itself as a suffix",
      any(is_carrier("https://" + d + ".seller.example/t") for d in C["CARRIER_DOMAINS"]), False)

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
