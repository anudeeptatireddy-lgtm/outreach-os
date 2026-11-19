import { cn } from "../lib/cn";

/**
 * Score as a range against the rubric thresholds: the min..max interval as a bar, the expected
 * score as a tick, reject_max and qualify_min as marks on a 0-100 track.
 */
export function ScoreBar({
  min,
  max,
  expected,
  qualifyMin = 60,
  rejectMax = 45,
  size = "sm",
  className,
  showLabels = false,
  muted = false,
}: {
  min: number;
  max: number;
  expected?: number | null;
  qualifyMin?: number;
  rejectMax?: number;
  size?: "sm" | "lg";
  className?: string;
  showLabels?: boolean;
  muted?: boolean;
}) {
  const tone = muted ? "bg-faint/60" : min >= qualifyMin ? "bg-positive" : max < rejectMax ? "bg-faint" : "bg-warning";
  const h = size === "lg" ? "h-2.5" : "h-1.5";
  const label = `Score ${min} to ${max}${expected != null ? `, expected ${expected}` : ""}; qualify at ${qualifyMin}, reject below ${rejectMax}`;
  return (
    <div className={cn("w-full", className)} role="img" aria-label={label} title={label}>
      <div className={cn("relative w-full rounded-full bg-active", h)}>
        <div className="absolute inset-y-0 rounded-full bg-warning-bg" style={{ left: `${rejectMax}%`, width: `${qualifyMin - rejectMax}%` }} />
        <div className={cn("absolute inset-y-0 rounded-full", tone)} style={{ left: `${min}%`, width: `${Math.max(1.5, max - min)}%`, opacity: min === max ? 1 : 0.85 }} />
        {expected != null && min !== max && <div className={cn("absolute w-0.5 -translate-x-1/2 rounded bg-ink", size === "lg" ? "-inset-y-1" : "-inset-y-0.5")} style={{ left: `${expected}%` }} />}
        <div className={cn("absolute w-px bg-ink/50", size === "lg" ? "-inset-y-1.5" : "-inset-y-1")} style={{ left: `${qualifyMin}%` }} />
        <div className={cn("absolute w-px bg-faint/60", size === "lg" ? "-inset-y-1.5" : "-inset-y-1")} style={{ left: `${rejectMax}%` }} />
      </div>
      {showLabels && (
        <div className="relative mt-2 h-4 text-2xs text-faint">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${rejectMax}%` }}>reject &lt; {rejectMax}</span>
          <span className="absolute -translate-x-1/2 text-muted" style={{ left: `${qualifyMin}%` }}>qualify ≥ {qualifyMin}</span>
          <span className="absolute right-0">100</span>
        </div>
      )}
    </div>
  );
}

export function ScoreText({ min, max, expected }: { min: number; max: number; expected?: number | null }) {
  return (
    <span className="num whitespace-nowrap text-sm">
      {min === max ? min : `${min}–${max}`}
      {expected != null && min !== max && <span className="text-faint"> · ~{Math.round(expected)}</span>}
    </span>
  );
}
