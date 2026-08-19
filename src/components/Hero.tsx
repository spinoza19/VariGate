import { useEffect, useState } from "react";
import { CONTRACT_ADDRESS } from "../lib/genlayer";
import { short } from "../lib/format";
import "./hero.css";

const ROTATING = [
  "40% white variegation",
  "no root rot",
  "four established leaves",
  "same cultivar as pictured",
  "arrives in perfect health",
];

export function Hero({
  validators,
  settled,
  locked,
  onStart,
  onBrowse,
}: {
  validators: number;
  settled: number;
  locked: string;
  onStart: () => void;
  onBrowse: () => void;
}) {
  const [i, setI] = useState(0);
  const [clock, setClock] = useState(() => utc());

  useEffect(() => {
    const a = setInterval(() => setI((v) => (v + 1) % ROTATING.length), 2600);
    const b = setInterval(() => setClock(utc()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  return (
    <header className="hero">
      <div className="hero-meta">
        <Meta k="Network" v="GenLayer Studio" />
        <Meta k="Validators" v={validators ? `${validators} live` : "…"} />
        <Meta k="Contract" v={short(CONTRACT_ADDRESS, 5)} />
        <Meta k="UTC" v={clock} />
      </div>

      <hr className="rule-strong" />

      <h1 className="display hero-title">
        The herbarium
        <br />
        of <em>disputed</em>
        <br />
        specimens.
      </h1>

      <div className="hero-body">
        <div className="hero-claim">
          <span className="label">The seller promised</span>
          <div className="hero-rotator">
            {ROTATING.map((t, n) => (
              <span key={t} className="hero-rotator-line" data-on={n === i}>
                “{t}”
              </span>
            ))}
          </div>
          <p className="hero-lede">
            A rare plant is bought from a photograph and a sentence. When the box opens on the
            other side of the world, someone has to decide whether the sentence was true — and no
            marketplace on earth employs a botanist for that.
          </p>
          <p className="hero-lede">
            VariGate holds the money and settles it itself. Two photographs and the seller's own
            words go to an Intelligent Contract on GenLayer. A vision model reports what it sees;
            the contract does the arithmetic; the network agrees on the answer. No support ticket,
            no chargeback, no arbitrator.
          </p>
          <div className="row wrap" style={{ marginTop: 22, gap: 10 }}>
            <button className="btn leaf" onClick={onStart}>
              List a specimen
            </button>
            <button className="btn ghost" onClick={onBrowse}>
              Open the archive
            </button>
          </div>
        </div>

        <aside className="hero-stats">
          <Stat k="Held in escrow" v={`${locked} GEN`} />
          <Stat k="Settled without a human" v={String(settled)} />
          <Stat k="Platform fee" v="2.00%" />
          <Stat k="Unboxing window" v="48 hours" />
          <div className="hero-note">
            <span className="label">Why a chain at all</span>
            <p>
              The judgement has to be one that neither side can quietly re-run until it likes the
              answer. That is the only reason this is on GenLayer and not in a backend somewhere.
            </p>
          </div>
        </aside>
      </div>
    </header>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <span className="hero-meta-item">
      <span className="label">{k}</span>
      <span className="meta">{v}</span>
    </span>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="hero-stat">
      <span className="label">{k}</span>
      <span className="hero-stat-v">{v}</span>
    </div>
  );
}

function utc() {
  return new Date().toISOString().slice(11, 19);
}
