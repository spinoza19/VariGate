"""Shipment token derivation, mirrored from contracts/varigate.py.

The contract computes these on chain; anything that has to produce a matching
photograph has to compute the same value first. Kept in one place so the demo
plates, the seed and the tests all agree with the contract byte for byte, and
so a divergence shows up as a failing test rather than as a rejected unboxing.
"""

from __future__ import annotations

TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def fnv1a(parts) -> int:
    h = 0xCBF29CE484222325
    for chunk in parts:
        for b in str(chunk).encode("utf-8"):
            h ^= b
            h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
        h ^= 0x1F
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


def token(prefix: str, parts) -> str:
    h = fnv1a(parts)
    out = ""
    for _ in range(8):
        out += TOKEN_ALPHABET[h & 31]
        h >>= 5
    return f"{prefix}-{out[:4]}-{out[4:]}"


def listing_token(seller: str, species: str, claim: str, amount: int) -> str:
    return token("VG", [seller.lower(), species, claim, amount])


def arrival_token(listing: str, tracking_number: str) -> str:
    return token("VA", [listing, tracking_number.strip().upper()])
