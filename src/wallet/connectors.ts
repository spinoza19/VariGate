/**
 * Wallet discovery.
 *
 * EIP-6963 is the reason this file exists. `window.ethereum` is a single slot
 * that whichever extension loaded last gets to squat on, so a browser with
 * MetaMask *and* Rabby installed will silently hand you the wrong one. Under
 * 6963 every wallet announces itself on an event with a name, an icon and a
 * stable reverse-DNS id, and the user picks.
 *
 * `window.ethereum` is still kept as a last resort for wallets that have not
 * adopted the standard.
 */

export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
}

export interface DiscoveredWallet {
  /** Reverse-DNS id, e.g. "io.metamask". Stable across sessions. */
  rdns: string;
  name: string;
  /** Data URI supplied by the wallet itself. */
  icon: string;
  provider: WalletProvider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: WalletProvider;
}

const found = new Map<string, DiscoveredWallet>();
const listeners = new Set<(wallets: DiscoveredWallet[]) => void>();

function emit() {
  const list = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const l of listeners) l(list);
}

let started = false;

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const { info, provider } = (event as CustomEvent<Eip6963Detail>).detail;
    if (!info?.rdns || found.has(info.rdns)) return;
    found.set(info.rdns, {
      rdns: info.rdns,
      name: info.name,
      icon: info.icon,
      provider,
    });
    emit();
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Extensions that inject late still announce; re-ask once the page settles.
  setTimeout(() => window.dispatchEvent(new Event("eip6963:requestProvider")), 900);

  // Pre-6963 fallback. Only used if nothing announced itself by then.
  setTimeout(() => {
    const legacy = (window as unknown as { ethereum?: WalletProvider }).ethereum;
    if (legacy && found.size === 0) {
      found.set("legacy.injected", {
        rdns: "legacy.injected",
        name: "Browser wallet",
        icon: "",
        provider: legacy,
      });
      emit();
    }
  }, 1400);
}

/** Subscribe to the live list of installed wallets. Returns an unsubscribe. */
export function watchWallets(cb: (wallets: DiscoveredWallet[]) => void): () => void {
  start();
  listeners.add(cb);
  cb([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
  return () => void listeners.delete(cb);
}

export function walletByRdns(rdns: string): DiscoveredWallet | undefined {
  return found.get(rdns);
}

// --------------------------------------------------------------------------- //
// Network handling
// --------------------------------------------------------------------------- //

import { CHAIN, RPC_URL } from "../lib/genlayer";

export const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}` as const;

const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "GenLayer Studio",
  rpcUrls: [RPC_URL],
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
};

/**
 * Put the wallet on GenLayer Studio, adding the network if it has never seen
 * it. Studio answers eth_chainId, net_version, eth_getBlockByNumber,
 * eth_gasPrice and eth_estimateGas, which is everything a wallet needs to
 * treat it as an ordinary EVM chain.
 */
export async function ensureChain(provider: WalletProvider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === CHAIN_ID_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    // 4902 = unrecognised chain. Some wallets nest it under `data`.
    const code = (err as { code?: number; data?: { originalError?: { code?: number } } })?.code;
    const nested = (err as { data?: { originalError?: { code?: number } } })?.data?.originalError
      ?.code;
    if (code !== 4902 && nested !== 4902) throw err;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [CHAIN_PARAMS],
    });
  }
}

/** Turn a wallet rejection into something worth showing a person. */
export function readableWalletError(err: unknown): string {
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) return "You rejected the request in your wallet.";
  if (e?.code === -32002) return "Your wallet already has a pending request. Open it and finish there.";
  if (e?.code === 4902) return "Your wallet refused to add the GenLayer Studio network.";
  const msg = e?.message ?? String(err);
  return msg.split("\n")[0].slice(0, 200);
}
