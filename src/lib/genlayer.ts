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

/**
 * Client backed by an injected wallet.
 *
 * The address must be passed as a plain string, not an account object.
 * genlayer-js only routes eth_requestAccounts / eth_sendTransaction /
 * personal_sign to the provider when `account` is an address. Hand it an
 * account object and it will look for a local private key instead.
 */
export function clientForProvider(address: string, provider: unknown): Client {
  return createClient({
    chain: studionet,
    account: address as `0x${string}`,
    provider: provider as never,
  }) as Client;
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
 * Studio faucet. Only exists on the simulator. On a real network the
 * equivalent is a bridge deposit, which is why nothing in the UI presents this
 * as anything other than a Studio convenience.
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
