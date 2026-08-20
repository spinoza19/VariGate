import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "../wallet/WalletContext";
import { fromWei, short } from "../lib/format";
import "./wallet.css";

/* ------------------------------------------------------------------ pill -- */

export function WalletPill() {
  const { address, balance, walletIcon, wrongChain } = useWallet();
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  if (!address) {
    return (
      <>
        <button className="btn accent sm" onClick={() => setModal(true)}>
          Connect wallet
        </button>
        {modal ? <ConnectModal onClose={() => setModal(false)} /> : null}
      </>
    );
  }

  return (
    <div className="wallet-anchor" ref={ref}>
      <button className="wallet-pill" data-warn={wrongChain} onClick={() => setMenu((o) => !o)}>
        {walletIcon ? (
          <img className="wallet-avatar" src={walletIcon} alt="" />
        ) : (
          <span className="wallet-avatar" style={{ background: avatarGradient(address) }} />
        )}
        <span className="wallet-pill-text">
          <span className="wallet-addr">{short(address)}</span>
          <span className="wallet-bal">
            {wrongChain ? "wrong network" : `${fromWei(balance, 2)} GEN`}
          </span>
        </span>
      </button>
      {menu ? <AccountMenu onClose={() => setMenu(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------ the modal -- */

export function ConnectModal({ onClose }: { onClose: () => void }) {
  const { wallets, connectWallet, connectDemo, connecting, error, address } = useWallet();

  useEffect(() => {
    if (address) onClose();
  }, [address, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);

    // Freeze the page behind the modal, and pad for the scrollbar we just
    // removed so the layout does not jump sideways as it opens.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prev = { overflow: document.body.style.overflow, pad: document.body.style.paddingRight };
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev.overflow;
      document.body.style.paddingRight = prev.pad;
    };
  }, [onClose]);

  // Portalled to <body> deliberately. The trigger lives inside .topbar, which
  // has a backdrop-filter, and a filtered ancestor becomes the containing
  // block for position:fixed descendants, so an inline modal would be trapped
  // inside the header strip instead of covering the viewport.
  return createPortal(
    <div className="cw-scrim" onClick={onClose}>
      <div
        className="cw card fade-up"
        role="dialog"
        aria-label="Connect a wallet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cw-head">
          <div>
            <span className="label">Connect</span>
            <h2 className="cw-title">Bring your own wallet.</h2>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="cw-body">
          {wallets.length ? (
            <ul className="cw-list">
              {wallets.map((w) => (
                <li key={w.rdns}>
                  <button
                    className="cw-option"
                    disabled={!!connecting}
                    onClick={() => void connectWallet(w.rdns)}
                  >
                    {w.icon ? (
                      <img className="cw-icon" src={w.icon} alt="" />
                    ) : (
                      <span className="cw-icon cw-icon-blank" />
                    )}
                    <span className="cw-name">{w.name}</span>
                    <span className="cw-state">
                      {connecting === w.rdns ? <span className="spin" /> : "→"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="cw-none">
              <span className="label">No wallet detected</span>
              <p>
                Install MetaMask, Rabby or any EIP-6963 wallet and reload, and it will appear
                here on its own. Or try the app with a demo account below.
              </p>
            </div>
          )}

          <div className="cw-note">
            <span className="label">What connecting does</span>
            <p>
              VariGate runs on <strong>GenLayer Studio</strong>, chain 61999. Your wallet is asked
              to add it as a network the first time, and the faucet drops 250 test GEN on your
              address so you can actually transact. Studio is a simulator, so the GEN is not worth
              anything and no mainnet asset is ever touched.
            </p>
          </div>

          {error ? <div className="err">{error}</div> : null}

          <div className="cw-alt">
            <span className="cw-or">
              <span />
              <em className="label">or</em>
              <span />
            </span>
            <button
              className="btn ghost block"
              disabled={!!connecting}
              onClick={() => void connectDemo()}
            >
              {connecting === "demo" ? <span className="spin" /> : null}
              Continue with a demo account
            </button>
            <p className="hint">
              A throwaway key generated in this browser. Nothing to install, nothing to approve,
              but it lives in this browser only.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------- the account -- */

function AccountMenu({ onClose }: { onClose: () => void }) {
  const {
    address,
    balance,
    kind,
    walletName,
    walletIcon,
    wrongChain,
    switchToStudio,
    disconnect,
    topUp,
    error,
  } = useWallet();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="wallet-menu card fade-up">
      <div className="wallet-menu-head">
        <span className="label">Connected</span>
        <span className={`chip ${kind === "wallet" ? "indigo" : "neutral"}`}>
          {walletIcon ? <img className="chip-icon" src={walletIcon} alt="" /> : null}
          {kind === "wallet" ? (walletName ?? "Wallet") : "Demo account"}
        </span>
      </div>

      <button
        className="wallet-full"
        title="Copy address"
        onClick={() => {
          void navigator.clipboard.writeText(address ?? "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {address}
        <em>{copied ? "copied" : "copy"}</em>
      </button>

      {wrongChain ? (
        <div className="wallet-warn">
          <span className="label">Wrong network</span>
          <p>Your wallet has moved off GenLayer Studio. Transactions will fail until it is back.</p>
          <button className="btn accent sm block" onClick={() => void switchToStudio()}>
            Switch to GenLayer Studio
          </button>
        </div>
      ) : null}

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
          Disconnect
        </button>
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        {kind === "wallet"
          ? "Every write is signed in your wallet. Studio is a simulator, so this GEN has no value."
          : "This demo key lives in this browser's storage. Clear the site data and it is gone."}
      </p>

      {error ? (
        <div className="err" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the gate --- */

/** Inline prompt shown on pages that need an account before they do anything. */
export function ConnectGate() {
  const { wallets, connectWallet, connectDemo, connecting, error } = useWallet();
  const [modal, setModal] = useState(false);
  const primary = wallets[0];

  return (
    <div className="card pad connect-gate">
      <div className="between wrap" style={{ gap: 16 }}>
        <div>
          <span className="label">No account connected</span>
          <p className="connect-gate-lede">
            Connect a wallet to list a specimen, fund an escrow or file an unboxing. Reading the
            archive needs nothing at all.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {primary ? (
            <button
              className="btn accent"
              disabled={!!connecting}
              onClick={() => void connectWallet(primary.rdns)}
            >
              {connecting === primary.rdns ? <span className="spin" /> : null}
              {primary.icon ? <img className="cw-icon sm" src={primary.icon} alt="" /> : null}
              Connect {primary.name}
            </button>
          ) : (
            <button className="btn accent" onClick={() => setModal(true)}>
              Connect wallet
            </button>
          )}
          {wallets.length > 1 ? (
            <button className="btn ghost" onClick={() => setModal(true)}>
              Other wallets
            </button>
          ) : null}
          <button className="btn ghost" disabled={!!connecting} onClick={() => void connectDemo()}>
            {connecting === "demo" ? <span className="spin" /> : null} Demo account
          </button>
        </div>
      </div>
      {error ? <div className="err" style={{ marginTop: 14 }}>{error}</div> : null}
      {modal ? <ConnectModal onClose={() => setModal(false)} /> : null}
    </div>
  );
}

export function avatarGradient(addr: string): string {
  const n = parseInt(addr.slice(2, 8), 16);
  const a = n % 360;
  const b = (a + 64) % 360;
  return `linear-gradient(135deg, hsl(${a} 52% 58%), hsl(${b} 62% 42%))`;
}
