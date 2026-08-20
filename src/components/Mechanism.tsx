import "./mechanism.css";

/**
 * The one diagram worth drawing: where the LLM stops and the arithmetic starts.
 * Everything left of the seam is judgement; everything right of it is a sum
 * that any validator can redo without a model.
 */
export function Mechanism() {
  return (
    <section className="mech">
      <div className="mech-head">
        <span className="label">The mechanism</span>
        <h2 className="display mech-title">
          The model never
          <br />
          touches the money.
        </h2>
        <p className="mech-lede">
          Ask a language model “how much should the seller get?” and you have built a slot machine:
          nothing is reproducible and nobody can check it. So the contract asks a narrower question,
          and does the sum itself.
        </p>
      </div>

      <svg className="mech-svg" viewBox="0 0 980 320" role="img" aria-label="Adjudication pipeline">
        <defs>
          <marker id="mArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* the seam */}
        <line x1="520" y1="18" x2="520" y2="302" className="mech-seam" />
        <text x="512" y="14" className="mech-seam-label" textAnchor="end">
          JUDGEMENT
        </text>
        <text x="528" y="14" className="mech-seam-label">
          ARITHMETIC
        </text>

        {/* inputs */}
        <g className="mech-node">
          <rect x="16" y="40" width="152" height="54" rx="12" />
          <text x="92" y="63">Plate I</text>
          <text x="92" y="80" className="mech-sub">as listed</text>
        </g>
        <g className="mech-node">
          <rect x="16" y="112" width="152" height="54" rx="12" />
          <text x="92" y="135">Plate II</text>
          <text x="92" y="152" className="mech-sub">on arrival</text>
        </g>
        <g className="mech-node">
          <rect x="16" y="184" width="152" height="54" rx="12" />
          <text x="92" y="207">The claim</text>
          <text x="92" y="224" className="mech-sub">seller's own words</text>
        </g>

        <path d="M168 67 H228 V125" className="mech-wire" markerEnd="url(#mArrow)" />
        <path d="M168 139 H228" className="mech-wire" markerEnd="url(#mArrow)" />
        <path d="M168 211 H228 V153" className="mech-wire" markerEnd="url(#mArrow)" />

        {/* the model */}
        <g className="mech-node accent">
          <rect x="236" y="96" width="176" height="86" rx="14" />
          <text x="324" y="126">Vision model</text>
          <text x="324" y="145" className="mech-sub">answers a fixed</text>
          <text x="324" y="160" className="mech-sub">observation rubric</text>
        </g>

        <path d="M412 139 H492" className="mech-wire" markerEnd="url(#mArrow)" />
        <text x="452" y="128" className="mech-wire-label" textAnchor="middle">
          12 fields
        </text>

        {/* scoring */}
        <g className="mech-node">
          <rect x="548" y="60" width="180" height="72" rx="12" />
          <text x="638" y="88">Deterministic</text>
          <text x="638" y="106">scoring</text>
          <text x="638" y="122" className="mech-sub">pure Python, no model</text>
        </g>

        <g className="mech-node">
          <rect x="548" y="152" width="180" height="72" rx="12" />
          <text x="638" y="180">Validators</text>
          <text x="638" y="198" className="mech-sub">re-run the same sum</text>
          <text x="638" y="214" className="mech-sub">over the same numbers</text>
        </g>

        <path d="M638 132 V152" className="mech-wire" markerEnd="url(#mArrow)" />
        <path d="M728 96 H790 V138" className="mech-wire" markerEnd="url(#mArrow)" />
        <path d="M728 188 H790 V158" className="mech-wire" markerEnd="url(#mArrow)" />

        {/* payout */}
        <g className="mech-node leaf">
          <rect x="800" y="112" width="164" height="86" rx="14" />
          <text x="882" y="142">Payout tier</text>
          <text x="882" y="161" className="mech-sub">0 / 25 / 50</text>
          <text x="882" y="176" className="mech-sub">75 / 100 %</text>
        </g>

        <text x="324" y="212" className="mech-caption" textAnchor="middle">
          subjective, non-reproducible
        </text>
        <text x="756" y="256" className="mech-caption" textAnchor="middle">
          reproducible by anyone, forever
        </text>
      </svg>

      <div className="mech-notes">
        <Note
          k="Why buckets, not percentages"
          v="Two validators asked for an exact number will answer 38 and 44 and consensus dies. Asked for a band (none, low, mid, high), they agree. Every field in the rubric is an enum, a boolean or a small integer for exactly that reason."
        />
        <Note
          k="What a validator can check without a model"
          v="That leaves did not grow inside a shipping box. That rot was not reported alongside 'no damage'. That a plant said to be the wrong cultivar was not also said to match the claim. Contradictory reports are rejected before they reach the payout."
        />
        <Note
          k="Where this is still soft"
          v="Studio runs a mixed validator set and not every model can see. Vision-capable validators re-read the plates and must land within one tier of the leader; the rest verify the arithmetic only. GenLayer's appeal path is the backstop, and it is the honest answer to 'what if the leader lied'."
        />
      </div>
    </section>
  );
}

function Note({ k, v }: { k: string; v: string }) {
  return (
    <div className="mech-note">
      <span className="label">{k}</span>
      <p>{v}</p>
    </div>
  );
}
