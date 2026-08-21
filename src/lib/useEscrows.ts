import { useCallback, useEffect, useRef, useState } from "react";
import { readConfig, readEscrows } from "./contract";
import { networkStats } from "./genlayer";
import type { Config, Escrow } from "./types";

/**
 * The hosted simulator allows 500 requests an hour per caller and sits behind a
 * CDN that drops the occasional connection. Neither is a broken dApp, and
 * neither should be reported to a visitor as a raw viem stack.
 */
export function readableRpcError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  if (/rate limit/i.test(raw)) {
    return "GenLayer Studio is rate limiting this browser (500 requests an hour). The archive will come back on its own shortly.";
  }
  if (/Failed to fetch|NetworkError|ECONNRESET|timeout/i.test(raw)) {
    return "Could not reach GenLayer Studio just now. Retrying automatically.";
  }
  return raw.split("\n")[0].slice(0, 220);
}

export function useEscrows(pollMs = 15_000) {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [validators, setValidators] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  // StrictMode mounts, unmounts and remounts. Re-arm the flag on every mount,
  // otherwise the first teardown latches it off and no state ever lands.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await readEscrows();
      if (!alive.current) return;
      setEscrows(list);
      setError(null);
    } catch (e) {
      if (alive.current) setError(readableRpcError(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void readConfig().then((c) => alive.current && setConfig(c)).catch(() => {});
    void networkStats().then((s) => alive.current && setValidators(s.validators));
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { escrows, config, validators, loading, error, refresh };
}
