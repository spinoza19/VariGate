import { useEffect, useRef, useState } from "react";
import { CONNECTORS, useWallet } from "../wallet/WalletContext";
import { fromWei, short } from "../lib/format";
import "./wallet.css";

export function WalletPill() {
  const { address, balance, connect, connecting } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!address) {
    return (
      <button className="btn accent sm" onClick={() => void connect("burner")} disabled={connecting}>
        {connecting ? <span className="spin" /> : null}
        {connecting ? "Opening" : "Connect"}
      </button>
    );
  }

  return (
    <div className="wallet-anchor" ref={ref}>
      <button className="wallet-pill" onClick={() => setOpen((o) => !o)}>
        <span className="wallet-avatar" style={{ background: avatarGradient(address) }} />
        <span className="wallet-pill-text">
          <span className="wallet-addr">{short(address)}</span>
          <span className="wallet-bal">{fromWei(balance, 2)} GEN</span>
        </span>
      </button>
      {open ? <WalletMenu onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function WalletMenu({ onClose }: { onClose: () => void }) {
  const { address, balance, connectorId, disconnect, topUp, exportKey, importKey, error } =
    useWallet();
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [importing, setImporting] = useState("");

  const key = exportKey();

  return (
    <div className="wallet-menu card fade-up">
      <div className="wallet-menu-head">
        <span className="label">Session account</span>
        <span className="chip indigo">
          {CONNECTORS.find((c) => c.id === connectorId)?.name ?? connectorId}
        </span>
      </div>

      <code className="wallet-full">{address}</code>

      <div className="wallet-balance">
        <span className="display" style={{ fontSize: 40 }}>
          {fromWei(balance, 3)}
        </span>
        <span className="label" style={{ marginLeft: 6 }}>
          GEN
        </span>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn ghost sm grow"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await topUp();
            setBusy(false);
          }}
        >
          {busy ? <span className="spin" /> : null} Faucet +250
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            disconnect();
            onClose();
          }}
        >
          Sign out
        </button>
      </div>

      {connectorId === "burner" ? (
        <>
          <hr className="rule" style={{ margin: "16px 0 12px" }} />
          <span className="label">Portable key</span>
          <p className="hint" style={{ marginTop: 4 }}>
            This burner lives in this browser only. Copy the key to move the same account to
            another device, or paste one in to take it over.
          </p>
          {revealed && key ? (
            <code className="wallet-key">{key}</code>
          ) : (
            <button className="btn ghost sm block" onClick={() => setRevealed(true)}>
              Reveal key
            </button>
          )}
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <input
              className="input"
              style={{ fontSize: 11 }}
              placeholder="0x… import a key"
              value={importing}
              onChange={(e) => setImporting(e.target.value)}
            />
            <button
              className="btn sm"
              disabled={!importing}
              onClick={() => void importKey(importing).then(() => setImporting(""))}
            >
              Use
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <div className="err" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** Connector chooser shown on first visit. */
export function ConnectGate() {
  const { connect, connecting, error } = useWallet();

  return (
    <div className="card pad connect-gate">
      <span className="label">Pick a way in</span>
      <div className="connect-grid">
        {CONNECTORS.map((c) => {
          const ready = c.available();
          return (
            <button
              key={c.id}
              className="connect-option"
              disabled={!ready || connecting}
              onClick={() => void connect(c.id)}
            >
              <span className="connect-name">
                {c.name}
                {c.id === "burner" ? <span className="chip green">recommended</span> : null}
                {!ready ? <span className="chip neutral">not detected</span> : null}
              </span>
              <span className="connect-blurb">{c.blurb}</span>
              <span className="connect-arrow">→</span>
            </button>
          );
        })}
      </div>
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

export function avatarGradient(addr: string): string {
  const n = parseInt(addr.slice(2, 8), 16);
  const a = n % 360;
  const b = (a + 64) % 360;
  return `linear-gradient(135deg, hsl(${a} 52% 58%), hsl(${b} 62% 42%))`;
}
