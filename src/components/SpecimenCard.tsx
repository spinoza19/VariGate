import { useEffect, useState } from "react";
import { readImage } from "../lib/contract";
import { countdown, fromWei, isZero, short } from "../lib/format";
import { STATUS, STATUS_LABEL, TIER_LABEL, TIER_TONE, parseVerdict, type Escrow } from "../lib/types";
import "./specimen.css";

export function SpecimenCard({
  escrow,
  onOpen,
  index,
}: {
  escrow: Escrow;
  onOpen: () => void;
  index: number;
}) {
  const verdict = parseVerdict(escrow);
  const tone = verdict ? TIER_TONE[verdict.tier] : "neutral";
  const judged = escrow.status >= STATUS.JUDGED && escrow.status !== STATUS.CANCELLED;

  return (
    <article
      className="sheet fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : undefined)}
    >
      <div className="sheet-plate">
        <SpecimenPhoto id={escrow.id} which={escrow.has_after ? "after" : "before"} />
        <span className="sheet-accession">№ {String(escrow.id).padStart(4, "0")}</span>
        {judged && verdict ? (
          <span className={`sheet-stamp ${tone}`}>
            {TIER_LABEL[verdict.tier]}
            <em>{verdict.seller_pct}% to seller</em>
          </span>
        ) : null}
      </div>

      <div className="sheet-label">
        <div className="between" style={{ alignItems: "flex-start" }}>
          <h3 className="sheet-species">{escrow.species}</h3>
          <StatusChip escrow={escrow} />
        </div>

        <p className="sheet-claim">{escrow.claim}</p>

        <dl className="sheet-rows">
          <Row k="Price" v={`${fromWei(escrow.amount)} GEN`} />
          <Row k="Consignor" v={short(escrow.seller)} />
          <Row k="Recipient" v={isZero(escrow.buyer) ? "—" : short(escrow.buyer)} />
          {escrow.status === STATUS.SHIPPED ? (
            <Row k="Unboxing closes" v={countdown(escrow.seconds_left)} />
          ) : null}
        </dl>
      </div>
    </article>
  );
}

export function StatusChip({ escrow }: { escrow: Escrow }) {
  const s = escrow.status;
  const tone =
    s === STATUS.SETTLED
      ? "neutral"
      : s === STATUS.JUDGED
        ? "indigo"
        : s === STATUS.SHIPPED
          ? "amber"
          : s === STATUS.CANCELLED
            ? "red"
            : "green";
  return (
    <span className={`chip ${tone}`}>
      {s === STATUS.SHIPPED ? <span className="dot pulse" /> : null}
      {STATUS_LABEL[s]}
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="sheet-row">
      <dt className="label">{k}</dt>
      <dd className="meta">{v}</dd>
    </div>
  );
}

/** Photographs live in contract storage; fetch lazily and cache per id. */
export function SpecimenPhoto({
  id,
  which,
  className,
}: {
  id: number;
  which: "before" | "after";
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    readImage(id, which)
      .then((u) => live && (u ? setUrl(u) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, which]);

  if (failed) return <div className={`photo-empty ${className ?? ""}`}>no plate</div>;
  if (!url) return <div className={`photo-skeleton ${className ?? ""}`} />;
  return <img className={`photo ${className ?? ""}`} src={url} alt={`${which} photograph`} />;
}
