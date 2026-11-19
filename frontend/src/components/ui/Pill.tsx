import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { MessageStatus, ProspectStatus, Stage } from "../../api/types";
import { MESSAGE_STATUS_LABEL, PROSPECT_STATUS_LABEL, STAGE_LABEL } from "../../lib/format";

export type Tone = "neutral" | "accent" | "live" | "positive" | "warning" | "negative" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-active text-muted",
  accent: "bg-accent-soft text-accent-ink",
  live: "bg-live-bg text-live-ink",
  positive: "bg-positive-bg text-positive-ink",
  warning: "bg-warning-bg text-warning-ink",
  negative: "bg-negative-bg text-negative-ink",
  outline: "border border-line text-muted",
};

export function Pill({ tone = "neutral", children, dot, pulse, className, title }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium", tones[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full bg-current", pulse && "animate-pulse-dot")} aria-hidden />}
      {children}
    </span>
  );
}

export const PROSPECT_TONE: Record<ProspectStatus, Tone> = {
  queued: "neutral",
  researching: "live",
  disqualified: "neutral",
  insufficient_data: "warning",
  no_contact: "warning",
  rejected_draft: "warning",
  needs_review: "accent",
  approved: "accent",
  sent: "positive",
  replied: "positive",
  bounced: "negative",
  unsubscribed: "neutral",
  completed: "neutral",
  failed: "negative",
};

export function StatusPill({ status, stage }: { status: ProspectStatus; stage?: Stage | null }) {
  const live = status === "researching";
  return (
    <Pill tone={PROSPECT_TONE[status]} dot pulse={live} title={live && stage ? STAGE_LABEL[stage] : undefined}>
      {PROSPECT_STATUS_LABEL[status]}
    </Pill>
  );
}

export const MESSAGE_TONE: Record<MessageStatus, Tone> = {
  needs_review: "accent",
  approved: "accent",
  scheduled: "accent",
  sending: "live",
  sent: "positive",
  rejected: "neutral",
  failed: "negative",
  bounced: "negative",
  cancelled: "neutral",
};

export function MessagePill({ status }: { status: MessageStatus }) {
  return (
    <Pill tone={MESSAGE_TONE[status]} dot pulse={status === "sending"}>
      {MESSAGE_STATUS_LABEL[status]}
    </Pill>
  );
}

/** The cyan "live" indicator: a pulsing dot with a label. */
export function LiveDot({ label, className }: { label?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-live-ink", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-50 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
      </span>
      {label}
    </span>
  );
}
