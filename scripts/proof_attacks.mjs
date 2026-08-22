/**
 * Adversarial lifecycle proof, driven through the real contract methods
 * against a live deployment. Two review findings, replayed as attacks.
 *
 *   A. The seller expires the buyer's protection before delivery, by starting
 *      the 48h window at dispatch.
 *   B. The seller supplies a tracking page they control and uses it to declare
 *      delivery, which starts the window early by another route.
 *
 * Nothing here is mocked. Every step is a transaction, and every assertion is
 * read back off chain afterwards, because on GenVM a UserError still finalises:
 * the state, not the receipt, is what proves an attack was refused.
 *
 *   npm run proof
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
  GEN,
  fmtGen,
} from "./lib.mjs";

const { address } = loadDeployment();
const seller = createAccount("0x3333333333333333333333333333333333333333333333333333333333333333");
const buyer = createAccount("0x4444444444444444444444444444444444444444444444444444444444444444");
const sellerC = clientFor(seller);
const buyerC = clientFor(buyer);
const anyC = clientFor(deployer());

const img = (n) => new Uint8Array(readFileSync(resolve(ROOT, "public/specimens", n)));
const read = async (id) =>
  JSON.parse(await anyC.readContract({ address, functionName: "get_escrow", args: [id] }));

let failures = 0;
const assert = (condition, message) => {
  if (condition) ok(message);
  else {
    warn(`ASSERTION FAILED: ${message}`);
    failures++;
  }
};

/** Send a write we expect to be refused, and report how. */
async function attempt(client, label, functionName, args) {
  try {
    const h = await client.writeContract({ address, functionName, args, value: 0n });
    await awaitTx(client, h, label);
    return null;
  } catch (e) {
    const raw = String(e?.message ?? e);
    const m = raw.match(/UserError\(?["']?([^"'\)\n]+)/);
    return (m ? m[1] : raw.split("\n")[0]).slice(0, 150);
  }
}

const SELLER_PAGE = "https://tracking.seller-controlled.example/parcel/VG-1";
const GENUINE = "https://www.dhl.com/track?id=VG-PROOF-77120";
const NUMBER = "VG-PROOF-77120";

step("Adversarial proof against a live contract");
log(`  contract  ${address}`);
log(`  seller    ${seller.address}`);
log(`  buyer     ${buyer.address}`);

for (const [who, a] of [
  ["seller", seller],
  ["buyer", buyer],
]) {
  if ((await balanceOf(a.address)) < 10n ** 19n) {
    await fund(a.address, 100);
    ok(`funded ${who}`);
  }
}

const price = GEN(1);

// --------------------------------------------------------------------------
step("Setup: seller lists, buyer funds");
let h = await sellerC.writeContract({
  address,
  functionName: "list_specimen",
  args: [
    "Monstera deliciosa 'Albo Variegata'",
    "Four leaves, roughly 40% white sectorial variegation, no rot, rooted in sphagnum.",
    price,
    img("albo-before.jpg"),
  ],
  value: 0n,
});
await awaitTx(sellerC, h, "list");
const id = Number(await anyC.readContract({ address, functionName: "get_count", args: [] })) - 1;

h = await buyerC.writeContract({ address, functionName: "fund", args: [id], value: price });
await awaitTx(buyerC, h, "fund");
ok(`escrow #${id} funded with ${fmtGen(price)} GEN`);

const buyerBefore = await balanceOf(buyer.address);
const sellerBefore = await balanceOf(seller.address);

// --------------------------------------------------------------------------
step("Attack B1: ship with a tracking page the seller controls");

for (const [name, url] of [
  ["a page on the seller's own host", SELLER_PAGE],
  ["carrier smuggled in as userinfo", "https://www.dhl.com@tracking.seller-controlled.example/p"],
  ["carrier smuggled in as a suffix", "https://dhl.com.seller-controlled.example/p"],
  ["carrier smuggled into the query", "https://seller-controlled.example/p?ref=https://dhl.com"],
  ["backslash before the userinfo", "https://seller-controlled.example\\@dhl.com/p"],
  ["plain http on a real carrier", "http://www.dhl.com/track?id=X"],
]) {
  const err = await attempt(sellerC, `ship (${name})`, "mark_shipped", [id, url, NUMBER]);
  const e = await read(id);
  assert(e.status === 1 && !e.tracking_url, `refused: ${name}`);
  if (err) log(`     ${err}`);
}

// --------------------------------------------------------------------------
step("Setup: seller ships with a genuine carrier reference");
h = await sellerC.writeContract({
  address,
  functionName: "mark_shipped",
  args: [id, GENUINE, NUMBER],
  value: 0n,
});
await awaitTx(sellerC, h, "ship");
let e = await read(id);
assert(e.status === 2, `status SHIPPED, trackable ${e.trackable}`);
assert(e.delivered_at === 0, "no delivery recorded by dispatch");
log(`     deadline sits ${Math.round(e.seconds_left / 86400)} days out, not 2`);

// --------------------------------------------------------------------------
step("Attack A: close the escrow before the parcel has been delivered");
let err = await attempt(sellerC, "claim_no_show (pre-delivery)", "claim_no_show", [id]);
e = await read(id);
assert(e.status === 2, "refused, escrow untouched");
assert(e.delivered_at === 0, "delivery still not recorded");
if (err) log(`     ${err}`);

// --------------------------------------------------------------------------
step("Attack B2: make the carrier check declare an early delivery");
log("   The URL is now a genuine carrier, but it does not show this parcel as");
log("   delivered, so the check must not set a delivery date either.");
err = await attempt(sellerC, "check_delivery", "check_delivery", [id]);
e = await read(id);
assert(e.delivered_at === 0, "no delivery date was set");
assert(e.status === 2, "escrow still in transit");
if (err) log(`     ${err}`);

err = await attempt(sellerC, "claim_no_show (post-check)", "claim_no_show", [id]);
e = await read(id);
assert(e.status === 2, "claim still refused");
if (err) log(`     ${err}`);

// --------------------------------------------------------------------------
step("Nothing moved");
assert((await balanceOf(seller.address)) <= sellerBefore, "seller received nothing");
assert((await balanceOf(buyer.address)) <= buyerBefore, "buyer received nothing");
assert(BigInt(e.amount) === price, `all ${fmtGen(price)} GEN still held by the contract`);

// --------------------------------------------------------------------------
step("The buyer's window is theirs alone");
h = await buyerC.writeContract({ address, functionName: "confirm_delivery", args: [id], value: 0n });
await awaitTx(buyerC, h, "confirm_delivery");
e = await read(id);
assert(e.status === 3 && e.delivery_source === "buyer", "delivery recorded by the buyer");
log(`     window open for ${Math.round(e.seconds_left / 3600)}h`);

err = await attempt(sellerC, "claim_no_show (window open)", "claim_no_show", [id]);
e = await read(id);
assert(e.status === 3, "seller refused again while the window runs");
if (err) log(`     ${err}`);

// --------------------------------------------------------------------------
step("And the buyer can still file");
h = await buyerC.writeContract({
  address,
  functionName: "submit_arrival",
  args: [id, img("albo-after.jpg")],
  value: 0n,
});
await awaitTx(buyerC, h, "submit_arrival");
e = await read(id);
if (!e.verdict) {
  warn("no verdict landed; the leader's model likely timed out. Re-run to draw another.");
} else {
  const v = JSON.parse(e.verdict);
  ok(`adjudicated: tier ${v.tier}, seller ${v.seller_pct}%, score ${v.score}`);
}

// --------------------------------------------------------------------------
step("Result");
if (failures) {
  warn(`${failures} assertion(s) failed. The vulnerability is reachable.`);
  process.exitCode = 1;
} else {
  log("  No seller-supplied page and no amount of waiting could start the");
  log("  buyer's clock. Only the buyer, or a genuine carrier record, can.\n");
}
