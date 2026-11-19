import type { MessageStatus, ProspectStatus, Stage } from "../api/types";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 min ago", "in 3 hours", "yesterday" */
export function relTime(isoStr: string | null | undefined, now = Date.now()): string {
  if (!isoStr) return "—";
  const diff = new Date(isoStr).getTime() - now;
  const abs = Math.abs(diff);
  const m = 60_000;
  if (abs < 45_000) return diff < 0 ? "just now" : "in a moment";
  if (abs < 45 * m) return rtf.format(Math.round(diff / m), "minute");
  if (abs < 22 * 60 * m) return rtf.format(Math.round(diff / (60 * m)), "hour");
  if (abs < 6.5 * 24 * 60 * m) return rtf.format(Math.round(diff / (24 * 60 * m)), "day");
  return shortDate(isoStr);
}

export function shortDate(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function timeOnly(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}

export const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  queued: "Queued",
  researching: "Researching",
  disqualified: "Disqualified",
  insufficient_data: "Insufficient data",
  no_contact: "No contact",
  rejected_draft: "Draft rejected",
  needs_review: "Needs review",
  approved: "Approved",
  sent: "Sent",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  completed: "Completed",
  failed: "Failed",
};

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  needs_review: "Needs review",
  approved: "Approved",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  rejected: "Rejected",
  failed: "Failed",
  bounced: "Bounced",
  cancelled: "Cancelled",
};

export const STAGE_LABEL: Record<Stage, string> = {
  scrape: "Reading website",
  extract: "Extracting facts",
  qualify: "Scoring against ICP",
  poc: "Finding the right person",
  pain_points: "Picking pain points",
  draft: "Drafting email",
  send: "Sending",
};

export const STAGES: Stage[] = ["scrape", "extract", "qualify", "poc", "pain_points", "draft"];

/** "physical_address" -> "Physical address" for keys we don't know. */
export function humanize(key: string): string {
  if (/\s/.test(key)) return key; // already a sentence from the server
  const s = key.replace(/[_.-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const LIVE_MISSING_LABEL: Record<string, string> = {
  provider: "Choose a sending provider (Gmail or Resend)",
  gmail_credentials: "Connect Gmail with an app password",
  resend_credentials: "Add a Resend API key",
  from_email: "Set the From address",
  physical_address: "Add a physical mailing address (required by CAN-SPAM)",
  owner_email: "Set the owner email",
  demo_mode_off: "Turn off demo mode",
};

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
