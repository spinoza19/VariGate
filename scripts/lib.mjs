import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import "dotenv/config";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RPC = studionet.rpcUrls.default.http[0];
export const DEPLOYMENT_FILE = resolve(ROOT, "deployments/studionet.json");

// dotenv only reads .env by default; this project keeps the key in .env.local
if (!process.env.DEPLOYER_PRIVATE_KEY && existsSync(resolve(ROOT, ".env.local"))) {
  for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

export function deployer() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY missing — copy .env.example to .env.local");
  return createAccount(pk);
}

export function clientFor(account) {
  return createClient({ chain: studionet, account });
}

/** Studio-only faucet. The hosted simulator hands out GEN on request. */
export async function fund(address, gen = 500) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_fundAccount",
      params: [address, Number(BigInt(gen) * 10n ** 18n)],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`fund failed: ${JSON.stringify(json.error)}`);
  return json.result;
}

export async function balanceOf(address) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  return BigInt((await res.json()).result ?? "0x0");
}

export function contractSource() {
  return readFileSync(resolve(ROOT, "contracts/varigate.py"), "utf8");
}

export function saveDeployment(data) {
  mkdirSync(dirname(DEPLOYMENT_FILE), { recursive: true });
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2));
  // The frontend reads the address from an env var at build time; write a
  // .env.local entry too so `npm run dev` picks it up with no extra step.
  const envPath = resolve(ROOT, ".env.local");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const without = existing
    .split("\n")
    .filter((l) => !l.startsWith("VITE_CONTRACT_ADDRESS="))
    .join("\n")
    .replace(/\n+$/, "");
  writeFileSync(envPath, `${without}\nVITE_CONTRACT_ADDRESS=${data.address}\n`);
}

export function loadDeployment() {
  if (!existsSync(DEPLOYMENT_FILE)) {
    throw new Error("No deployment found — run `npm run deploy` first.");
  }
  return JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
}

export const GEN = (n) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;
export const fmtGen = (wei) => (Number(wei) / 1e18).toFixed(4);

export const STATUS_NAMES = {
  0: "UNINITIALIZED",
  1: "PENDING",
  2: "PROPOSING",
  3: "COMMITTING",
  4: "REVEALING",
  5: "ACCEPTED",
  6: "UNDETERMINED",
  7: "FINALIZED",
  8: "CANCELED",
  9: "APPEAL_REVEALING",
  10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE",
  12: "VALIDATORS_TIMEOUT",
  13: "LEADER_TIMEOUT",
};

export function log(...a) {
  console.log(...a);
}

export function step(msg) {
  console.log(`\n\x1b[1m\x1b[35m▸ ${msg}\x1b[0m`);
}

export function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}

export function warn(msg) {
  console.log(`  \x1b[33m!\x1b[0m ${msg}`);
}

/** Cloudflare in front of the hosted simulator drops a connection now and then. */
export const isTransient = (e) =>
  /ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up|Gateway|50[234]/i.test(
    String(e?.message ?? e),
  );

/**
 * Studio consensus on a vision call takes a while. Poll generously, report
 * progress so a long wait does not look like a hang, and survive a dropped
 * connection mid-poll — the transaction is already on the network, so losing
 * the socket is no reason to lose the run.
 */
export async function awaitTx(client, hash, label = "tx", status = "FINALIZED") {
  const started = Date.now();
  const timer = setInterval(() => {
    process.stdout.write(`\r  … ${label} pending ${Math.round((Date.now() - started) / 1000)}s   `);
  }, 2000);
  try {
    let receipt;
    for (let attempt = 1; ; attempt++) {
      try {
        receipt = await client.waitForTransactionReceipt({
          hash,
          status,
          interval: 4000,
          retries: 200,
        });
        break;
      } catch (e) {
        if (!isTransient(e) || attempt >= 4) throw e;
        process.stdout.write("\r".padEnd(48) + "\r");
        warn(`${label}: connection dropped, resuming the wait (${attempt}/3)`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    clearInterval(timer);
    process.stdout.write("\r".padEnd(48) + "\r");
    const secs = Math.round((Date.now() - started) / 1000);
    // The RPC reports status numerically (7 = FINALIZED); normalise for output.
    const name = typeof receipt.status === "number" ? STATUS_NAMES[receipt.status] : receipt.status;
    if (name !== status && name !== "FINALIZED") {
      warn(`${label}: ${name ?? receipt.status} after ${secs}s`);
    } else {
      ok(`${label} ${name} in ${secs}s`);
    }
    return receipt;
  } catch (e) {
    clearInterval(timer);
    process.stdout.write("\r".padEnd(48) + "\r");
    throw e;
  }
}
