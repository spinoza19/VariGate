import { useEffect, useState } from "react";
import { TIER_LABEL, TIER_TONE, type Verdict } from "../lib/types";
import { fromWei } from "../lib/format";
import "./verdict.css";

const BANDS = ["none", "low", "mid", "high"];

export function VerdictSheet({
  verdict,
  amountWei,
  feeBps,
  animate = false,
}: {
  verdict: Verdict;
  amountWei: string;
  feeBps: number;
  animate?: boolean;
}) {
  const tone = TIER_TONE[verdict.tier];
  const score = useCountUp(verdict.score, animate ? 900 : 0);

  const total = BigInt(amountWei);
  const fee = (total * BigInt(feeBps)) / 10000n;
  const distributable = total - fee;
  const toSeller = (distributable * BigInt(verdict.seller_pct)) / 100n;
  const toBuyer = distributable - toSeller;

  const o = verdict.observations;

  return (
    <section className={`verdict ${tone}`}>
      <div className="verdict-head">
        <div>
          <span className="label">Determination</span>
          <h3 className="verdict-tier">{TIER_LABEL[verdict.tier]}</h3>
          <span className="meta">
            {verdict.auto
              ? `automatic — ${verdict.auto.replace(/_/g, " ")}`
              : `adjudicated on-chain${verdict.days_in_transit != null ? ` · ${verdict.days_in_transit}d in transit` : ""}`}
          </span>
        </div>
        <ScoreDial score={score} tone={tone} />
      </div>

      <div className="verdict-split">
        <span className="label">Where the {fromWei(total)} GEN goes</span>
        <div className="split-bar">
          <span
            className="split-seg seller"
            style={{ flexGrow: Number(toSeller) || 0.0001 }}
            title="seller"
          />
          <span
            className="split-seg buyer"
            style={{ flexGrow: Number(toBuyer) || 0.0001 }}
            title="buyer"
          />
          <span className="split-seg fee" style={{ flexGrow: Number(fee) || 0.0001 }} title="fee" />
        </div>
        <div className="split-keys">
          <SplitKey cls="seller" k="Seller" v={fromWei(toSeller)} pct={verdict.seller_pct} />
          <SplitKey cls="buyer" k="Buyer refund" v={fromWei(toBuyer)} pct={100 - verdict.seller_pct} />
          <SplitKey cls="fee" k="Protocol" v={fromWei(fee)} pct={feeBps / 100} />
        </div>
      </div>

      {o ? (
        <div className="verdict-obs">
          <span className="label">What the model reported seeing</span>
          <div className="obs-grid">
            <Delta k="Leaves" before={String(o.leaves_before)} after={String(o.leaves_after)} worse={o.leaves_after < o.leaves_before} />
            <Delta
              k="Variegation"
              before={o.variegation_before}
              after={o.variegation_after}
              worse={BANDS.indexOf(o.variegation_after) < BANDS.indexOf(o.variegation_before)}
            />
            <Flag k="Same cultivar" ok={o.cultivar_match} note={o.cultivar_note} />
            <Flag k="Claim supported" ok={o.claim_supported} note={o.claim_note} />
            <Flag
              k="Rot"
              ok={!o.rot_present}
              yes="none"
              no="present"
              note={o.rot_present ? "soft or blackened tissue" : "nothing visible"}
            />
            <div className="obs-cell">
              <span className="label">Damage</span>
              <span className={`obs-value ${o.damage_level === "none" ? "good" : "bad"}`}>
                {o.damage_level}
              </span>
              <span className="obs-note">
                {o.damage_level === "none" ? "no deduction" : `attributed to ${o.damage_cause}`}
              </span>
            </div>
          </div>

          <div className="obs-confidence">
            <span className="label">Reader confidence</span>
            <div className="conf-track">
              <span className="conf-fill" style={{ width: `${o.confidence}%` }} />
            </div>
            <span className="meta">{o.confidence}%</span>
          </div>

          {o.notes ? <p className="obs-notes">“{o.notes}”</p> : null}
        </div>
      ) : null}

      <div className="verdict-ledger">
        <span className="label">How the score was reached</span>
        <ul>
          {verdict.breakdown.map((line, i) => (
            <li
              key={i}
              className="ledger-line fade-up"
              style={{ animationDelay: animate ? `${400 + i * 130}ms` : "0ms" }}
            >
              {line}
            </li>
          ))}
        </ul>
        <p className="verdict-foot">
          The model was never asked how much money to move. It answered a fixed set of observation
          questions; every deduction above is plain arithmetic the validators re-ran over its
          answers.
        </p>
      </div>
    </section>
  );
}

function SplitKey({ cls, k, v, pct }: { cls: string; k: string; v: string; pct: number }) {
  return (
    <span className="split-key">
      <span className={`split-swatch ${cls}`} />
      <span className="label">{k}</span>
      <span className="split-amt">
        {v} <em>GEN</em>
      </span>
      <span className="meta">{pct}%</span>
    </span>
  );
}

function Delta({ k, before, after, worse }: { k: string; before: string; after: string; worse: boolean }) {
  return (
    <div className="obs-cell">
      <span className="label">{k}</span>
      <span className="obs-value">
        {before} <span className={`obs-arrow ${worse ? "bad" : ""}`}>→</span> {after}
      </span>
      <span className="obs-note">{worse ? "declined in transit" : "held"}</span>
    </div>
  );
}

function Flag({
  k,
  ok,
  note,
  yes = "yes",
  no = "no",
}: {
  k: string;
  ok: boolean;
  note?: string;
  yes?: string;
  no?: string;
}) {
  return (
    <div className="obs-cell">
      <span className="label">{k}</span>
      <span className={`obs-value ${ok ? "good" : "bad"}`}>{ok ? yes : no}</span>
      {note ? <span className="obs-note">{note}</span> : null}
    </div>
  );
}

function ScoreDial({ score, tone }: { score: number; tone: string }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className={`dial ${tone}`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="dial-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="dial-fill"
          strokeDasharray={`${(c * score) / 100} ${c}`}
        />
      </svg>
      <span className="dial-num">{score}</span>
      <span className="dial-cap label">condition score</span>
    </div>
  );
}

function useCountUp(target: number, ms: number) {
  const [v, setV] = useState(ms ? 0 : target);
  useEffect(() => {
    if (!ms) {
      setV(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
