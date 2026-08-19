import { useCallback, useRef, useState } from "react";
import "./beforeafter.css";

/** Drag the seam to wipe between the listing plate and the arrival plate. */
export function BeforeAfter({ before, after }: { before: string | null; after: string | null }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }, []);

  if (!before || !after) return null;

  return (
    <div
      className="ba"
      ref={ref}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <img className="ba-img" src={after} alt="on arrival" draggable={false} />
      <div className="ba-clip" style={{ width: `${pos}%` }}>
        <img className="ba-img" src={before} alt="as listed" draggable={false} />
      </div>

      <span className="ba-tag left">as listed</span>
      <span className="ba-tag right">on arrival</span>

      <div className="ba-seam" style={{ left: `${pos}%` }}>
        <span className="ba-handle">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
            <path d="M9 6 4 12l5 6M15 6l5 6-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
