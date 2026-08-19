import { useCallback, useEffect, useRef, useState } from "react";
import { readConfig, readEscrows } from "./contract";
import { networkStats } from "./genlayer";
import type { Config, Escrow } from "./types";

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
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
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
