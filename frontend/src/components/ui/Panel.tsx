import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Panel({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={cn("rounded-card border border-line bg-surface", className)}>{children}</As>;
}

export function PanelHeader({ title, meta, actions, className, id }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5", className)}>
      <h2 id={id} className="text-[15px] font-medium">{title}</h2>
      {meta && <div className="text-sm text-muted">{meta}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The page title row: serif h1, optional grey line, actions on the right. */
export function PageHeader({ title, subtitle, actions, back, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 flex-1">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="font-display text-[34px] leading-[38px] tracking-[-0.015em]">{title}</h1>
        {subtitle && <div className="mt-1.5 text-[14px] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, sub, className, big }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; big?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn("num mt-1 font-display leading-none", big ? "text-[44px]" : "text-[32px]")}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
