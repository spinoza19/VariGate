import { useEffect, useRef, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import {
  cancel,
  checkDelivery,
  claimNoShip,
  claimNoShow,
  confirmDelivery,
  fundEscrow,
  markShipped,
  readEscrow,
  readImage,
  settle,
  submitArrival,
} from "../lib/contract";
import { prepareImage, type PreparedImage } from "../lib/image";
import { countdown, fromWei, isZero, sameAddress, short, stamp } from "../lib/format";
import { STATUS, parseVerdict, type Config, type Escrow } from "../lib/types";
import { VerdictSheet } from "./VerdictSheet";
import { BeforeAfter } from "./BeforeAfter";
import { Adjudication, type Stage } from "./Adjudication";
import { SpecimenPhoto, StatusChip } from "./SpecimenCard";
import "./detail.css";

export function SpecimenDetail({
  escrow,
  config,
  validators,
  onClose,
  onChanged,
}: {
  escrow: Escrow;
  config: Config | null;
  validators: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { address, client } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackNumber, setTrackNumber] = useState("");
  const [trackUrl, setTrackUrl] = useState("");
  const [arrival, setArrival] = useState<PreparedImage | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);

  const verdict = parseVerdict(escrow);
  const isSeller = sameAddress(address, escrow.seller);
  const isBuyer = sameAddress(address, escrow.buyer);
  const feeBps = config?.fee_bps ?? 200;

  useEffect(() => {
    let live = true;
    readImage(escrow.id, "before").then((u) => live && setBeforeUrl(u)).catch(() => {});
    if (escrow.has_after) {
      readImage(escrow.id, "after").then((u) => live && setAfterUrl(u)).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [escrow.id, escrow.has_after]);

  const run = async (name: string, fn: () => Promise<unknown>) => {
    if (!client) return setError("connect an account first");
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(null);
    }
  };

  const adjudicate = async () => {
    if (!client || !arrival) return;
    setError(null);
    setStage("signing");
    try {
      await submitArrival(client, escrow.id, arrival.bytes, (s) => setStage(s as Stage));
      await onChanged();
      setStage(null);
      setArrival(null);
    } catch (e) {
      // The wait can fail while the transaction itself succeeds. Ask the chain
      // before accusing it of anything.
      try {
        const fresh = await readEscrow(escrow.id);
        if (fresh.verdict) {
          await onChanged();
          setStage(null);
          setArrival(null);
          return;
        }
      } catch {
        /* fall through to the error screen */
      }
      setError(cleanError(e));
      setStage("error");
    }
  };

  return (
    <>
      {stage ? (
        <Adjudication
          beforeUrl={beforeUrl}
          afterUrl={arrival?.previewUrl ?? afterUrl}
          stage={stage}
          validators={validators}
          error={error}
          onRetry={() => void adjudicate()}
          onClose={() => setStage(null)}
        />
      ) : null}

      <div className="detail-scrim" onClick={onClose} />
      <aside className="detail card" role="dialog" aria-label={escrow.species}>
        <header className="detail-head">
          <div className="between">
            <span className="label">Accession № {String(escrow.id).padStart(4, "0")}</span>
            <button className="btn ghost sm" onClick={onClose}>
              Close
            </button>
          </div>
          <h2 className="detail-species">{escrow.species}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            <StatusChip escrow={escrow} />
            <span className="chip neutral">{fromWei(escrow.amount)} GEN</span>
            {escrow.tracking_number ? (
              <span className="chip neutral">{escrow.tracking_number}</span>
            ) : null}
            {escrow.trackable ? <span className="chip green">carrier verified</span> : null}
          </div>
        </header>

        <div className="detail-body">
          <section className="detail-plates">
            {escrow.has_after && beforeUrl && afterUrl ? (
              <BeforeAfter before={beforeUrl} after={afterUrl} />
            ) : (
              <div className="detail-single">
                <SpecimenPhoto id={escrow.id} which="before" />
              </div>
            )}
          </section>

          <section className="detail-claim">
            <span className="label">The seller's written claim</span>
            <blockquote>{escrow.claim}</blockquote>
            <p className="hint">
              This sentence is the contract term. It is passed to the model as quoted data, never
              as an instruction, so a seller cannot write their way to a payout.
            </p>
          </section>

          <section className="detail-facts">
            <Fact k="Consignor" v={short(escrow.seller, 6)} me={isSeller} />
            <Fact k="Recipient" v={isZero(escrow.buyer) ? "unsold" : short(escrow.buyer, 6)} me={isBuyer} />
            <Fact k="Listed" v={stamp(escrow.created_at)} />
            <Fact k="Funded" v={stamp(escrow.funded_at)} />
            <Fact k="Shipped" v={stamp(escrow.shipped_at)} />
            <Fact
              k="Delivered"
              v={
                escrow.delivered_at
                  ? `${stamp(escrow.delivered_at)} (${escrow.delivery_source})`
                  : "not yet recorded"
              }
            />
            <Fact
              k="Unboxing window"
              v={
                escrow.awaiting_delivery
                  ? "opens on delivery"
                  : escrow.seconds_left > 0
                    ? `${countdown(escrow.seconds_left)} left`
                    : escrow.arrival_deadline
                      ? "closed"
                      : "not started"
              }
            />
          </section>

          {verdict ? (
            <VerdictSheet verdict={verdict} amountWei={escrow.amount} feeBps={feeBps} />
          ) : null}

          {error && !stage ? <div className="err">{error}</div> : null}

          <section className="detail-actions">
            {/* -------------------------------------------------- listed -- */}
            {escrow.status === STATUS.LISTED && !isSeller ? (
              <Action
                title="Buy this specimen"
                body={`${fromWei(escrow.amount)} GEN moves into the contract now. It leaves only when a verdict exists, or when the seller misses the 14-day shipping window.`}
                cta="Fund the escrow"
                busy={busy === "fund"}
                onClick={() =>
                  run("fund", () => fundEscrow(client!, escrow.id, BigInt(escrow.amount)))
                }
              />
            ) : null}

            {escrow.status === STATUS.LISTED && isSeller ? (
              <Action
                title="Withdraw the listing"
                body="Nothing is funded yet, so this simply closes the accession."
                cta="Withdraw"
                ghost
                busy={busy === "cancel"}
                onClick={() => run("cancel", () => cancel(client!, escrow.id))}
              />
            ) : null}

            {/* -------------------------------------------------- funded -- */}
            {escrow.status === STATUS.FUNDED && isSeller ? (
              <div className="action">
                <span className="label">Hand over to a carrier</span>
                <p className="action-body">
                  Dispatch starts no clock against the buyer. A carrier URL is optional, but
                  without one only the buyer or the 30 day backstop can open the unboxing window.
                </p>
                <input
                  className="input"
                  placeholder="tracking number"
                  value={trackNumber}
                  onChange={(ev) => setTrackNumber(ev.target.value)}
                />
                <input
                  className="input"
                  placeholder="https://www.dhl.com/track?id=… (optional)"
                  value={trackUrl}
                  onChange={(ev) => setTrackUrl(ev.target.value)}
                />
                <span className="hint">
                  The contract only accepts carrier domains it recognises, so a page you host
                  yourself cannot be used to declare delivery.
                </span>
                <button
                  className="btn leaf block"
                  disabled={trackNumber.trim().length < 4 || busy === "ship"}
                  onClick={() =>
                    run("ship", () =>
                      markShipped(client!, escrow.id, trackUrl.trim(), trackNumber.trim()),
                    )
                  }
                >
                  {busy === "ship" ? <span className="spin" /> : null} Mark as shipped
                </button>
              </div>
            ) : null}

            {escrow.status === STATUS.FUNDED && isBuyer ? (
              <Action
                title="Seller has not shipped"
                body={`Available once 14 days have passed since funding. Returns the full ${fromWei(escrow.amount)} GEN with no fee taken.`}
                cta="Claim the refund"
                ghost
                busy={busy === "noship"}
                onClick={() => run("noship", () => claimNoShip(client!, escrow.id))}
              />
            ) : null}

            {/* ------------------------------------------------- shipped -- */}
            {escrow.awaiting_delivery && isBuyer ? (
              <Action
                title="Has it arrived?"
                body="Recording delivery starts your 48 hour window to file the unboxing. Filing the unboxing does it for you, so this is only worth pressing if you want to open the box later."
                cta="Confirm delivery"
                ghost
                busy={busy === "delivered"}
                onClick={() => run("delivered", () => confirmDelivery(client!, escrow.id))}
              />
            ) : null}

            {escrow.awaiting_delivery && isSeller ? (
              <Action
                title="Waiting on delivery"
                body={
                  escrow.trackable
                    ? "Your dispatch did not start any clock against the buyer, and it cannot. The contract can read the carrier's page itself and will start the window only from a delivery the carrier states for this tracking number."
                    : "Your dispatch did not start any clock against the buyer, and it cannot. No recognised carrier URL is on file, so only the buyer or the 30 day backstop can open the window."
                }
                cta="Check the carrier"
                ghost
                disabled={!escrow.trackable}
                busy={busy === "carrier"}
                onClick={() => run("carrier", () => checkDelivery(client!, escrow.id))}
              />
            ) : null}

            {(escrow.status === STATUS.SHIPPED || escrow.status === STATUS.DELIVERED) && isBuyer ? (
              <div className="action accent">
                <span className="label">File the unboxing</span>
                <p className="action-body">
                  One photograph of the plant as it arrived. This is the transaction that runs the
                  adjudication, and the money is decided by the time it confirms.
                </p>
                <ArrivalPicker value={arrival} onChange={setArrival} onError={setError} />
                <button className="btn accent block" disabled={!arrival} onClick={() => void adjudicate()}>
                  Submit for adjudication
                </button>
              </div>
            ) : null}

            {(escrow.status === STATUS.SHIPPED || escrow.status === STATUS.DELIVERED) && isSeller ? (
              <Action
                title="Buyer never filed"
                body={
                  escrow.seconds_left > 0
                    ? escrow.awaiting_delivery
                      ? `No delivery is on record, so this stays locked for ${countdown(escrow.seconds_left)}: the 30 day transit backstop plus the buyer's full 48 hours.`
                      : `Available in ${countdown(escrow.seconds_left)}, once the buyer's 48 hours since delivery are up.`
                    : "The window has closed with no unboxing. The sale completes in your favour."
                }
                cta="Close in my favour"
                ghost
                disabled={escrow.seconds_left > 0}
                busy={busy === "noshow"}
                onClick={() => run("noshow", () => claimNoShow(client!, escrow.id))}
              />
            ) : null}

            {/* -------------------------------------------------- judged -- */}
            {escrow.status === STATUS.JUDGED ? (
              <Action
                title="Release the funds"
                body="The verdict is on chain. Settlement is public: anyone can trigger it, and it can only pay out what the verdict says."
                cta="Settle"
                busy={busy === "settle"}
                onClick={() => run("settle", () => settle(client!, escrow.id))}
              />
            ) : null}

            {escrow.status === STATUS.SETTLED ? (
              <p className="detail-done">
                Settled. Nothing further to do. The ledger above is what moved.
              </p>
            ) : null}

            {!address ? (
              <p className="hint">Connect an account to act on this specimen.</p>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}

function Fact({ k, v, me }: { k: string; v: string; me?: boolean }) {
  return (
    <div className="fact">
      <span className="label">{k}</span>
      <span className="meta">
        {v}
        {me ? <span className="chip green" style={{ marginLeft: 6 }}>you</span> : null}
      </span>
    </div>
  );
}

function Action({
  title,
  body,
  cta,
  onClick,
  busy,
  ghost,
  disabled,
}: {
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  busy?: boolean;
  ghost?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="action">
      <span className="label">{title}</span>
      <p className="action-body">{body}</p>
      <button
        className={`btn block ${ghost ? "ghost" : "leaf"}`}
        onClick={onClick}
        disabled={busy || disabled}
      >
        {busy ? <span className="spin" /> : null} {cta}
      </button>
    </div>
  );
}

function ArrivalPicker({
  value,
  onChange,
  onError,
}: {
  value: PreparedImage | null;
  onChange: (v: PreparedImage | null) => void;
  onError: (m: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setWorking(true);
    onError(null);
    try {
      onChange(await prepareImage(file));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="picker" onClick={() => input.current?.click()}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void take(e.target.files?.[0])}
      />
      {value ? (
        <>
          <img src={value.previewUrl} alt="arrival" />
          <span className="picker-meta meta">
            {value.width}×{value.height} · {Math.round(value.bytes.length / 1024)} KB on chain
          </span>
        </>
      ) : (
        <span className="picker-empty">
          {working ? <span className="spin" /> : null}
          {working ? " preparing…" : "Drop or choose the arrival photograph"}
        </span>
      )}
    </div>
  );
}

function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // GenVM surfaces UserError messages wrapped in a lot of RPC noise.
  const m = raw.match(/UserError\(?["']?([^"'\)\n]+)/);
  if (m) return m[1];
  return raw.split("\n")[0].slice(0, 260);
}
