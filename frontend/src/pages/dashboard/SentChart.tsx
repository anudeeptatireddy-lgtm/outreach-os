import { useEffect, useRef, useState } from "react";
import type { AnalyticsOverview } from "../../api/types";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceStep(raw: number) {
  if (raw <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** 14 days of sent (accent) and replied (muted) as paired square columns. */
export function SentChart({ data }: { data: AnalyticsOverview["sent_by_day"] }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const pad = { l: 28, r: 8, t: 10, b: 24 };
  const plotW = w - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const peak = Math.max(0, ...data.map((d) => Math.max(d.sent, d.replied)));
  const step = niceStep(Math.ceil((peak + 1) / 4));
  const top = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const n = data.length || 1;
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(14, slot * 0.3));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const labelEvery = w < 480 ? 4 : 2;
  const hd = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full">
      <svg width={w} height={H} role="img" aria-label={`Emails sent and replies per day over the last ${data.length} days`} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--grid))" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="num fill-faint text-[11px]">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const active = hover === i;
          return (
            <g
              key={d.date}
              tabIndex={0}
              role="img"
              aria-label={`${dayLabel(d.date)}: ${d.sent} sent, ${d.replied} replied`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none"
            >
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill={active ? "rgb(var(--active))" : "transparent"} />
              {d.sent > 0 && <rect x={cx - barW - 1} y={y(d.sent)} width={barW} height={y(0) - y(d.sent)} fill="rgb(var(--accent))" />}
              {d.replied > 0 && <rect x={cx + 1} y={y(d.replied)} width={barW} height={y(0) - y(d.replied)} fill="rgb(var(--muted) / 0.45)" />}
              {(i % labelEvery === (n - 1) % labelEvery) && (
                <text x={cx} y={H - 6} textAnchor="middle" className="num fill-faint text-[11px]">
                  {dayLabel(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hd && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs shadow-float"
          style={{ left: Math.min(Math.max(0, pad.l + slot * hover + slot / 2 - 60), w - 130) }}
        >
          <div className="font-medium">{dayLabel(hd.date)}</div>
          <div className="num text-muted">
            {hd.sent} sent · {hd.replied} replied
          </div>
        </div>
      )}
    </div>
  );
}

export function SentChartLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 bg-accent" aria-hidden /> Sent
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 bg-muted/45" aria-hidden /> Replied
      </span>
    </div>
  );
}
