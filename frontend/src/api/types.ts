// Wire types for the outreach-os HTTP API (v1 contract). Source of truth: docs/API.md.
// Times are ISO-8601 UTC strings. IDs are integers.

// ---------- Enums ----------

export type ProspectStatus =
  | "queued" // waiting for the worker
  | "researching" // scrape/extract/qualify/poc/draft running; see `stage`
  | "disqualified" // failed a gate or scored below reject_max
  | "insufficient_data" // gray band after research; can be overridden
  | "no_contact" // qualified, but no suitable person found; can set one manually
  | "rejected_draft" // the validator refused both drafts; can regenerate or edit
  | "needs_review" // a draft is waiting in the review queue
  | "approved" // approved, waiting for its send time
  | "sent" // first email sent (follow-ups may be pending)
  | "replied"
  | "bounced"
  | "unsubscribed"
  | "completed" // sequence finished with no reply
  | "failed"; // an error; `error` says why; can rerun

export type Stage = "scrape" | "extract" | "qualify" | "poc" | "pain_points" | "draft" | "send";

export type MessageStatus =
  | "needs_review"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "rejected"
  | "failed"
  | "bounced"
  | "cancelled";

// test: every email goes to the workspace owner_email, subject prefixed "[TEST -> Name <email>]".
// live: emails go to the real contact. Requires provider configured, from_email, physical_address.
export type SendingMode = "test" | "live";
export type Provider = "gmail" | "resend";

// ---------- Errors ----------

export type ApiErrorBody = { detail: string; errors?: string[] };

// ---------- Auth ----------

export type Session = {
  user: { id: number; email: string; name: string };
  workspace: { id: number; name: string; onboarded: boolean; demo_mode: boolean };
};


// ---------- Health ----------

export type Health = { ok: true; version: string; worker: "running" | "stopped" };

// ---------- Settings ----------

export type Integration = {
  configured: boolean;
  source: "workspace" | "env" | null;
  hint: string | null; // e.g. "…a1b2" or the gmail user
};

export type SendWindow = { start_hour: number; end_hour: number; timezone: string; weekdays_only: boolean };

export type SendingSettings = {
  mode: SendingMode;
  provider: Provider | null;
  from_name: string;
  from_email: string; // gmail: the Gmail address; resend: an address on a verified domain
  reply_to: string;
  owner_email: string; // test-mode recipient
  physical_address: string; // required in live mode (CAN-SPAM)
  daily_cap: number; // max emails per day, default 30
  send_window: SendWindow;
};

export type Settings = {
  workspace_name: string;
  demo_mode: boolean; // true: pipeline uses built-in sample data, no keys, no network, nothing sent
  onboarded: boolean;
  sending: SendingSettings;
  models: { smart: string; fast: string };
  integrations: {
    gemini: Integration;
    hunter: Integration;
    resend: Integration;
    gmail: Integration;
  };
  hunter_usage: { monthly_budget: number; used_this_month: number };
  live_ready: { ok: boolean; missing: string[] }; // what blocks live mode
  webhook_url: string; // read-only: paste into Resend > Webhooks
};

export type IntegrationName = keyof Settings["integrations"];

export type SettingsPatch = Partial<{
  workspace_name: string;
  sending: Partial<SendingSettings>;
  models: Partial<Settings["models"]>;
  demo_mode: boolean;
  onboarded: boolean;
}>;

/** Any subset; empty string clears. Secrets are encrypted at rest and never returned. */
export type SecretsBody = Partial<{
  gemini_api_key: string;
  hunter_api_key: string;
  resend_api_key: string;
  gmail_user: string;
  gmail_app_password: string;
  resend_webhook_secret: string;
}>;

export type TestResult = { ok: boolean; detail: string };

// ---------- Playbooks ----------

export type PlaybookSummary = {
  id: number;
  name: string;
  product_name: string;
  template: string | null;
  version: number;
  updated_at: string;
  campaign_count: number;
};

export type PlaybookTemplate = { key: string; name: string; description: string };

export type SignalKind = "map" | "best" | "count" | "keyword" | "year_recency" | "text_keyword";

export type RubricSignal = {
  id: string;
  label: string;
  group: string;
  weight: number;
  kind: SignalKind;
  field: string;
  attribute?: string | null;
  points?: Record<string, number>;
  tiers?: [number, number][];
  keyword_groups?: { points: number; keywords: string[] }[];
  keywords?: string[];
  observed_on?: string[];
  target_kinds?: string[];
};

export type RubricGate = { id: string; label: string; field: string; fail_values: unknown[] };

export type RubricPenalty = { id: string; label: string; points: number; requires: string[]; excludes?: string[] };

export type Rubric = {
  version: string;
  description: string;
  thresholds: {
    qualify_min: number;
    reject_max: number;
    reference_year: number;
    unknown_credit: number;
    qualify_expected: number;
  };
  gates: RubricGate[];
  signals: RubricSignal[];
  penalties: RubricPenalty[];
};

