import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  label,
}: {
  tabs: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("-mb-px flex gap-5 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.value === value);
              if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length]!.value);
              if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.value);
            }}
            tabIndex={on ? 0 : -1}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap text-[14px] transition-colors",
              on ? "font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="num text-xs text-faint">{t.count}</span>}
            {on && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-control bg-active p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-sm transition-colors",
            o.value === value ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Filter chips with counts; one selected. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5 overflow-x-auto pb-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
              on ? "border-ink bg-ink text-ground" : "border-line bg-surface text-muted hover:border-control hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("num text-xs", on ? "opacity-70" : "text-faint")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
