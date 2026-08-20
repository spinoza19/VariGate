import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clientForKey,
  clientForProvider,
  createAccount,
  faucet,
  generatePrivateKey,
  getBalance,
  type Client,
} from "../lib/genlayer";
import {
  CHAIN_ID_HEX,
  ensureChain,
  readableWalletError,
  walletByRdns,
  watchWallets,
  type DiscoveredWallet,
  type WalletProvider as EipProvider,
} from "./connectors";

/**
 * Two ways in, and they are not equals.
 *
 *  wallet — a real EIP-6963 wallet. Studio answers enough of the standard EVM
 *           surface that MetaMask, Rabby and friends can add it as an ordinary
 *           network and sign for it; no GenLayer snap and no MetaMask Flask.
 *  demo   — a keypair generated in this browser, funded from the Studio faucet.
 *           For people who want to try the thing without installing anything.
 */
export type ConnectionKind = "wallet" | "demo";

const LAST_WALLET = "varigate.wallet.rdns";
const LAST_KIND = "varigate.wallet.kind";
const DEMO_KEY = "varigate.demo.key";

interface WalletState {
  address: string | null;
  kind: ConnectionKind | null;
  /** Display name of the connected wallet, e.g. "MetaMask". */
  walletName: string | null;
  walletIcon: string | null;
  client: Client | null;
  balance: bigint;
  wallets: DiscoveredWallet[];
  connecting: string | null;
  error: string | null;
  wrongChain: boolean;
  connectWallet: (rdns: string) => Promise<void>;
  connectDemo: () => Promise<void>;
  switchToStudio: () => Promise<void>;
  disconnect: () => void;
  topUp: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [kind, setKind] = useState<ConnectionKind | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletIcon, setWalletIcon] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongChain, setWrongChain] = useState(false);

  const mounted = useRef(true);
  const activeProvider = useRef<EipProvider | null>(null);

  // StrictMode mounts, unmounts and remounts; re-arm on every mount or the
  // first teardown latches this off and no state ever lands.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => watchWallets((w) => mounted.current && setWallets(w)), []);

  // ------------------------------------------------------------ balance ---

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const b = await getBalance(address);
      if (mounted.current) setBalance(b);
    } catch {
      /* the simulator blips; the next poll picks it up */
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    void refresh();
    const t = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(t);
  }, [address, refresh]);

  /**
   * Studio has no bridge, so a fresh address is stuck at zero until the faucet
   * touches it. Worth one retry: the simulator sits behind a CDN that drops the
   * occasional request, and arriving with no GEN makes the whole app look broken.
   */
  const fundIfEmpty = useCallback(async (addr: string) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if ((await getBalance(addr)) >= 10n ** 18n) return;
        await faucet(addr, 250);
        await new Promise((r) => setTimeout(r, 1500));
        if ((await getBalance(addr)) > 0n) return;
      } catch {
        /* fall through to the retry, then to the manual top-up button */
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 2500));
    }
  }, []);

  // ------------------------------------------------------------- wallet ---

  const attach = useCallback(
    (provider: EipProvider, addr: string, name: string, icon: string, rdns: string) => {
      activeProvider.current = provider;
      setAddress(addr);
      setClient(clientForProvider(addr, provider));
      setKind("wallet");
      setWalletName(name);
      setWalletIcon(icon || null);
      setWrongChain(false);
      localStorage.setItem(LAST_KIND, "wallet");
      localStorage.setItem(LAST_WALLET, rdns);
    },
    [],
  );

  const connectWallet = useCallback(
    async (rdns: string) => {
      const found = walletByRdns(rdns);
      if (!found) {
        setError("That wallet is no longer available in this browser.");
        return;
      }
      setConnecting(rdns);
      setError(null);
      try {
        const accounts = (await found.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts?.length) throw new Error("Your wallet returned no accounts.");

        await ensureChain(found.provider);
        await fundIfEmpty(accounts[0]);

        attach(found.provider, accounts[0], found.name, found.icon, rdns);
      } catch (e) {
        setError(readableWalletError(e));
      } finally {
        if (mounted.current) setConnecting(null);
      }
    },
    [attach, fundIfEmpty],
  );

  const switchToStudio = useCallback(async () => {
    const provider = activeProvider.current;
    if (!provider) return;
    setError(null);
    try {
      await ensureChain(provider);
      setWrongChain(false);
    } catch (e) {
      setError(readableWalletError(e));
    }
  }, []);

  // React to the wallet being driven from its own UI.
  useEffect(() => {
    const provider = activeProvider.current;
    if (!provider?.on) return;

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      if (!accounts?.length) {
        disconnect();
        return;
      }
      setAddress(accounts[0]);
      setClient(clientForProvider(accounts[0], provider));
      void fundIfEmpty(accounts[0]);
    };
    const onChain = (...args: never[]) => {
      const chainId = args[0] as unknown as string;
      setWrongChain(chainId?.toLowerCase() !== CHAIN_ID_HEX);
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, kind]);

  // --------------------------------------------------------------- demo ---

  const connectDemo = useCallback(async () => {
    setConnecting("demo");
    setError(null);
    try {
      let key = localStorage.getItem(DEMO_KEY) ?? "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
        key = generatePrivateKey();
        localStorage.setItem(DEMO_KEY, key);
      }
      const acct = createAccount(key as `0x${string}`);
      await fundIfEmpty(acct.address);

      activeProvider.current = null;
      setAddress(acct.address);
      setClient(clientForKey(key as `0x${string}`));
      setKind("demo");
      setWalletName(null);
      setWalletIcon(null);
      setWrongChain(false);
      localStorage.setItem(LAST_KIND, "demo");
      localStorage.removeItem(LAST_WALLET);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setConnecting(null);
    }
  }, [fundIfEmpty]);

  // ------------------------------------------------------- reconnection ---

  // A demo account is just a local key, so it comes back silently. A real
  // wallet only reconnects if it still reports the site as authorised —
  // eth_accounts never prompts, so this stays quiet either way.
  useEffect(() => {
    const last = localStorage.getItem(LAST_KIND);
    if (last === "demo") {
      void connectDemo();
      return;
    }
    if (last !== "wallet") return;

    const rdns = localStorage.getItem(LAST_WALLET);
    if (!rdns) return;
    const found = wallets.find((w) => w.rdns === rdns);
    if (!found || address) return;

    void (async () => {
      try {
        const accounts = (await found.provider.request({ method: "eth_accounts" })) as string[];
        if (!accounts?.length) return;
        const chainId = (await found.provider.request({ method: "eth_chainId" })) as string;
        attach(found.provider, accounts[0], found.name, found.icon, rdns);
        setWrongChain(chainId?.toLowerCase() !== CHAIN_ID_HEX);
      } catch {
        /* silent — the user can always click connect */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets]);

  // -------------------------------------------------------------- misc ---

  const disconnect = useCallback(() => {
    activeProvider.current = null;
    setAddress(null);
    setClient(null);
    setKind(null);
    setWalletName(null);
    setWalletIcon(null);
    setBalance(0n);
    setWrongChain(false);
    localStorage.removeItem(LAST_KIND);
    localStorage.removeItem(LAST_WALLET);
  }, []);

  const topUp = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      await faucet(address, 250);
      await new Promise((r) => setTimeout(r, 1200));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [address, refresh]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      kind,
      walletName,
      walletIcon,
      client,
      balance,
      wallets,
      connecting,
      error,
      wrongChain,
      connectWallet,
      connectDemo,
      switchToStudio,
      disconnect,
      topUp,
      refresh,
    }),
    [
      address,
      kind,
      walletName,
      walletIcon,
      client,
      balance,
      wallets,
      connecting,
      error,
      wrongChain,
      connectWallet,
      connectDemo,
      switchToStudio,
      disconnect,
      topUp,
      refresh,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
