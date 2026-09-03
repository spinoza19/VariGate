import { useRef, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { listSpecimen } from "../lib/contract";
import { prepareFromUrl, prepareImage, type PreparedImage } from "../lib/image";
import { toWei } from "../lib/format";
import { listingToken } from "../lib/tokens";
import "./listing.css";

const PRESETS = [
  {
    key: "albo",
    species: "Monstera deliciosa 'Albo Variegata'",
    claim:
      "Four-leaf cutting, roughly 40% white sectorial variegation across the blades, no rot, " +
      "rooted in sphagnum. Ships bare-root with a heat pack.",
    price: "2",
    photo: "/specimens/albo-before.jpg",
  },
  {
    key: "thai",
    species: "Philodendron 'Thai Sunrise'",
    claim:
      "Five leaves, heavy variegation on every blade, over 55% cream tissue, immaculate " +
      "condition. Established root system, no damage anywhere.",
    price: "3.5",
    photo: "/specimens/thai-before.jpg",
  },
  {
    key: "spiritus",
    species: "Philodendron spiritus-sancti",
    claim:
      "Three healthy leaves, deep green, clean stem with no soft tissue. Grown on for two years, " +
      "ships in perfect health.",
    price: "5",
    photo: "/specimens/spiritus-before.jpg",
  },
];

export function ListingForm({ onListed }: { onListed: () => Promise<void> | void }) {
  const { client, address } = useWallet();
  const [species, setSpecies] = useState("");
  const [claim, setClaim] = useState("");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = species.trim().length > 2 && claim.trim().length >= 20 && !!photo && !!price;

  // The contract derives this from exactly these fields, so it can be shown
  // while the photograph is still being composed rather than after the fact.
  let token = "";
  try {
    if (address && species.trim() && claim.trim() && price) {
      token = listingToken(address, species.trim(), claim.trim(), toWei(price));
    }
  } catch {
    /* an unparseable price simply means no token to show yet */
  }

  const usePreset = async (p: (typeof PRESETS)[number]) => {
    setError(null);
    setSpecies(p.species);
    setClaim(p.claim);
    setPrice(p.price);
    try {
      setPhoto(await prepareFromUrl(p.photo));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async () => {
    if (!client || !photo) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await listSpecimen(client, species.trim(), claim.trim(), toWei(price), photo.bytes, (s) =>
        setStage(s),
      );
      setDone(true);
      setSpecies("");
      setClaim("");
      setPrice("");
      setPhoto(null);
      await onListed();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0].slice(0, 260) : String(e));
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <div className="listing">
      <div className="listing-form card pad">
        <span className="label">Determination label</span>
        <h2 className="display listing-title">Mount a specimen.</h2>
        <p className="listing-lede">
          Whatever you write in the claim becomes the contract term. Be precise: the model is asked
          whether the arrival photograph supports these exact words.
        </p>

        <div className="listing-presets">
          <span className="label">Or start from a demo sheet</span>
          <div className="row wrap" style={{ gap: 7, marginTop: 6 }}>
            {PRESETS.map((p) => (
              <button key={p.key} className="btn ghost sm" onClick={() => void usePreset(p)}>
                {p.species.split("'")[1] ?? p.species.split(" ")[1]}
              </button>
            ))}
          </div>
        </div>

        <hr className="rule" style={{ margin: "20px 0" }} />

        <label className="field">
          <span className="label">Species / cultivar</span>
          <input
            className="input"
            placeholder="Monstera deliciosa 'Albo Variegata'"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="label">Written claim</span>
          <textarea
            className="textarea"
            placeholder="Four leaves, roughly 40% white sectorial variegation, no rot, rooted in sphagnum…"
            value={claim}
            maxLength={700}
            onChange={(e) => setClaim(e.target.value)}
          />
          <span className="hint">
            {claim.length}/700 · at least 20 characters · this is what gets adjudicated
          </span>
        </label>

        <label className="field">
          <span className="label">Asking price</span>
          <div className="row">
            <input
              className="input"
              inputMode="decimal"
              placeholder="2.5"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="chip neutral">GEN</span>
          </div>
        </label>

        {error ? <div className="err">{error}</div> : null}
        {done ? <div className="listing-done">Mounted. It is in the archive.</div> : null}

        <button
          className="btn leaf block"
          style={{ marginTop: 6 }}
          disabled={!valid || busy || !address}
          onClick={() => void submit()}
        >
          {busy ? <span className="spin" /> : null}
          {busy ? (stage === "submitted" ? "Confirming on studionet…" : "Signing…") : "Mount the specimen"}
        </button>
        {!address ? <p className="hint">Connect an account first.</p> : null}
      </div>

      <div className="listing-plate">
        <span className="label">Plate I, as listed</span>
        <div className="listing-drop" onClick={() => fileRef.current?.click()}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setPhoto(await prepareImage(f));
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
          {photo ? (
            <img src={photo.previewUrl} alt="specimen" />
          ) : (
            <span className="listing-drop-empty">
              Choose the listing photograph
              <em>downscaled and stored on chain, under 240 KB</em>
            </span>
          )}
        </div>
        {photo ? (
          <div className="listing-plate-meta">
            <span className="meta">
              {photo.width}×{photo.height}
            </span>
            <span className="meta">{Math.round(photo.bytes.length / 1024)} KB on chain</span>
            {photo.originalBytes > photo.bytes.length * 1.15 ? (
              <span className="meta">from {Math.round(photo.originalBytes / 1024)} KB</span>
            ) : null}
          </div>
        ) : null}

        <div className="listing-token">
          <span className="label">Write this on a card and put it in the shot</span>
          {token ? (
            <code className="listing-token-value">{token}</code>
          ) : (
            <p className="hint" style={{ marginTop: 6 }}>
              Fill in the species, claim and price, and the token for this listing appears here.
            </p>
          )}
          <p>
            The contract reads the token off the photograph and refuses any plate that does not
            carry it. That is what stops a stock image, or a shot borrowed from another listing,
            from standing in as evidence.
          </p>
        </div>

        <div className="listing-note">
          <span className="label">One photograph, not a gallery</span>
          <p>
            GenVM accepts at most two images per prompt, and the adjudication needs one slot for
            the arrival plate. So the listing gets exactly one. Make it the honest one, showing
            every leaf.
          </p>
        </div>
      </div>
    </div>
  );
}
