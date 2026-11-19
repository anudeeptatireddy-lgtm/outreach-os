import type { ReactNode } from "react";
import { AlertTriangle, Info, Loader2, RotateCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { errorMessage } from "../../api/client";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-faint", className)} aria-hidden />;
}

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="grid min-h-full place-items-center" role="status" aria-label={label}>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> {label}
      </div>
    </div>
  );
}

/** A flat grey bar at the size of the value it stands in for. No shimmer. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block rounded bg-active align-middle", className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-rule", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 px-4">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="ml-auto h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted text-pretty">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, what = "this", className }: { error: unknown; onRetry?: () => void; what?: string; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-negative" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Couldn't load {what}.</p>
        <p className="text-muted">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

type NoticeTone = "info" | "warning" | "negative" | "positive";
export function Notice({ tone = "info", title, children, action, className, icon }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  const tones: Record<NoticeTone, string> = {
    info: "border-accent/25 bg-info-bg text-info-ink",
    warning: "border-warning-line bg-warning-bg text-warning-ink",
    negative: "border-negative/30 bg-negative-bg text-negative-ink",
    positive: "border-positive/30 bg-positive-bg text-positive-ink",
  };
  return (
    <div className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-card border px-3.5 py-2.5 text-sm", tones[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? (tone === "info" ? <Info className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />)}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title ? "mt-0.5" : null, "opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-raised px-1.5 py-px font-sans text-2xs text-muted">{children}</kbd>;
}
