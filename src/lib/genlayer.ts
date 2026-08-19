import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";
import deployment from "../../deployments/studionet.json";

export const CHAIN = studionet;
export const RPC_URL = studionet.rpcUrls.default.http[0];

/**
 * Deployed address. A Vercel env var wins so the same build can be pointed at a
 * freshly deployed instance; otherwise we fall back to the manifest that
 * `npm run deploy` writes into the repo.
 */
export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ??
  deployment.address) as `0x${string}`;

export type Client = GenLayerClient<typeof studionet>;

export function publicClient(): Client {
  return createClient({ chain: studionet }) as Client;
}

export function clientForKey(privateKey: `0x${string}`): Client {
  return createClient({ chain: studionet, account: createAccount(privateKey) }) as Client;
}

export function clientForProvider(provider: unknown): Client {
  return createClient({ chain: studionet, provider: provider as never }) as Client;
}

export { createAccount, generatePrivateKey };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json.result as T;
}

export async function getBalance(address: string): Promise<bigint> {
  return BigInt(await rpc<string>("eth_getBalance", [address, "latest"]));
}

/**
 * Studio faucet. Only exists on the simulator — on a real network this is a
 * bridge deposit instead, which is exactly why the burner wallet below is
 * labelled as a Studio-only convenience.
 */
export async function faucet(address: string, gen = 250): Promise<string> {
  return rpc<string>("sim_fundAccount", [address, Number(BigInt(gen) * 10n ** 18n)]);
}

export async function networkStats(): Promise<{ validators: number }> {
  try {
    return { validators: await rpc<number>("sim_countValidators", []) };
  } catch {
    return { validators: 0 };
  }
}
