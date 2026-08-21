/**
 * On-chain proof that the reviewed vulnerability is closed.
 *
 * The finding: the buyer's unboxing window used to start at dispatch, so a
 * seller could ship, wait 48 hours and call claim_no_show before the parcel had
 * been delivered. This script reproduces the attack against the live contract
 * and shows it now fails, then shows the buyer can still file.
 *
 * Offline tests cover the day 30 arithmetic that no simulator can fast-forward
 * to; see scripts/test_lifecycle.py. What this proves is the part that only a
 * real chain can: that the deployed bytecode actually enforces the rule.
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

/** Run a write we expect the contract to refuse, and report how it refused. */
async function expectRejected(client, label, functionName, args) {
  try {
    const h = await client.writeContract({ address, functionName, args, value: 0n });
    const r = await awaitTx(client, h, label);
    // A GenVM UserError still finalises; the state is what tells us it reverted.
    return { threw: false, receipt: r };
  } catch (e) {
    return { threw: true, message: String(e?.message ?? e).split("\n")[0] };
  }
}

step("Proof: a seller cannot expire buyer protection before delivery");
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

step("1. Seller lists, buyer funds, seller ships");
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

h = await sellerC.writeContract({
  address,
  functionName: "mark_shipped",
  args: [id, "NL-PROOF-000001"],
  value: 0n,
});
await awaitTx(sellerC, h, "ship");

let e = await read(id);
ok(`escrow #${id} status ${e.status} (SHIPPED), awaiting_delivery ${e.awaiting_delivery}`);
log(`     dispatch did not start a clock: deadline is ${Math.round(e.seconds_left / 86400)}d away`);

step("2. The attack: seller tries to close the escrow in their own favour");
log("   Under the reviewed version this succeeded 48h after dispatch and took 100%.");

const attack = await expectRejected(sellerC, "claim_no_show (attack)", "claim_no_show", [id]);
e = await read(id);

const stolen = e.status === 5; // SETTLED
if (stolen) {
  warn("ATTACK SUCCEEDED. The escrow settled without the buyer ever filing.");
  process.exitCode = 1;
} else {
  ok(`attack refused. escrow still status ${e.status}, nothing paid out`);
  if (attack.threw) log(`     ${attack.message}`);
}

step("3. The buyer still has their window");
h = await buyerC.writeContract({
  address,
  functionName: "confirm_delivery",
  args: [id],
  value: 0n,
});
await awaitTx(buyerC, h, "confirm_delivery");
e = await read(id);
ok(`status ${e.status} (DELIVERED), source "${e.delivery_source}"`);
log(`     window now open for ${Math.round(e.seconds_left / 3600)}h from delivery`);

step("4. Seller tries again while the window is open");
const attack2 = await expectRejected(sellerC, "claim_no_show (attack 2)", "claim_no_show", [id]);
e = await read(id);
if (e.status === 5) {
  warn("ATTACK SUCCEEDED during the buyer's own window.");
  process.exitCode = 1;
} else {
  ok(`refused again. status ${e.status}, buyer's 48h intact`);
  if (attack2.threw) log(`     ${attack2.message}`);
}

step("5. The buyer files and the contract adjudicates");
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
  ok(`verdict tier ${v.tier}, seller ${v.seller_pct}%, score ${v.score}`);
  for (const l of v.breakdown) log(`     ${l}`);
}

step("Result");
log(
  process.exitCode
    ? "  FAILED: the vulnerability is still reachable.\n"
    : "  The seller could not touch the escrow before the buyer had their post-delivery window.\n",
);
