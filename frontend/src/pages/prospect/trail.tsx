// Shared pieces of the decision trail: quotes with their source, evidence ids, and the email
// body with hook-map highlights (hover or focus a claim to see the quote it rests on).
import { useId, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { HookLink } from "../../api/types";
import { cn } from "../../lib/cn";
import { hostOf, pathOf } from "../../lib/format";

export function SourceLink({ url, className, full }: { url: string; className?: string; full?: boolean }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn("inline-flex min-w-0 items-center gap-1 text-xs text-accent hover:underline", className)}
      title={url}
    >
      <span className="truncate">{full ? hostOf(url) : pathOf(url)}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A quote from the company's own page, with the page it came from. */
export function QuoteBlock({ quote, url, className }: { quote: string; url?: string; className?: string }) {
  return (
    <figure className={cn("border-l-2 border-accent/40 pl-3", className)}>
      <blockquote className="text-[14px] leading-6 text-ink text-pretty">“{quote}”</blockquote>
      {url && (
        <figcaption className="mt-0.5">
          <SourceLink url={url} />
        </figcaption>
      )}
    </figure>
  );
}

export function EvidenceChip({ id, className }: { id: string; className?: string }) {
  const product = id.startsWith("S");
  return (
    <span
      className={cn(
        "inline-flex h-5 flex-none items-center rounded px-1.5 font-mono text-[11px] font-medium",
        product ? "bg-active text-muted" : "bg-accent-soft text-accent-ink",
        className,
      )}
      title={product ? `Playbook value claim ${id}` : `Evidence ${id} from the company's pages`}
    >
      {id}
    </span>
  );
}

export function SectionHeading({ n, title, aside, id }: { n: number; title: string; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-display text-[22px] leading-none text-faint" aria-hidden>
        {n}.
      </span>
      <h2 id={id} className="font-display text-[28px] leading-8 tracking-[-0.01em]">
        {title}
      </h2>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}

export function NotReached({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-dashed border-line px-4 py-3 text-sm text-muted">{children}</p>;
}

// ---------------------------------------------------------------------------------------------

type Seg = { text: string; hook?: HookLink };

function segments(body: string, hooks: HookLink[]): Seg[] {
  const lower = body.toLowerCase();
  const ranges: { start: number; end: number; hook: HookLink }[] = [];
  for (const h of hooks) {
    if (!h.claim) continue;
    const start = lower.indexOf(h.claim.toLowerCase());
    if (start < 0) continue;
    const end = start + h.claim.length;
    if (ranges.some((r) => start < r.end && end > r.start)) continue;
    ranges.push({ start, end, hook: h });
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: Seg[] = [];
  let i = 0;
  for (const r of ranges) {
    if (r.start > i) out.push({ text: body.slice(i, r.start) });
    out.push({ text: body.slice(r.start, r.end), hook: r.hook });
    i = r.end;
  }
  if (i < body.length) out.push({ text: body.slice(i) });
  return out;
}

function Hook({ text, hook }: { text: string; hook: HookLink }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const product = hook.evidence_id.startsWith("S");
  return (
    <span className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <mark
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          "cursor-help rounded-[3px] px-0.5 text-ink underline underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          product ? "bg-transparent decoration-faint decoration-dashed" : "bg-accent-soft/80 decoration-accent/60",
        )}
      >
        {text}
      </mark>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute left-0 top-full z-30 mt-1.5 block w-[min(320px,calc(100vw-48px))] animate-pop-in whitespace-normal rounded-card border border-line bg-surface p-3 text-left text-[13px] leading-5 shadow-float"
        >
          <span className="mb-1.5 flex items-center gap-2">
            <EvidenceChip id={hook.evidence_id} />
            <span className="text-xs text-muted">{product ? `Playbook value claim ${hook.evidence_id}` : "Quoted from their site"}</span>
          </span>
          {hook.quote && <span className="block text-ink">{product ? hook.quote : `“${hook.quote}”`}</span>}
          {!product && hook.source_url && (
            <span className="mt-1 block">
              <SourceLink url={hook.source_url} full />
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** Email body with every claim that rests on evidence highlighted. */
export function HookedText({ body, hooks, className }: { body: string; hooks: HookLink[]; className?: string }) {
  return (
    <div className={cn("whitespace-pre-wrap text-[15px] leading-7", className)}>
      {segments(body, hooks).map((s, i) => (s.hook ? <Hook key={i} text={s.text} hook={s.hook} /> : <span key={i}>{s.text}</span>))}
    </div>
  );
}

export function HookLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-[3px] bg-accent-soft" aria-hidden /> Fact from their site
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0 w-5 border-b border-dashed border-faint" aria-hidden /> Playbook value claim
      </span>
      <span>Hover or focus a highlight to see its source.</span>
    </div>
  );
}
