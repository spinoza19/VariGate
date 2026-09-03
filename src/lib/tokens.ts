/**
 * Shipment token derivation, mirrored from contracts/varigate.py.
 *
 * The seller has to write the listing token onto a card and photograph it
 * *before* the listing transaction exists, so the interface cannot wait for the
 * chain to tell it what the token is. It derives the same value locally, from
 * the same fields, with the same arithmetic.
 *
 * scripts/test_lifecycle.py pins the Python side against the contract; this
 * file is checked against both by src/lib/tokens.test.ts.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MASK = (1n << 64n) - 1n;
const PRIME = 0x100000001b3n;

function fnv1a(parts: (string | number | bigint)[]): bigint {
  let h = 0xcbf29ce484222325n;
  const enc = new TextEncoder();
  for (const part of parts) {
    for (const b of enc.encode(String(part))) {
      h ^= BigInt(b);
      h = (h * PRIME) & MASK;
    }
    h ^= 0x1fn;
    h = (h * PRIME) & MASK;
  }
  return h;
}

function token(prefix: string, parts: (string | number | bigint)[]): string {
  let h = fnv1a(parts);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Number(h & 31n)];
    h >>= 5n;
  }
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Token the seller must show in the listing photograph. */
export function listingToken(
  seller: string,
  species: string,
  claim: string,
  amountWei: bigint,
): string {
  return token("VG", [seller.toLowerCase(), species, claim, amountWei]);
}

/** Token the buyer must show in the unboxing photograph. */
export function arrivalToken(listing: string, trackingNumber: string): string {
  return token("VA", [listing, trackingNumber.trim().toUpperCase()]);
}
