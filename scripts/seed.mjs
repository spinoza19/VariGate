/**
 * Populate a deployment with the three demo sheets, driving each one through to
 * a verdict so the archive is not empty on first load.
 *
 * Resumable on purpose. Each sheet takes several minutes of real vision calls,
 * and a dropped connection halfway through should not mean starting over. The
 * script reads the current on-chain status of every escrow and only performs
 * the steps that are still outstanding.
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
  isTransient,
} from "./lib.mjs";

const LISTED = 0;
const FUNDED = 1;
const SHIPPED = 2;
const DELIVERED = 3;
const JUDGED = 4;
const SETTLED = 5;

const SHEETS = [
  {
    species: "Monstera deliciosa 'Albo Variegata'",
    claim:
      "Four-leaf cutting, roughly 40% white sectorial variegation across the blades, no rot, " +
      "rooted in sphagnum. Ships bare-root with a heat pack.",
    price: 2,
    before: "albo-before.jpg",
    after: "albo-after.jpg",
    settle: true,
  },
  {
    species: "Philodendron 'Thai Sunrise'",
    claim:
      "Five leaves, heavy variegation on every blade, over 55% cream tissue, immaculate " +
      "condition. Established root system, no damage anywhere.",
    price: 3.5,
    before: "thai-before.jpg",
    after: "thai-after.jpg",
    settle: true,
  },
  {
    species: "Philodendron spiritus-sancti",
    claim:
      "Three healthy leaves, deep green, clean stem with no soft tissue. Grown on for two " +
      "years, ships in perfect health.",
    price: 5,
    before: "spiritus-before.jpg",
    after: "spiritus-after.jpg",
    // Left judged-but-unsettled so the archive shows a live "Settle" action.
    settle: false,
  },
];

const img = (n) => new Uint8Array(readFileSync(resolve(ROOT, "public/specimens", n)));

const { address } = loadDeployment();
const seller = createAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
const buyer = createAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const sellerC = clientFor(seller);
const buyerC = clientFor(buyer);
const anyC = clientFor(deployer());

/** The hosted simulator sits behind Cloudflare and occasionally drops a call. */
async function resilient(label, fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || i >= tries) throw e;
      const msg = String(e?.message ?? e).split("\n")[0].slice(0, 90);
      warn(`${label}: ${msg}, retry ${i}/${tries - 1} in 15s`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

const readAll = () =>
  resilient("read", async () =>
    JSON.parse(await anyC.readContract({ address, functionName: "get_all", args: [] })),
  );

step(`Seeding ${address}`);
for (const [who, a] of [
  ["seller", seller],
  ["buyer", buyer],
]) {
  if ((await resilient("balance", () => balanceOf(a.address))) < 10n ** 19n) {
    await resilient("faucet", () => fund(a.address, 200));
    ok(`funded ${who}`);
  }
}

let all = await readAll();

for (const s of SHEETS) {
  step(s.species);
  const price = GEN(s.price);

  // Resume an existing sheet for this species rather than duplicating it.
  let e = [...all].reverse().find((x) => x.species === s.species);

  if (!e) {
    const h = await resilient("list", () =>
      sellerC.writeContract({
        address,
        functionName: "list_specimen",
        args: [s.species, s.claim, price, img(s.before)],
        value: 0n,
      }),
    );
    await awaitTx(sellerC, h, "list");
    all = await readAll();
    e = all[all.length - 1];
  } else {
    ok(`resuming #${e.id} at status ${e.status}`);
  }

  const id = e.id;
  const reload = async () => {
    all = await readAll();
    e = all.find((x) => x.id === id);
  };

  if (e.status === LISTED) {
    const h = await resilient("fund", () =>
      buyerC.writeContract({ address, functionName: "fund", args: [id], value: price }),
    );
    await awaitTx(buyerC, h, "fund");
    await reload();
  }

  if (e.status === FUNDED) {
    const h = await resilient("ship", () =>
      sellerC.writeContract({
        address,
        functionName: "mark_shipped",
        args: [id, `NL-PARCEL-${100000 + id}`],
        value: 0n,
      }),
    );
    await awaitTx(sellerC, h, "ship");
    await reload();
  }

  // Dispatch no longer starts the buyer's clock, so the demo records delivery
  // explicitly before filing, the same way a real buyer would.
  if (e.status === SHIPPED) {
    const h = await resilient("delivery", () =>
      buyerC.writeContract({ address, functionName: "confirm_delivery", args: [id], value: 0n }),
    );
    await awaitTx(buyerC, h, "confirm delivery");
    await reload();
  }

  // A leader's model can time out or return something unparseable. That reverts
  // cleanly, so resending simply draws a different leader.
  for (let attempt = 1; attempt <= 3 && e.status === DELIVERED; attempt++) {
    const h = await resilient("adjudicate", () =>
      buyerC.writeContract({
        address,
        functionName: "submit_arrival",
        args: [id, img(s.after)],
        value: 0n,
      }),
    );
    await awaitTx(buyerC, h, `adjudicate (try ${attempt})`);
    await reload();
    if (e.status === DELIVERED) warn("leader produced no verdict, drawing another");
  }

  if (e.status < JUDGED) {
    warn(`#${id} left in transit, adjudication did not land`);
    continue;
  }

  if (e.verdict) {
    const v = JSON.parse(e.verdict);
    log(`  tier ${v.tier} · score ${v.score} · seller ${v.seller_pct}%`);
    for (const l of v.breakdown) log(`    ${l}`);
  }

  if (s.settle && e.status === JUDGED) {
    const h = await resilient("settle", () =>
      anyC.writeContract({ address, functionName: "settle", args: [id], value: 0n }),
    );
    await awaitTx(anyC, h, "settle");
    await reload();
  } else if (e.status === SETTLED) {
    ok("already settled");
  } else {
    ok("left judged, the archive will show a live Settle action");
  }
}

step("Seeded");
for (const e of await readAll()) {
  const v = e.verdict ? JSON.parse(e.verdict) : null;
  log(
    `  #${String(e.id).padEnd(2)} ${e.species.slice(0, 36).padEnd(38)} status ${e.status}  ` +
      (v ? `tier ${v.tier} · seller ${v.seller_pct}%` : "no verdict"),
  );
}
log(`\n  npm run dev\n`);
