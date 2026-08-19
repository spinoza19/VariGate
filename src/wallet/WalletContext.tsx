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

/**
 * Two ways in.
 *
 *  burner   — a keypair generated in the browser and kept in localStorage,
 *             topped up from the Studio faucet. This is the path that actually
 *             works against the hosted simulator, because Studio accounts are
 *             not MetaMask accounts.
 *  injected — an EIP-1193 provider (MetaMask + the GenLayer snap). Wired up and
 *             offered, but it targets the real networks; on Studio it will tell
 *             you so rather than failing silently halfway through a signature.
 */
export type ConnectorId = "burner" | "injected";

export interface Connector {
  id: ConnectorId;
  name: string;
  blurb: string;
  available: () => boolean;
}

export const CONNECTORS: Connector[] = [
  {
    id: "burner",
    name: "Studio burner",
    blurb: "Keypair in this browser, funded by the Studio faucet. No extension needed.",
    available: () => true,
  },
  {
    id: "injected",
    name: "MetaMask",
    blurb: "Uses the GenLayer snap. Built for the public networks, not the simulator.",
    available: () => typeof window !== "undefined" && !!(window as never as EthWindow).ethereum,
  },
];

type EthWindow = { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } };

const KEY_STORE = "varigate.burner.key";
const CONNECTOR_STORE = "varigate.connector";

interface WalletState {
  address: string | null;
  connectorId: ConnectorId | null;
  client: Client | null;
  balance: bigint;
  connecting: boolean;
  error: string | null;
  connect: (id: ConnectorId) => Promise<void>;
  disconnect: () => void;
  topUp: () => Promise<void>;
  refresh: () => Promise<void>;
  exportKey: () => string | null;
  importKey: (key: string) => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState<ConnectorId | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  // See useEscrows: StrictMode's double-invoke would otherwise latch this off.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const b = await getBalance(address);
      if (mounted.current) setBalance(b);
    } catch {
      /* the simulator occasionally blips; the next poll will pick it up */
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    void refresh();
    const t = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(t);
  }, [address, refresh]);

  const connectBurner = useCallback(async (existing?: string) => {
    let key = existing ?? localStorage.getItem(KEY_STORE) ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      key = generatePrivateKey();
      localStorage.setItem(KEY_STORE, key);
    } else {
      localStorage.setItem(KEY_STORE, key);
    }
    const acct = createAccount(key as `0x${string}`);
    const c = clientForKey(key as `0x${string}`);

    // A brand new burner has nothing to spend. Ask the faucet once, quietly.
    const bal = await getBalance(acct.address);
    if (bal < 10n ** 19n) {
      try {
        await faucet(acct.address, 250);
      } catch {
        /* faucet is best-effort; the UI exposes a manual top-up button */
      }
    }

    setAddress(acct.address);
    setClient(c);
    setConnectorId("burner");
    localStorage.setItem(CONNECTOR_STORE, "burner");
  }, []);

  const connectInjected = useCallback(async () => {
    const eth = (window as never as EthWindow).ethereum;
    if (!eth) throw new Error("no injected wallet found");
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.length) throw new Error("wallet returned no accounts");
    const c = clientForProvider(eth);
    setAddress(accounts[0]);
    setClient(c);
    setConnectorId("injected");
    localStorage.setItem(CONNECTOR_STORE, "injected");
  }, []);

  const connect = useCallback(
    async (id: ConnectorId) => {
      setConnecting(true);
      setError(null);
      try {
        if (id === "burner") await connectBurner();
        else await connectInjected();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current) setConnecting(false);
      }
    },
    [connectBurner, connectInjected],
  );

  // Reconnect a burner silently on reload — it is just a local key, there is
  // nothing to approve. An injected wallet always asks again.
  useEffect(() => {
    if (localStorage.getItem(CONNECTOR_STORE) === "burner") void connect("burner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setClient(null);
    setConnectorId(null);
    setBalance(0n);
    localStorage.removeItem(CONNECTOR_STORE);
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

  const exportKey = useCallback(
    () => (connectorId === "burner" ? localStorage.getItem(KEY_STORE) : null),
    [connectorId],
  );

  const importKey = useCallback(
    async (key: string) => {
      setError(null);
      const trimmed = key.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
        setError("that does not look like a 32-byte hex private key");
        return;
      }
      await connectBurner(trimmed);
    },
    [connectBurner],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      connectorId,
      client,
      balance,
      connecting,
      error,
      connect,
      disconnect,
      topUp,
      refresh,
      exportKey,
      importKey,
    }),
    [
      address,
      connectorId,
      client,
      balance,
      connecting,
      error,
      connect,
      disconnect,
      topUp,
      refresh,
      exportKey,
      importKey,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
