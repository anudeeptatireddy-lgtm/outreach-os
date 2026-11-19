import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Soren-style section label: a small square, mono uppercase text and a bracketed index. */
export function Label({ children, n, className, light }: { children: ReactNode; n?: string; className?: string; light?: boolean }) {
  return (
    <p className={cn("flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em]", light ? "text-white/70" : "text-muted", className)}>
      <span className={cn("h-1.5 w-1.5", light ? "bg-[#4fd6ec]" : "bg-accent")} aria-hidden />
      {children}
      {n && <span className={light ? "text-white/45" : "text-faint"}>[{n}]</span>}
    </p>
  );
}