export type Persona = {
  id: string;
  label: string;
  title_patterns: string[];
  pains: [string, string];
  role_link: string;
};

export type SizeBand = "small" | "mid" | "large";

export type Playbook = {
  id: number;
  name: string;
  version: number;
  updated_at: string;
  template: string | null;
  product: {
    name: string; // "Sprinto"
    one_liner: string; // "Compliance automation for SOC 2, ISO 27001 and GDPR"
    website: string;
    problem_space: string; // "compliance" -> drives pain-point prompts
  };
  value_claims: { id: string; text: string }[]; // S1..S5; the ONLY product claims an email may make
  research: {
    focus_label: string; // "Compliance frameworks"
    focus_description: string; // instructions for extraction
  };
  icp: Rubric; // validated server side (weights sum to 100 etc.)
  personas: {
    personas: Persona[];
    band_order: { small: string[]; mid: string[]; large: string[] }; // persona ids, best first
    exclude_title_keywords: string[];
  };
  email: {
    min_words: number;
    max_words: number; // 50..90 for Sprinto
    tone: string; // free text guidance
    extra_banned_phrases: string[];
    sender_name: string;
    sender_title: string;
    followup_angles: string[]; // one per follow-up step
  };
};

/** PUT body: a Playbook without id/version/updated_at. */
export type PlaybookInput = Omit<Playbook, "id" | "version" | "updated_at">;

/** Profile fields a rubric may read. */
export const PROFILE_FIELDS = [
  "is_b2b",
  "stage",
  "headcount",
  "offering",
  "focus_mentions",
  "hiring_signals",
  "enterprise_customers",
] as const;

/** Page kinds the scraper classifies. */
export const PAGE_KINDS = ["home", "about", "careers", "security", "pricing", "customers"] as const;

// ---------- Campaigns ----------

export type FollowupStep = { delay_days: number };

export type NewCampaign = {
  name: string;
  playbook_id: number;
  domains?: string[]; // one per entry, any of "acme.com", "https://www.acme.com/x"
  csv?: string; // header row; columns: domain (required), first_name, last_name, email, title
  auto_approve: boolean; // true: drafts that pass validation skip the review queue
  followups: FollowupStep[]; // 0-3 follow-up steps after the first email
  hunter_live: boolean; // false: no Hunter search; contacts come from the CSV or are added by hand
};

export type CampaignStats = {
  total: number;
  queued: number;
  researching: number;
  qualified: number;
  disqualified: number;
  insufficient_data: number;
  no_contact: number;
  needs_review: number;
  approved: number;
  sent: number;
  replied: number;
  bounced: number;
  failed: number;
};

export type CampaignStatus = "running" | "paused" | "completed";

export type Campaign = {
  id: number;
  name: string;
  status: CampaignStatus;
  playbook: { id: number; name: string };
  auto_approve: boolean;
  hunter_live: boolean;
  followups: FollowupStep[];
  created_at: string;
  stats: CampaignStats;
};

export type CampaignPatch = {
  name?: string;
  status?: "running" | "paused";
  auto_approve?: boolean;
  followups?: FollowupStep[];
};

export type AddProspectsBody = { domains?: string[]; csv?: string };
export type AddProspectsResult = { added: number; rejected: { input: string; reason: string }[] };

// ---------- Prospects ----------

export type ContactSource = "hunter" | "manual" | "sample";

export type ProspectRow = {
  id: number;
  campaign_id: number;
  domain: string;
  company_name: string | null;
  status: ProspectStatus;
  stage: Stage | null;
  score: { min: number; max: number; expected: number | null } | null;
  contact: { name: string; title: string; email: string; source: ContactSource } | null;
  next_step: string | null; // human readable: "Review draft", "Follow-up 1 on Nov 24", ...
  error: string | null;
  updated_at: string;
};

export type Quoted = { quote: string; source_url: string };

export type FocusStatus = "certified" | "in_progress" | "planned" | "mentioned";

export type CompanyProfile = {
  name: { value: string; quote: string; source_url: string } | null;
  offering: { value: string; quote: string; source_url: string } | null;
  is_b2b: { value: boolean; quote: string; source_url: string } | null;
  stage: { value: string; as_of: string | null; quote: string; source_url: string } | null;
  headcount: { value: string; quote: string; source_url: string } | null;
  focus_mentions: { framework: string; status: FocusStatus; as_of: string | null; quote: string; source_url: string }[];
  hiring_signals: { role: string; quote: string; source_url: string }[];
  enterprise_customers: { name: string; quote: string; source_url: string }[];
};

export type SignalScore = {
  id: string;
  label: string;
  group: string;
  weight: number;
  status: "known" | "unknown";
  points_min: number;
  points_max: number;
  basis: string;
  evidence: Quoted[];
};

