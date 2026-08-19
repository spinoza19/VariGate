import { useEffect, useMemo, useRef, useState } from "react";
import "./adjudication.css";

export type Stage = "signing" | "submitted" | "finalized" | "error";

const SCRIPT: { at: number; line: string }[] = [
  { at: 0, line: "transaction signed locally" },
  { at: 3, line: "broadcast to studionet" },
  { at: 8, line: "leader elected, GenVM booting" },
  { at: 14, line: "both plates decoded from calldata" },
  { at: 20, line: "observation rubric dispatched to a vision model" },
  { at: 38, line: "leader receipt sealed" },
  { at: 46, line: "validators re-deriving the payout arithmetic" },
  { at: 62, line: "votes collecting" },
  { at: 84, line: "still gathering — vision consensus is the slow part" },
];

/**
 * The waiting room for `submit_arrival`.
 *
 * The stage text and the elapsed clock are real. The ring is the network's real
 * validator count, animated as a progress indicator — it is deliberately not
 * presented as a live per-validator vote feed, because the RPC does not expose
 * one until the receipt lands.
 */
export function Adjudication({
  beforeUrl,
  afterUrl,
  stage,
  validators,
  error,
  onRetry,
  onClose,
}: {
  beforeUrl: string | null;
  afterUrl: string | null;
  stage: Stage;
  validators: number;
  error?: string | null;
  onRetry?: () => void;
  onClose?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  const lines = useMemo(() => SCRIPT.filter((s) => s.at <= elapsed).slice(-6), [elapsed]);
  const nodes = Math.max(8, validators || 20);
  const lit = stage === "finalized" ? nodes : Math.min(nodes, Math.floor(elapsed / 3.2));

  return (
    <div className="adj" role="dialog" aria-label="Adjudication in progress">
      <div className="adj-inner">
        <div className="adj-head">
          <span className="label" style={{ color: "#b9ae9a" }}>
            {stage === "error" ? "Adjudication failed" : "Adjudication in progress"}
          </span>
          <span className="adj-clock">{String(elapsed).padStart(3, "0")}s</span>
        </div>

        <div className="adj-plates">
          <Plate url={beforeUrl} caption="Plate I — as listed" scanning={stage !== "finalized" && stage !== "error"} />
          <div className="adj-vs">
            <span className="adj-vs-line" />
            <span className="label">versus</span>
            <span className="adj-vs-line" />
          </div>
          <Plate url={afterUrl} caption="Plate II — on arrival" scanning={stage !== "finalized" && stage !== "error"} delay />
        </div>

        <div className="adj-ring-wrap">
          <div className="adj-ring">
            {Array.from({ length: nodes }, (_, i) => {
              const a = (i / nodes) * Math.PI * 2 - Math.PI / 2;
              return (
                <span
                  key={i}
                  className="adj-node"
                  data-on={i < lit}
                  style={{
                    left: `${50 + Math.cos(a) * 44}%`,
                    top: `${50 + Math.sin(a) * 44}%`,
                    transitionDelay: `${i * 26}ms`,
                  }}
                />
              );
            })}
            <span className="adj-ring-core">
              <span className="adj-ring-num">{validators || "—"}</span>
              <span className="label">validators</span>
            </span>
          </div>

          <ol className="adj-log">
            {lines.map((l) => (
              <li key={l.at} className="fade-up">
                <span className="adj-log-at">{String(l.at).padStart(2, "0")}s</span>
                {l.line}
              </li>
            ))}
            {stage === "error" ? <li className="adj-log-err">{error ?? "execution reverted"}</li> : null}
          </ol>
        </div>

        {stage === "error" ? (
          <div className="adj-actions">
            <p className="adj-explain">
              The leader's model can time out or hand back something the contract refuses to parse.
              Nothing moved — the escrow is untouched and the photograph was not stored. Sending it
              again picks a fresh leader.
            </p>
            <div className="row" style={{ gap: 10 }}>
              {onRetry ? (
                <button className="btn accent" onClick={onRetry}>
                  Send it again
                </button>
              ) : null}
              {onClose ? (
                <button className="btn ghost" style={{ color: "#e8e1d2", borderColor: "#5a5142" }} onClick={onClose}>
                  Close
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="adj-explain">
            Twenty-odd independent nodes are reading the same two photographs. This normally takes
            a minute or two. Leaving this page does not cancel it — the verdict lands on the
            specimen either way.
          </p>
        )}
      </div>
    </div>
  );
}

function Plate({
  url,
  caption,
  scanning,
  delay,
}: {
  url: string | null;
  caption: string;
  scanning: boolean;
  delay?: boolean;
}) {
  return (
    <figure className="adj-plate">
      <div className="adj-plate-frame">
        {url ? <img src={url} alt={caption} /> : <div className="adj-plate-empty" />}
        {scanning ? (
          <span className="adj-scan" style={{ animationDelay: delay ? "0.9s" : "0s" }} />
        ) : null}
        <span className="adj-grid" />
      </div>
      <figcaption className="label">{caption}</figcaption>
    </figure>
  );
}
