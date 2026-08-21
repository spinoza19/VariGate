import { useEffect, useMemo, useState } from "react";
import { WalletPill, ConnectGate } from "./components/Wallet";
import { Hero } from "./components/Hero";
import { Mechanism } from "./components/Mechanism";
import { SpecimenCard } from "./components/SpecimenCard";
import { SpecimenDetail } from "./components/SpecimenDetail";
import { ListingForm } from "./components/ListingForm";
import { useEscrows } from "./lib/useEscrows";
import { useWallet } from "./wallet/WalletContext";
import { fromWei, sameAddress } from "./lib/format";
import { CONTRACT_ADDRESS, RPC_URL } from "./lib/genlayer";
import { EXPLORER_URL } from "./wallet/connectors";
import { STATUS } from "./lib/types";
import "./app.css";

type Tab = "archive" | "mount" | "mine";

export default function App() {
  const { escrows, config, validators, loading, error, refresh } = useEscrows();
  const { address } = useWallet();
  const [tab, setTab] = useState<Tab>("archive");
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "judged">("all");

  const open = openId != null ? escrows.find((e) => e.id === openId) ?? null : null;

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => void (document.body.style.overflow = "");
  }, [open]);

  const stats = useMemo(() => {
    const locked = escrows
      .filter((e) => e.status === STATUS.FUNDED || e.status === STATUS.SHIPPED || e.status === STATUS.JUDGED)
      .reduce((a, e) => a + BigInt(e.amount), 0n);
    return {
      locked: fromWei(locked, 2),
      settled: escrows.filter((e) => e.status === STATUS.SETTLED).length,
    };
  }, [escrows]);

  const mine = useMemo(
    () => escrows.filter((e) => sameAddress(e.seller, address) || sameAddress(e.buyer, address)),
    [escrows, address],
  );

  const shown = useMemo(() => {
    const base = tab === "mine" ? mine : escrows;
    const f =
      filter === "open"
        ? base.filter((e) => e.status < STATUS.JUDGED)
        : filter === "judged"
          ? base.filter((e) => e.status === STATUS.JUDGED || e.status === STATUS.SETTLED)
          : base;
    return [...f].reverse();
  }, [tab, mine, escrows, filter]);

  return (
    <>
      <nav className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#top">
            <span className="brand-mark">
              Vari<em>Gate</em>
            </span>
            <span className="label" style={{ display: "none" }}>
              escrow
            </span>
          </a>
          <span className="chip green topbar-net">
            <span className="dot pulse" />
            studionet
          </span>
          <span className="grow" />
          <button className="navlink" data-on={tab === "archive"} onClick={() => setTab("archive")}>
            Archive
          </button>
          <button className="navlink" data-on={tab === "mount"} onClick={() => setTab("mount")}>
            Mount
          </button>
          <button className="navlink" data-on={tab === "mine"} onClick={() => setTab("mine")}>
            Mine{mine.length ? ` (${mine.length})` : ""}
          </button>
          <WalletPill />
        </div>
      </nav>

      <main className="shell" id="top">
        {tab === "archive" ? (
          <>
            <Hero
              validators={validators}
              settled={stats.settled}
              locked={stats.locked}
              onStart={() => setTab("mount")}
              onBrowse={() => document.getElementById("archive")?.scrollIntoView({ behavior: "smooth" })}
            />

            <div className="mech-scroll">
              <Mechanism />
            </div>

            <section id="archive" className="section">
              <div className="section-head">
                <div>
                  <span className="label">The collection</span>
                  <h2 className="display section-title">Specimens on deposit.</h2>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {(["all", "open", "judged"] as const).map((f) => (
                    <button
                      key={f}
                      className={`btn sm ${filter === f ? "" : "ghost"}`}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {!address ? (
                <div style={{ marginBottom: 22 }}>
                  <ConnectGate />
                </div>
              ) : null}

              {error ? <div className="err" style={{ marginBottom: 18 }}>{error}</div> : null}

              {loading ? (
                <div className="archive-grid">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="sheet">
                      <div className="sheet-plate">
                        <div className="photo-skeleton" />
                      </div>
                      <div className="sheet-label" style={{ minHeight: 150 }} />
                    </div>
                  ))}
                </div>
              ) : shown.length ? (
                <div className="archive-grid">
                  {shown.map((e, i) => (
                    <SpecimenCard key={e.id} escrow={e} index={i} onOpen={() => setOpenId(e.id)} />
                  ))}
                </div>
              ) : (
                <Empty onMount={() => setTab("mount")} />
              )}
            </section>
          </>
        ) : null}

        {tab === "mount" ? (
          <section className="section" style={{ paddingTop: 40 }}>
            {!address ? (
              <div style={{ marginBottom: 22 }}>
                <ConnectGate />
              </div>
            ) : null}
            <ListingForm
              onListed={async () => {
                await refresh();
                setTab("archive");
              }}
            />
          </section>
        ) : null}

        {tab === "mine" ? (
          <section className="section" style={{ paddingTop: 40 }}>
            <div className="section-head">
              <div>
                <span className="label">Your accessions</span>
                <h2 className="display section-title">Bought and sold.</h2>
              </div>
            </div>
            {!address ? (
              <ConnectGate />
            ) : shown.length ? (
              <div className="archive-grid">
                {shown.map((e, i) => (
                  <SpecimenCard key={e.id} escrow={e} index={i} onOpen={() => setOpenId(e.id)} />
                ))}
              </div>
            ) : (
              <Empty onMount={() => setTab("mount")} />
            )}
          </section>
        ) : null}
      </main>

      <footer className="footer">
        <div className="shell footer-inner">
          <div>
            <span className="brand-mark">
              Vari<em>Gate</em>
            </span>
            <p className="footer-lede">
              Trustless condition escrow. Built on GenLayer Intelligent Contracts, where a
              blockchain can be asked a question that has no formula.
            </p>
          </div>
          <dl className="footer-facts">
            <FooterFact
              k="Contract"
              v={CONTRACT_ADDRESS}
              href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`}
            />
            <FooterFact k="RPC" v={RPC_URL} />
            <FooterFact k="Explorer" v="explorer-studio.genlayer.com" href={EXPLORER_URL} />
            <FooterFact k="Fee" v={`${(config?.fee_bps ?? 200) / 100}%`} />
            <FooterFact k="Unboxing window" v="48h" />
            <FooterFact k="Shipping window" v="14d" />
          </dl>
        </div>
      </footer>

      {open ? (
        <SpecimenDetail
          escrow={open}
          config={config}
          validators={validators}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      ) : null}
    </>
  );
}

function Empty({ onMount }: { onMount: () => void }) {
  return (
    <div className="archive-empty">
      <p style={{ maxWidth: 44 + "ch", margin: "0 auto 16px" }}>
        Nothing on deposit yet. Mount a specimen and the archive fills up. The demo sheets in
        the mount form take about a minute each to move through the full cycle.
      </p>
      <button className="btn leaf" onClick={onMount}>
        Mount a specimen
      </button>
    </div>
  );
}

function FooterFact({ k, v, href }: { k: string; v: string; href?: string }) {
  return (
    <div className="footer-fact">
      <dt className="label">{k}</dt>
      <dd className="meta">
        {href ? (
          <a className="footer-link" href={href} target="_blank" rel="noreferrer">
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}
