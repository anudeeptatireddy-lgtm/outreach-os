import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

/** Tags typed into a field: Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
  label,
  id,
  describedBy,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label: string;
  id?: string;
  describedBy?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-control border border-control bg-surface px-1.5 py-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
        className,
      )}
    >
      {value.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex h-6 items-center gap-1 rounded bg-active pl-2 pr-1 text-[13px] text-ink">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-0.5 text-faint hover:bg-control/50 hover:text-ink">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-[8ch] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-faint"
      />
    </div>
  );
}