export type GateResult = { id: string; label: string; status: "pass" | "fail" | "unknown"; basis: string };
export type PenaltyHit = { id: string; label: string; points: number };

export type ResearchStep = {
  iteration: number;
  tool: string;
  url: string | null;
  reason: string | null;
  outcome: string;
  resolved_signals: string[];
  score_min: number;
  score_max: number;
};

export type Verdict = "qualified" | "disqualified" | "insufficient_data";

export type Qualification = {
  verdict: Verdict;
  initial_verdict: "qualified" | "disqualified" | "loop";
  reason: string;
  rubric_version: string;
  thresholds: Record<string, number>;
  score: {
    signals: SignalScore[];
    gates: GateResult[];
    penalties: PenaltyHit[];
    score_min: number;
    score_max: number;
    score_expected: number | null;
    unknown_signals: string[];
  };
  research: {
    stop_reason: string;
    iterations: number;
    fetches: number;
    steps: ResearchStep[];
  } | null;
  manual_override?: string | null;
};

export type ScrapedPage = { url: string; status: string; kind: string | null; chars: number; reason: string | null };

export type PocContact = {
  first_name: string;
  last_name: string | null;
  email: string;
  position: string;
  confidence: number | null;
  source: string;
};

export type PocCandidate = {
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  category: string | null;
  score: number;
  eligible: boolean;
  notes: string[];
};

export type HookLink = { claim: string; evidence_id: string; quote: string; source_url: string };
export type PainPoint = { pain: string; role_link: string; evidence_id: string };
export type EvidenceItem = { id: string; kind: string; fact: string; quote: string; source_url: string };

export type ProspectTrail = {
  scrape: { pages: ScrapedPage[]; usable: number; kinds_found: string[] } | null;
  extract: {
    profile: CompanyProfile;
    evidence_total: number;
    evidence_kept: number;
    evidence_dropped: { field: string; quote: string; source_url: string; reason: string }[];
    injection_suspected_pages: string[];
  } | null;
  qualify: Qualification | null;
  poc: {
    contact: PocContact;
    band: SizeBand;
    band_basis: string;
    reason: string;
    top_candidates: PocCandidate[];
    candidates_seen: number;
    risks: string[];
  } | null;
  draft: {
    pain_points: PainPoint[];
    pain_points_source: string;
    evidence_pack: EvidenceItem[];
    hook_map: HookLink[];
    validation: { ok: boolean; failures: string[]; attempts: number } | null;
  } | null;
};

export type ProspectDetail = ProspectRow & {
  summary: string | null; // one-line plain-English verdict
  trail: ProspectTrail;
  messages: Message[];
  events: Event[];
};

export type ManualContactBody = { first_name: string; last_name?: string; email: string; title: string };

// ---------- Messages ----------

export type Message = {
  id: number;
  prospect_id: number;
  campaign: { id: number; name: string };
  company: { domain: string; name: string | null };
  step: number; // 0 first email, 1.. follow-ups
  to: { name: string; email: string; title: string };
  delivered_to: string | null; // actual recipient (owner_email in test mode)
  subject: string;
  body: string; // the editable body only
  footer: string; // read-only: sender identity, postal address, unsubscribe line
  status: MessageStatus;
  validation: { ok: boolean; failures: string[] };
  hook_map: HookLink[];
  pain_points: PainPoint[];
  scheduled_at: string | null;
  sent_at: string | null;
  provider_id: string | null;
  error: string | null;
  created_at: string;
  mode: SendingMode | "demo" | null;
};

export type MessagePatch = { subject?: string; body?: string };
export type ApproveBody = { send_at?: string | null; force?: boolean };
export type BulkApproveResult = { approved: number; skipped: number };

// ---------- Worker (Vercel: the open dashboard drives processing) ----------

export type WorkerTick = { processed: number; pending: number };

// ---------- Analytics and activity ----------

export type FunnelKey = "added" | "qualified" | "contact_found" | "drafted" | "sent" | "replied";

export type AnalyticsOverview = {
  funnel: { key: string; label: string; count: number }[];
  outcomes: { key: ProspectStatus; count: number }[];
  sent_by_day: { date: string; sent: number; replied: number }[]; // last 14 days
  rates: { qualification: number; contact: number; reply: number; bounce: number }; // 0..1
  needs_review: number;
  hours_saved: number; // drafted emails x 17.5 min / 60
};

export type EventLevel = "info" | "success" | "warning" | "error";

export type Event = {
  id: number;
  at: string;
  kind: string;
  message: string;
  prospect_id: number | null;
  campaign_id: number | null;
  level: EventLevel;
};

// ---------- Suppression list ----------

export type Suppression = {
  id: number;
  value: string;
  kind: "email" | "domain";
  reason: string;
  created_at: string;
};
