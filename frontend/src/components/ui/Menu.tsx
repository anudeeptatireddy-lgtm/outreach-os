import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type MenuItem = { label: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean } | "separator";

/** A small dropdown menu with keyboard support. */
export function Menu({ trigger, items, align = "end", label }: { trigger: (p: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div role="menu" aria-label={label} className={cn("absolute z-40 mt-1 min-w-[200px] animate-pop-in rounded-card border border-line bg-surface p-1 shadow-float", align === "end" ? "right-0" : "left-0")}>
          {items.map((it, i) =>
            it === "separator" ? (
              <div key={i} className="my-1 h-px bg-rule" />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left text-[14px] hover:bg-active focus:bg-active focus:outline-none disabled:opacity-50",
                  it.danger ? "text-negative" : "text-ink",
                )}
              >
                {it.icon && <span className="text-faint">{it.icon}</span>}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
