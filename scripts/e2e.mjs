/**
 * Full lifecycle against the live Studio network:
 *   list -> fund -> ship -> unbox (AI adjudication) -> settle
 *
 * Run three scenarios and print what the validators actually decided, plus the
 * real GEN movements, so the scoring rubric can be tuned against evidence
 * rather than against a guess.
 *
 *   npm run e2e            all three scenarios
 *   npm run e2e -- honest  just one
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount } from "genlayer-js";
import {
  ROOT,
  clientFor,
  deployer,
  fund,
  balanceOf,
  loadDeployment,
  awaitTx,
  step,
  ok,
  warn,
  log,
  fmtGen,
  GEN,
} from "./lib.mjs";

const TIERS = {
  1: "FULL REFUND      seller 0%",
  2: "PARTIAL          seller 25%",
  3: "PARTIAL          seller 50%",
  4: "PARTIAL          seller 75%",
  5: "FULL RELEASE     seller 100%",
};

const SCENARIOS = {
  honest: {
    label: "Honest sale — arrives as described, one bruised leaf",
    species: "Monstera deliciosa 'Albo Variegata'",
    claim:
      "Four-leaf cutting, roughly 40% white sectorial variegation across the blades, " +
      "no rot, rooted in sphagnum. Shipped bare-root with a heat pack.",
    price: 2.0,
    before: "albo-before.jpg",
    after: "albo-after.jpg",
    expect: "high tier — transit damage only",
  },
  oversold: {
    label: "Oversold — variegation collapsed and a leaf did not survive",
    species: "Philodendron 'Thai Sunrise'",
    claim:
      "Five leaves, heavy variegation on every blade, over 55% cream tissue, " +
      "immaculate condition. Established root system, no damage anywhere.",
    price: 3.5,
    before: "thai-before.jpg",
    after: "thai-after.jpg",
    expect: "middle tier — claim not supported, leaf loss",
  },
  rotten: {
    label: "Shipped rotten — the failure the escrow exists for",
    species: "Philodendron spiritus-sancti",
    claim:
      "Three healthy leaves, deep green, clean stem with no soft tissue. " +
      "Grown on for two years, ships in perfect health.",
    price: 5.0,
    before: "spiritus-before.jpg",
    after: "spiritus-after.jpg",
    expect: "low tier — rot present",
  },
};

const img = (name) =>
  new Uint8Array(readFileSync(resolve(ROOT, "public/specimens", name)));

const dep = loadDeployment();
const address = dep.address;

const treasuryAcct = deployer();
// Deterministic demo actors so repeat runs reuse the same funded accounts.
const seller = createAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const buyer = createAccount(
  "0x2222222222222222222222222222222222222222222222222222222222222222",
);

const sellerClient = clientFor(seller);
const buyerClient = clientFor(buyer);
const anyClient = clientFor(treasuryAcct);

step("VariGate end-to-end on Studio");
log(`  contract  ${address}`);
log(`  seller    ${seller.address}`);
log(`  buyer     ${buyer.address}`);
log(`  treasury  ${treasuryAcct.address}`);

for (const [who, acct] of [
  ["seller", seller],
  ["buyer", buyer],
]) {
  const bal = await balanceOf(acct.address);
  if (bal < 10n ** 19n) {
    await fund(acct.address, 200);
    ok(`funded ${who} with 200 GEN`);
  }
}

const only = process.argv[2];
const chosen = only ? { [only]: SCENARIOS[only] } : SCENARIOS;
if (only && !SCENARIOS[only]) {
  throw new Error(`unknown scenario '${only}' — pick one of ${Object.keys(SCENARIOS)}`);
}

const results = [];

for (const [key, s] of Object.entries(chosen)) {
  step(`${key.toUpperCase()} — ${s.label}`);
  log(`  expecting: ${s.expect}`);

  const before = img(s.before);
  const after = img(s.after);
  const price = GEN(s.price);

  // 1. list -------------------------------------------------------------
  let h = await sellerClient.writeContract({
    address,
    functionName: "list_specimen",
    args: [s.species, s.claim, price, before],
    value: 0n,
  });
  await awaitTx(sellerClient, h, "list");

  const count = Number(await anyClient.readContract({ address, functionName: "get_count", args: [] }));
  const id = count - 1;
  ok(`escrow #${id} listed at ${s.price} GEN (${before.length} byte photo)`);

  // 2. fund -------------------------------------------------------------
  const buyerBefore = await balanceOf(buyer.address);
  const sellerBefore = await balanceOf(seller.address);
  const treasuryBefore = await balanceOf(treasuryAcct.address);

  h = await buyerClient.writeContract({
    address,
    functionName: "fund",
    args: [id],
    value: price,
  });
  await awaitTx(buyerClient, h, "fund");

  // 3. ship -------------------------------------------------------------
  h = await sellerClient.writeContract({
    address,
    functionName: "mark_shipped",
    args: [id, `NL-PARCEL-${100000 + id}`],
    value: 0n,
  });
  await awaitTx(sellerClient, h, "ship");

  // 4. unbox — this is the transaction that runs the vision model --------
  log("  … adjudicating (vision model + validator consensus, this is the slow one)");
  h = await buyerClient.writeContract({
    address,
    functionName: "submit_arrival",
    args: [id, after],
    value: 0n,
  });
  const judgeReceipt = await awaitTx(buyerClient, h, "unbox+judge");

  const raw = await anyClient.readContract({ address, functionName: "get_escrow", args: [id] });
  const e = JSON.parse(raw);
  if (!e.verdict) {
    warn(`no verdict recorded — tx status ${judgeReceipt.status}`);
    results.push({ key, tier: null, note: "no verdict" });
    continue;
  }
  const v = JSON.parse(e.verdict);

  log("");
  log(`  \x1b[1mVERDICT  tier ${v.tier}  ${TIERS[v.tier]}\x1b[0m   score ${v.score}/100`);
  for (const line of v.breakdown) log(`    ${line}`);
  log("");
  const o = v.observations ?? {};
  log(`    cultivar_match  ${o.cultivar_match}     claim_supported ${o.claim_supported}`);
  log(`    leaves          ${o.leaves_before} -> ${o.leaves_after}`);
  log(`    variegation     ${o.variegation_before} -> ${o.variegation_after}`);
  log(`    damage          ${o.damage_level} (${o.damage_cause})   rot ${o.rot_present}`);
  log(`    confidence      ${o.confidence}`);
  log(`    notes           ${o.notes}`);

  // 5. settle -----------------------------------------------------------
  h = await anyClient.writeContract({ address, functionName: "settle", args: [id], value: 0n });
  await awaitTx(anyClient, h, "settle");

  const buyerAfter = await balanceOf(buyer.address);
  const sellerAfter = await balanceOf(seller.address);
  const treasuryAfter = await balanceOf(treasuryAcct.address);

  log("");
  log(`    buyer     ${fmtGen(buyerBefore)} -> ${fmtGen(buyerAfter)} GEN`);
  log(`    seller    ${fmtGen(sellerBefore)} -> ${fmtGen(sellerAfter)} GEN`);
  log(`    treasury  ${fmtGen(treasuryBefore)} -> ${fmtGen(treasuryAfter)} GEN`);

  results.push({ key, tier: v.tier, score: v.score, sellerPct: v.seller_pct });
}

step("Summary");
for (const r of results) {
  log(
    `  ${r.key.padEnd(10)} tier ${r.tier ?? "-"}  score ${String(r.score ?? "-").padStart(3)}  ` +
      `seller ${String(r.sellerPct ?? "-").padStart(3)}%`,
  );
}
log("");
