// In-memory implementation of the whole v1 API contract, enabled with VITE_MOCK=1.
// The client calls mockRequest(method, path, body) instead of fetch. State lives in memory and
// resets on reload (only the signed-in flag survives, in localStorage). A ticker advances
// queued -> researching (stage by stage) -> needs_review so polling UI can be seen working.
import { ApiError } from "./client";
import {
  CAMPAIGN_SEEDS,
  COMPANY_SPECS,
  HISTORY,
  SUPPRESSION_SEEDS,
  blankPlaybook,
  sprintoPlaybook,
  type CompanySpec,
  type DraftSpec,
  type EvKey,
  type PageKind,
} from "./mockData";
import type {
  AnalyticsOverview,
  Campaign,
  CampaignStats,
  CompanyProfile,
  Event,
  EventLevel,
  EvidenceItem,
  HookLink,
  Message,
  MessageStatus,
  NewCampaign,
  Playbook,
  PlaybookInput,
  PlaybookSummary,
  ProspectDetail,
  ProspectRow,
  ProspectStatus,
  ProspectTrail,
  Qualification,
  Rubric,
  ScrapedPage,
  SecretsBody,
  Session,
  Settings,
  SettingsPatch,
  SignalScore,
  Stage,
  Suppression,
} from "./types";

// ---------------------------------------------------------------------------------------------
// helpers

const MIN = 60_000;
const now = () => Date.now();
const iso = (t: number) => new Date(t).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => structuredClone(v);

const PATHS: Record<PageKind, string> = {
  home: "/",
  about: "/about",
  careers: "/careers",
  security: "/security",
  pricing: "/pricing",
  customers: "/customers",
};
const pageUrl = (domain: string, kindOrPath: PageKind | string) =>
  `https://${domain}${kindOrPath in PATHS ? PATHS[kindOrPath as PageKind] : kindOrPath}`;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function titleCase(s: string) {
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/)[0]!.split(":")[0]!;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  return d;
}

// ---------------------------------------------------------------------------------------------
// state

type MockProspect = {
  id: number;
  campaign_id: number;
  spec: CompanySpec;
  status: ProspectStatus;
  stage: Stage | null;
  stageIndex: number; // number of pipeline stages completed
  nextAt: number; // when the ticker advances it next
  contactOverride: CompanySpec["contact"] | null;
  overridden: string | null;
  error: string | null;
  updated_at: string;
  created_at: string;
  replied_at: string | null;
};

type MockMessage = Message;

type Db = {
  user: { id: number; email: string; name: string };
  settings: Settings;
  secrets: Record<string, string>;
  playbooks: Playbook[];
  campaigns: (Omit<Campaign, "stats" | "playbook"> & { playbook_id: number })[];
  prospects: MockProspect[];
  messages: MockMessage[];
  events: Event[];
  suppressions: Suppression[];
  ids: { playbook: number; campaign: number; prospect: number; message: number; event: number; suppression: number };
};

const PIPELINE: Stage[] = ["scrape", "extract", "qualify", "poc", "pain_points", "draft"];
const STAGE_MS = 1100;

function defaultSettings(name: string, onboarded: boolean): Settings {
  return {
    workspace_name: name,
    demo_mode: false,
    onboarded,
    sending: {
      mode: "test",
      provider: "gmail",
      from_name: "Priya Raman",
      from_email: "priya.raman.outbound@gmail.com",
      reply_to: "",
      owner_email: "priya.raman.outbound@gmail.com",
      physical_address: "",
      daily_cap: 30,
      send_window: { start_hour: 9, end_hour: 17, timezone: "America/New_York", weekdays_only: true },
    },
    models: { smart: "gemini-3.8-flash", fast: "gemini-3.5-flash-lite" },
    integrations: {
      gemini: { configured: true, source: "env", hint: "…7f3c" },
      hunter: { configured: true, source: "workspace", hint: "…a1b2" },
      resend: { configured: false, source: null, hint: null },
      gmail: { configured: true, source: "workspace", hint: "priya.raman.outbound@gmail.com" },
    },
    hunter_usage: { monthly_budget: 500, used_this_month: 137 },
    live_ready: { ok: false, missing: [] },
    webhook_url: `${typeof window !== "undefined" ? window.location.origin : "https://outreach-os.example"}/api/webhooks/resend`,
  };
}

function computeLiveReady(s: Settings): Settings["live_ready"] {
  const missing: string[] = [];
  if (!s.sending.provider) missing.push("provider");
  else if (!s.integrations[s.sending.provider].configured) missing.push(`${s.sending.provider}_credentials`);
  if (!s.sending.from_email) missing.push("from_email");
  if (!s.sending.physical_address) missing.push("physical_address");
  if (s.demo_mode) missing.push("demo_mode_off");
  return { ok: missing.length === 0, missing };
}

// initialised at the bottom of the module, after every helper exists
let db: Db = null as unknown as Db;

function seed(full: boolean): Db {
  const t = now();
  const d: Db = {
    user: { id: 1, email: "priya.raman.outbound@gmail.com", name: "Priya Raman" },
    settings: defaultSettings("Sprinto outbound", full),
    secrets: {},
    playbooks: [sprintoPlaybook(1, iso(t - 3 * 24 * 60 * MIN))],
    campaigns: [],
    prospects: [],
    messages: [],
    events: [],
    suppressions: [],
    ids: { playbook: 2, campaign: 1, prospect: 1, message: 1, event: 1, suppression: 1 },
  };
  d.settings.live_ready = computeLiveReady(d.settings);
  if (!full) return d;

  const dup = sprintoPlaybook(2, iso(t - 9 * 24 * 60 * MIN));
  dup.name = "Sprinto — GDPR for EU SaaS";
  dup.version = 2;
  dup.research.focus_description = "Capture mentions of GDPR, DPA, EU data residency and ISO 27001 with status. Quote the sentence.";
  d.playbooks.push(dup);
  d.ids.playbook = 3;

  for (const c of CAMPAIGN_SEEDS) {
    d.campaigns.push({
      id: c.id,
      name: c.name,
      status: c.status,
      playbook_id: c.playbook_id,
      auto_approve: c.auto_approve,
      hunter_live: c.hunter_live,
      followups: c.followups,
      created_at: iso(t - c.createdDaysAgo * 24 * 60 * MIN),
    });
  }
  d.ids.campaign = 3;

  db = d; // helpers below read the global
  for (const spec of COMPANY_SPECS) insertSeeded(spec);
  for (const h of HISTORY) insertSeeded(historySpec(h));
  for (const s of SUPPRESSION_SEEDS) {
    d.suppressions.push({ id: d.ids.suppression++, value: s.value, kind: s.kind, reason: s.reason, created_at: iso(t - s.daysAgo * 24 * 60 * MIN) });
  }
  d.events.sort((a, b) => b.at.localeCompare(a.at));
  return d;
}

function historySpec(h: (typeof HISTORY)[number]): CompanySpec {
  const [first, last, title] = h.persona;
  if (h.outcome === "disqualified") {
    return {
      domain: h.domain, name: h.name, campaign: 2, addedMinutesAgo: 40,
      offering: "Photo editing app for creators", offeringQuote: { quote: `${h.name} is a photo editing app for creators`, page: "home" },
      is_b2b: false, b2bQuote: { quote: `${h.name} is a photo editing app for creators`, page: "home" },
      pagesInitial: ["home", "about"], final: "disqualified",
    };
  }
  const spec = genericQualified(h.domain, h.name, first, last, title, h.framework, h.status, 2, h.sentDaysAgo * 24 * 60 + 300);
  spec.message = {
    status: "sent",
    sentMinutesAgo: h.sentDaysAgo * 24 * 60 + (hash(h.domain) % 300),
    replied: h.outcome === "replied",
  };
  spec.final = h.outcome;
  return spec;
}

function genericQualified(
  domain: string, name: string, first: string, last: string, title: string,
  framework: string, status: CompanySpec["focus"] extends (infer F)[] | undefined ? F extends { status: infer S } ? S : never : never,
  campaign: number, addedMinutesAgo: number,
): CompanySpec {
  const statusPhrase: Record<string, string> = {
    in_progress: `We are working toward ${framework}`,
    planned: `${framework} is planned for next year`,
    mentioned: `Ask us about ${framework}`,
    certified: `${name} is ${framework} certified`,
  };
  const hook: Record<string, string> = {
    in_progress: `working toward ${framework}`,
    planned: `${framework} is planned for next year`,
    mentioned: `${framework} comes up`,
    certified: `${framework} certified`,
  };
  const role = "Security Engineer";
  const firstName = first || "there";
  const core = `Hi ${firstName}, saw ${name} is ${status === "planned" ? "planning" : "on the way to"} ${framework} and hiring a ${role}. Until that role is filled, evidence collection, access reviews and security questionnaires usually land on whoever owns engineering. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would a short walkthrough be useful before the audit starts?`;
  return {
    domain, name, campaign, addedMinutesAgo,
    offering: "Developer tooling for platform teams",
    offeringQuote: { quote: `${name} builds developer tooling for platform teams`, page: "home" },
    is_b2b: true, b2bQuote: { quote: `${name} is used by platform teams at growing companies`, page: "home" },
    headcount: { value: "11-50", quote: `${name} is a team of ${20 + (hash(domain) % 25)}`, page: "about" },
    focus: [{ framework, status, quote: statusPhrase[status] ?? framework, page: "security" }],
    hiring: [{ role, quote: `We're hiring a ${role}`, page: "careers" }],
    customers: [
      { name: "Halcyon Robotics", quote: "Teams at Halcyon Robotics and Juniper Freight rely on us", page: "customers" },
      { name: "Juniper Freight", quote: "Teams at Halcyon Robotics and Juniper Freight rely on us", page: "customers" },
    ],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: first ? { first, last, title, confidence: 85 + (hash(domain) % 14), source: "hunter" } : undefined,
    candidates: first
      ? [{ first, last, position: title, category: "security_lead", score: 60 + (hash(domain) % 15), eligible: true, notes: ["top title match for the small band", "verified valid"] }]
      : [],
    candidatesSeen: 3 + (hash(domain) % 6),
    draft: {
      subject: `${framework.toLowerCase()} timeline`,
      core,
      pains: [
        { pain: "Engineering roadmap time gets pulled into evidence collection and access reviews.", role_link: "an engineering leader owns roadmap time", ev: "focus:0" },
        { pain: "Until the security hire lands, questionnaires sit with engineering.", role_link: "an engineering leader covers the gap", ev: "hiring:0" },
      ],
      claims: [
        { claim: `hiring a ${role}`, ev: "hiring:0" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "needs_review" },
    final: "needs_review",
    ...(hook[status] ? {} : {}),
  };
}

/** A believable spec for a domain the user just added. Deterministic per domain. */
function syntheticSpec(domain: string, campaign: number, contact?: CompanySpec["contact"]): CompanySpec {
  const label = domain.split(".")[0]!;
  const name = titleCase(label);
  const h = hash(domain) % 20;
  if (contact) {
    const s = genericQualified(domain, name, contact.first, contact.last ?? "", contact.title, "SOC 2 Type II", "in_progress", campaign, 0);
    s.contact = contact;
    s.candidates = [];
    s.candidatesSeen = 0;
    return s;
  }
  // Demo-mode sample domains: fixed outcomes so a demo shows every branch.
  const fixed: Record<string, "qualified" | "consumer" | "big" | "gray" | "nocontact" | "rejected"> = {
    "ledgerloop.io": "qualified", "payrollpilot.com": "qualified", "claimsbridge.ai": "qualified",
    "fieldnote.dev": "rejected", "pocketpals.app": "consumer", "globalbank-cloud.com": "big",
    "stealthco.xyz": "gray", "quietops.io": "nocontact",
  };
  const forced = fixed[domain];
  if (forced === "big") {
    return {
      domain, name, campaign, addedMinutesAgo: 0,
      offering: "Core banking cloud for global banks", offeringQuote: { quote: `${name} runs core banking for global banks`, page: "home" },
      is_b2b: true, b2bQuote: { quote: `${name} serves 300 banks worldwide`, page: "home" },
      headcount: { value: "1001+", quote: "more than 4,000 employees in 30 countries", page: "about" },
      pagesInitial: ["home", "about", "security"], final: "disqualified",
    };
  }
  if (forced === "rejected") {
    const s = genericQualified(domain, name, "Maya", "Holt", "CTO", "SOC 2 Type II", "in_progress", campaign, 0);
    s.draft!.validation = { ok: false, failures: ["Unsupported claim: \"10x faster audits\" has no evidence on the company's pages", "Body is 38 words; the playbook allows 50 to 90"], attempts: 2 };
    s.draft!.core = `Hi Maya, ${name} could get 10x faster audits with Sprinto. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR. Worth a call this week to see the product and talk about your timeline?`;
    return s;
  }
  if (h < 3 || forced === "consumer") {
    if (forced && forced !== "consumer") return genericQualified(domain, name, "Isla", "Moreno", "Head of Security", "SOC 2 Type II", "in_progress", campaign, 0);
    return {
      domain, name, campaign, addedMinutesAgo: 0,
      offering: "Habit tracking app for individuals", offeringQuote: { quote: `${name} helps you build better habits, one day at a time`, page: "home" },
      is_b2b: false, b2bQuote: { quote: `${name} helps you build better habits, one day at a time`, page: "home" },
      pagesInitial: ["home", "about"], final: "disqualified",
    };
  }
  if ((h < 6 && !forced) || forced === "gray") {
    return {
      domain, name, campaign, addedMinutesAgo: 0,
      offering: "Analytics for operations teams", offeringQuote: { quote: `${name} gives operations teams one view of their data`, page: "home" },
      is_b2b: true, b2bQuote: { quote: `${name} is built for operations teams`, page: "home" },
      pagesInitial: ["home"],
      pagesFailed: [{ path: "/about", kind: "about", status: "ok", reason: "too_short" }],
      research: [
        { kind: "security", path: "/security", reason: "compliance_pursuit is unknown (30 points)", outcome: "unavailable" },
        { kind: "careers", path: "/careers", reason: "security_hiring is unknown (20 points)", outcome: "unavailable" },
      ],
      final: "insufficient_data",
    };
  }
  if ((h < 8 && !forced) || forced === "nocontact") {
    const s = genericQualified(domain, name, "", "", "", "SOC 2 Type II", "planned", campaign, 0);
    s.contact = undefined;
    s.candidates = [{ first: null, last: null, position: null, category: null, score: 0, eligible: false, notes: ["generic address (hello@)"] }];
    s.noContactReason = "Hunter returned no suitable named person for this company";
    s.final = "no_contact";
    return s;
  }
  const people: [string, string, string][] = [
    ["Isla", "Moreno", "Head of Security"], ["Felix", "Brandt", "CTO"], ["Amara", "Nwosu", "VP Engineering"],
    ["Jonah", "Kim", "Co-founder & CTO"], ["Lucia", "Ferraro", "Head of Engineering"], ["Theo", "Laurent", "CISO"],
  ];
  const [f, l, t] = people[hash(domain + "p") % people.length]!;
  const fw = ["SOC 2 Type II", "ISO 27001", "SOC 2 Type I"][hash(domain + "f") % 3]!;
  return genericQualified(domain, name, f, l, t, fw, hash(domain + "s") % 2 ? "in_progress" : "planned", campaign, 0);
}

// ---------------------------------------------------------------------------------------------
// scoring: the rubric applied to a spec's profile, the same rules as config/icp.toml

function profileOf(spec: CompanySpec): CompanyProfile {
  const u = (k: PageKind) => pageUrl(spec.domain, k);
  return {
    name: spec.name ? { value: spec.name, quote: `${spec.name} is`, source_url: u("home") } : null,
    offering: spec.offering ? { value: spec.offering, quote: spec.offering, source_url: u("home") } : null,
    is_b2b: spec.is_b2b === null ? null : { value: spec.is_b2b, quote: `${spec.name} is`, source_url: u("home") },
    stage: spec.stage ? { value: spec.stage.value, as_of: null, quote: spec.stage.value, source_url: u("about") } : null,
    headcount: spec.headcount ? { value: spec.headcount.value, quote: spec.headcount.quote, source_url: u(spec.headcount.page) } : null,
    focus_mentions: (spec.focus ?? []).map((f) => ({ framework: f.framework, status: f.status, as_of: f.as_of ?? null, quote: f.quote, source_url: u(f.page) })),
    hiring_signals: (spec.hiring ?? []).map((x) => ({ role: x.role, quote: x.quote, source_url: u(x.page) })),
    enterprise_customers: (spec.customers ?? []).map((x) => ({ name: x.name, quote: x.quote, source_url: u(x.page) })),
  };
}

function readKinds(spec: CompanySpec, withResearch: boolean): Set<PageKind> {
  const s = new Set<PageKind>(spec.pagesInitial);
  if (withResearch) for (const r of spec.research ?? []) if ((r.outcome ?? "fetched") === "fetched") s.add(r.kind);
  return s;
}

function normFramework(f: string) {
  return f.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreSpec(rubric: Rubric, spec: CompanySpec, kinds: Set<PageKind>) {
  const p = profileOf(spec);
  const u = (k: PageKind) => pageUrl(spec.domain, k);
  // Only facts observed on pages actually read count.
  const seen = <T extends { page: PageKind }>(xs: T[] | undefined) => (xs ?? []).filter((x) => kinds.has(x.page));
  const focus = seen(spec.focus);
  const hiring = seen(spec.hiring);
  const customers = seen(spec.customers);
  const b2bKnown = spec.is_b2b !== null && spec.b2bQuote && kinds.has(spec.b2bQuote.page);
  const stageKnown = spec.stage && kinds.has(spec.stage.page);
  const hcKnown = spec.headcount && kinds.has(spec.headcount.page);
  const offeringKnown = spec.offering && spec.offeringQuote && kinds.has(spec.offeringQuote.page);

  const signals: SignalScore[] = rubric.signals.map((sig) => {
    const base = { id: sig.id, label: sig.label, group: sig.group, weight: sig.weight };
    const unknown = (basis: string): SignalScore => ({ ...base, status: "unknown", points_min: 0, points_max: sig.weight, basis, evidence: [] });
    const known = (pts: number, basis: string, evidence: { quote: string; source_url: string }[]): SignalScore => ({
      ...base, status: "known", points_min: Math.min(pts, sig.weight), points_max: Math.min(pts, sig.weight), basis, evidence,
    });
    const observedRead = (sig.observed_on ?? sig.target_kinds ?? []).some((k) => kinds.has(k as PageKind));
    switch (sig.field) {
      case "is_b2b":
        return b2bKnown ? known(sig.points?.[String(spec.is_b2b)] ?? 0, `is_b2b=${spec.is_b2b}`, [{ quote: spec.b2bQuote!.quote, source_url: u(spec.b2bQuote!.page) }]) : unknown("unknown: no page says who it sells to");
      case "stage":
        return stageKnown ? known(sig.points?.[spec.stage!.value] ?? 0, `stage=${spec.stage!.value}`, [{ quote: spec.stage!.quote, source_url: u(spec.stage!.page) }]) : unknown("unknown: stage not stated");
      case "headcount":
        return hcKnown ? known(sig.points?.[spec.headcount!.value] ?? 0, `headcount=${spec.headcount!.value}`, [{ quote: spec.headcount!.quote, source_url: u(spec.headcount!.page) }]) : unknown("unknown: headcount not stated");
      case "focus_mentions": {
        if (!focus.length) return observedRead ? known(0, "no framework mentioned on the security page", []) : unknown("unknown: no security page read");
        let best = focus[0]!;
        for (const f of focus) if ((sig.points?.[f.status] ?? 0) > (sig.points?.[best.status] ?? 0)) best = f;
        return known(sig.points?.[best.status] ?? 0, `status=${best.status} (${best.framework})`, focus.map((f) => ({ quote: f.quote, source_url: u(f.page) })));
      }
      case "enterprise_customers": {
        if (!customers.length) return observedRead ? known(0, "no named customers on the customers page", []) : unknown("unknown: no customers page read");
        const n = customers.length;
        const tier = (sig.tiers ?? []).find(([min]) => n >= min);
        const quotes = Array.from(new Map(customers.map((c) => [c.quote, { quote: c.quote, source_url: u(c.page) }])).values());
        return known(tier ? tier[1] : 0, `${n} named customer${n === 1 ? "" : "s"}: ${customers.map((c) => c.name).join(", ")}`, quotes);
      }
      case "hiring_signals": {
        if (!hiring.length) return observedRead ? known(0, "no matching roles on the careers page", []) : unknown("unknown: no careers page read");
        let best = 0;
        let hit = "";
        for (const hs of hiring) {
          const role = hs.role.toLowerCase();
          for (const g of sig.keyword_groups ?? []) {
            const kw = g.keywords.find((k) => new RegExp(`\\b${k}\\b`).test(role));
            if (kw && g.points > best) {
              best = g.points;
              hit = `${hs.role} (matches "${kw}")`;
            }
          }
        }
        return known(best, best ? hit : `${hiring.length} role(s), none matching`, hiring.map((x) => ({ quote: x.quote, source_url: u(x.page) })));
      }
      case "offering": {
        if (!offeringKnown) return unknown("unknown: offering not stated");
        const text = spec.offering!.toLowerCase();
        const kw = (sig.keywords ?? []).find((k) => new RegExp(`\\b${k}\\b`).test(text));
        return known(kw ? sig.points?.match ?? sig.weight : 0, kw ? `matches "${kw}"` : "no vertical keyword", [{ quote: spec.offeringQuote!.quote, source_url: u(spec.offeringQuote!.page) }]);
      }
      default:
        return unknown("unknown");
    }
  });

  const gates = rubric.gates.map((g) => {
    let value: unknown = null;
    if (g.field === "is_b2b") value = b2bKnown ? spec.is_b2b : null;
    if (g.field === "headcount") value = hcKnown ? spec.headcount!.value : null;
    const status: "pass" | "fail" | "unknown" = value === null ? "unknown" : g.fail_values.includes(value) ? "fail" : "pass";
    return { id: g.id, label: g.label, status, basis: value === null ? `${g.field} not stated` : `${g.field}=${String(value)}` };
  });

  const certified = new Set(focus.filter((f) => f.status === "certified").map((f) => normFramework(f.framework)));
  const penalties = rubric.penalties
    .filter((pen) => pen.requires.every((r) => certified.has(r)) && !(pen.excludes ?? []).some((x) => certified.has(x)))
    .map((pen) => ({ id: pen.id, label: pen.label, points: pen.points }));
  const penaltyTotal = penalties.reduce((a, b) => a + b.points, 0);

  const smin = Math.max(0, signals.reduce((a, s) => a + s.points_min, 0) - penaltyTotal);
  const smax = Math.max(0, signals.reduce((a, s) => a + s.points_max, 0) - penaltyTotal);
  const expected = Math.round((smin + rubric.thresholds.unknown_credit * (smax - smin)) * 10) / 10;
  return {
    profile: p,
    score: {
      signals, gates, penalties, score_min: smin, score_max: smax, score_expected: expected,
      unknown_signals: signals.filter((s) => s.status === "unknown").map((s) => s.id),
    },
  };
}

function qualify(rubric: Rubric, spec: CompanySpec, overridden: string | null): Qualification {
  const th = rubric.thresholds;
  const initial = scoreSpec(rubric, spec, readKinds(spec, false));
  const decide = (sc: typeof initial.score, researched: boolean): { verdict: Qualification["verdict"] | "loop"; reason: string } => {
    const failed = sc.gates.find((g) => g.status === "fail");
    if (failed) return { verdict: "disqualified", reason: `gate ${failed.id} failed: ${failed.basis}` };
    if (sc.score_max < th.reject_max) return { verdict: "disqualified", reason: `score_max ${sc.score_max} < reject_max ${th.reject_max}` };
    if (sc.score_min >= th.qualify_min) return { verdict: "qualified", reason: `score_min ${sc.score_min} >= qualify_min ${th.qualify_min}` };
    const knownCount = sc.signals.filter((s) => s.status === "known").length;
    if (researched && knownCount >= 2 && (sc.score_expected ?? 0) >= th.qualify_expected)
      return { verdict: "qualified", reason: `qualified on expected score: ${sc.score_expected} >= qualify_expected ${th.qualify_expected} with ${knownCount} known signals` };
    if (!researched) return { verdict: "loop", reason: "gray band; research loop runs" };
    return {
      verdict: "insufficient_data",
      reason: `score ${sc.score_min}-${sc.score_max} (expected ${sc.score_expected}) stays between reject_max ${th.reject_max} and qualify_min ${th.qualify_min} after research`,
    };
  };
  const first = decide(initial.score, false);
  let finalScore = initial.score;
  let research: Qualification["research"] = null;
  let verdict = first.verdict;
  let reason = first.reason;
  if (first.verdict === "loop") {
    const steps: NonNullable<Qualification["research"]>["steps"] = [];
    const kinds = readKinds(spec, false);
    let prev = initial.score;
    (spec.research ?? []).forEach((r, i) => {
      const outcome = r.outcome ?? "fetched";
      if (outcome === "fetched") kinds.add(r.kind);
      const sc = scoreSpec(rubric, spec, kinds).score;
      const resolved = prev.unknown_signals.filter((id) => !sc.unknown_signals.includes(id));
      steps.push({
        iteration: i + 1, tool: "fetch_page", url: pageUrl(spec.domain, r.path ?? r.kind), reason: r.reason, outcome,
        resolved_signals: resolved, score_min: sc.score_min, score_max: sc.score_max,
      });
      prev = sc;
    });
    finalScore = prev;
    const after = decide(finalScore, true);
    verdict = after.verdict === "loop" ? "insufficient_data" : after.verdict;
    reason = after.reason;
    research = {
      stop_reason: verdict === "qualified" ? "sufficient_data" : steps.length ? "no_candidates" : "no_candidates",
      iterations: steps.length,
      fetches: steps.filter((s) => s.outcome === "fetched").length,
      steps,
    };
  } else {
    research = { stop_reason: "not_needed", iterations: 0, fetches: 0, steps: [] };
  }
  const q: Qualification = {
    verdict: verdict as Qualification["verdict"],
    initial_verdict: first.verdict === "loop" ? "loop" : (first.verdict as "qualified" | "disqualified"),
    reason,
    rubric_version: rubric.version,
    thresholds: { ...th },
    score: finalScore,
    research,
  };
  if (overridden) {
    q.manual_override = overridden;
    q.verdict = "qualified";
  }
  return q;
}

// ---------------------------------------------------------------------------------------------
// trail and draft construction

function evidencePack(spec: CompanySpec): { pack: EvidenceItem[]; idOf: (k: EvKey) => string } {
  const pack: EvidenceItem[] = [];
  const keyToId = new Map<string, string>();
  const u = (k: PageKind) => pageUrl(spec.domain, k);
  const add = (key: string, kind: string, fact: string, quote: string, page: PageKind) => {
    const id = `E${pack.length + 1}`;
    pack.push({ id, kind, fact, quote, source_url: u(page) });
    keyToId.set(key, id);
  };
  (spec.focus ?? []).forEach((f, i) => add(`focus:${i}`, "focus_mention", `${f.framework}: ${f.status.replace("_", " ")}`, f.quote, f.page));
  (spec.hiring ?? []).forEach((h, i) => add(`hiring:${i}`, "hiring_signal", `Hiring: ${h.role}`, h.quote, h.page));
  if (spec.customers?.length) add("customers", "enterprise_customers", `Customers: ${spec.customers.map((c) => c.name).join(", ")}`, spec.customers[0]!.quote, spec.customers[0]!.page);
  if (spec.headcount) add("headcount", "headcount", `Headcount ${spec.headcount.value}`, spec.headcount.quote, spec.headcount.page);
  if (spec.offering && spec.offeringQuote) add("offering", "offering", spec.offering, spec.offeringQuote.quote, spec.offeringQuote.page);
  return { pack, idOf: (k) => (k === "S1" || k === "S2" ? k : keyToId.get(k) ?? "E1") };
}

function hookMap(spec: CompanySpec, draft: DraftSpec, pb: Playbook): HookLink[] {
  const { pack, idOf } = evidencePack(spec);
  return draft.claims.map((c) => {
    const id = idOf(c.ev);
    if (id.startsWith("S")) return { claim: c.claim, evidence_id: id, quote: pb.value_claims.find((v) => v.id === id)?.text ?? "", source_url: "" };
    const e = pack.find((x) => x.id === id)!;
    return { claim: c.claim, evidence_id: id, quote: e.quote, source_url: e.source_url };
  });
}

function contactFor(p: MockProspect) {
  if (p.contactOverride) return p.contactOverride;
  const camp = db.campaigns.find((c) => c.id === p.campaign_id);
  if (camp && !camp.hunter_live && !db.settings.demo_mode && p.spec.contact?.source !== "manual") return null;
  return p.spec.contact ?? null;
}

function contactEmail(spec: CompanySpec, c: NonNullable<CompanySpec["contact"]>) {
  return c.email ?? `${c.first.toLowerCase().replace(/[^a-z]/g, "")}@${spec.domain}`;
}

function footerFor(pb: Playbook, company: string) {
  const addr = db.settings.sending.physical_address || "[Sender postal address]";
  return `--\n${pb.email.sender_name || "[Sender name]"}, ${pb.email.sender_title || "[Title]"}, ${pb.product.name || "[Product]"}\n${addr}\nYou are receiving this one-time note because of your role at ${company}. If you would rather not hear from us, reply "no" and I will not email again.`;
}

const BUILTIN_BANNED = [
  "hope this finds you", "hope you're well", "i came across", "quick question", "revolutionary", "cutting-edge",
  "best-in-class", "world-class", "reaching out", "just checking in", "i wanted to", "leverage", "congrats",
];

function validate(pb: Playbook, subject: string, core: string): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const words = core.trim().split(/\s+/).filter(Boolean).length;
  if (words < pb.email.min_words || words > pb.email.max_words)
    failures.push(`Body is ${words} words; the playbook allows ${pb.email.min_words} to ${pb.email.max_words}`);
  const lower = `${subject}\n${core}`.toLowerCase();
  for (const phrase of [...BUILTIN_BANNED, ...pb.email.extra_banned_phrases.map((x) => x.toLowerCase())])
    if (phrase && lower.includes(phrase)) failures.push(`Banned phrase: "${phrase}"`);
  if (subject.length > 60) failures.push(`Subject is ${subject.length} characters; keep it under 60`);
  if (!subject.trim()) failures.push("Subject is empty");
  if (/\[[^\]]+\]/.test(core)) failures.push("Unfilled placeholder in the body");
  return { ok: failures.length === 0, failures };
}

function playbookFor(campaignId: number): Playbook {
  const c = db.campaigns.find((x) => x.id === campaignId);
  return db.playbooks.find((p) => p.id === c?.playbook_id) ?? db.playbooks[0]!;
}

function buildTrail(p: MockProspect): ProspectTrail {
  const spec = p.spec;
  const pb = playbookFor(p.campaign_id);
  const done = p.stageIndex; // stages completed
  const trail: ProspectTrail = { scrape: null, extract: null, qualify: null, poc: null, draft: null };
  if (done >= 1) {
    const pages: ScrapedPage[] = [
      ...spec.pagesInitial.map((k) => ({ url: pageUrl(spec.domain, k), status: "ok", kind: k, chars: 1800 + (hash(spec.domain + k) % 9000), reason: null })),
      ...(spec.pagesFailed ?? []).map((f) => ({ url: pageUrl(spec.domain, f.path), status: f.status, kind: f.kind, chars: f.reason === "too_short" ? 140 : 0, reason: f.reason })),
    ];
    trail.scrape = { pages, usable: spec.pagesInitial.length, kinds_found: [...spec.pagesInitial] };
  }
  if (done >= 2 && spec.pagesInitial.length) {
    const kept = (spec.focus?.length ?? 0) + (spec.hiring?.length ?? 0) + (spec.customers?.length ?? 0) + (spec.headcount ? 1 : 0) + (spec.offering ? 2 : 0) + (spec.stage ? 1 : 0);
    const dropped = (spec.dropped ?? []).map((d) => ({ field: d.field, quote: d.quote, source_url: pageUrl(spec.domain, d.page), reason: d.reason }));
    trail.extract = {
      profile: profileOf(spec),
      evidence_total: kept + dropped.length,
      evidence_kept: kept,
      evidence_dropped: dropped,
      injection_suspected_pages: [],
    };
  }
  if (done >= 3 && spec.pagesInitial.length) {
    trail.qualify = qualify(pb.icp, spec, p.overridden);
    // research fetches show up as scraped pages too
    if (trail.scrape && trail.qualify.research?.steps.length) {
      for (const s of trail.qualify.research.steps) {
        const r = (spec.research ?? []).find((x) => pageUrl(spec.domain, x.path ?? x.kind) === s.url);
        trail.scrape.pages.push({
          url: s.url ?? "", status: s.outcome === "fetched" ? "ok" : "unavailable", kind: r?.kind ?? null,
          chars: s.outcome === "fetched" ? 2400 + (hash(s.url ?? "") % 5000) : 0, reason: s.outcome === "fetched" ? "research loop" : "http_404",
        });
      }
      trail.scrape.usable = trail.scrape.pages.filter((x) => x.status === "ok" && x.reason !== "too_short").length;
      trail.scrape.kinds_found = Array.from(new Set(trail.scrape.pages.filter((x) => x.status === "ok" && x.kind && x.reason !== "too_short").map((x) => x.kind!)));
    }
  }
  const c = contactFor(p);
  if (done >= 4 && c && trail.qualify?.verdict === "qualified") {
    const band = (spec.headcount && { "1-10": "small", "11-50": "small", "51-200": "mid" }[spec.headcount.value]) || (spec.headcount ? "large" : "mid");
    const basis = spec.headcount ? `headcount ${spec.headcount.value}` : "headcount unknown, defaulting to the mid band";
    const manual = c.source === "manual" || p.contactOverride;
    const top = manual ? [] : spec.candidates ?? [];
    const runner = top.find((x, i) => i > 0 && x.eligible);
    trail.poc = {
      contact: { first_name: c.first, last_name: c.last, email: contactEmail(spec, c), position: c.title, confidence: manual ? null : c.confidence, source: manual ? "manual" : c.source === "sample" ? "fixture" : "live" },
      band: band as "small" | "mid" | "large",
      band_basis: basis,
      reason: manual
        ? `${c.first} ${c.last ?? ""}, ${c.title}: set manually; Hunter search skipped.`
        : `${c.first} ${c.last ?? ""}, ${c.title}: top title match for the ${band} band (${basis}), score ${top[0]?.score ?? "-"}${runner ? `; ahead of ${runner.first} (${runner.position}, ${runner.score}) on higher title rank` : ""}.`,
      top_candidates: top.map((x) => ({ first_name: x.first, last_name: x.last, position: x.position, category: x.category, score: x.score, eligible: x.eligible, notes: x.notes })),
      candidates_seen: manual ? 0 : spec.candidatesSeen ?? top.length,
      risks: spec.risks ?? [],
    };
  }
  if (done >= 6 && trail.poc && spec.draft) {
    const { pack, idOf } = evidencePack(spec);
    trail.draft = {
      pain_points: spec.draft.pains.map((x) => ({ pain: x.pain, role_link: x.role_link, evidence_id: idOf(x.ev) })),
      pain_points_source: spec.draft.pains_source ?? "llm",
      evidence_pack: pack,
      hook_map: hookMap(spec, spec.draft, pb),
      validation: spec.draft.validation ?? { ok: true, failures: [], attempts: 1 },
    };
  }
  return trail;
}

function finalStatusFromTrail(p: MockProspect, trail: ProspectTrail): ProspectStatus {
  const q = trail.qualify;
  if (!q) return p.spec.pagesInitial.length ? "insufficient_data" : "failed";
  if (q.verdict === "disqualified") return "disqualified";
  if (q.verdict === "insufficient_data") return "insufficient_data";
  if (!trail.poc) return "no_contact";
  if (trail.draft && trail.draft.validation && !trail.draft.validation.ok) return "rejected_draft";
  return "needs_review";
}

// ---------------------------------------------------------------------------------------------
// events

function addEvent(kind: string, message: string, level: EventLevel, prospect: MockProspect | null, at = iso(now()), campaign_id?: number) {
  db.events.unshift({
    id: db.ids.event++, at, kind, message, level,
    prospect_id: prospect?.id ?? null, campaign_id: prospect?.campaign_id ?? campaign_id ?? null,
  });
}

function label(p: MockProspect) {
  return p.spec.name ?? p.spec.domain;
}

// ---------------------------------------------------------------------------------------------
// messages

function createMessage(p: MockProspect, step: number, subject: string, core: string, status: MessageStatus, created: string): MockMessage {
  const pb = playbookFor(p.campaign_id);
  const c = contactFor(p)!;
  const company = p.spec.name ?? p.spec.domain;
  const footer = footerFor(pb, company);
  const camp = db.campaigns.find((x) => x.id === p.campaign_id)!;
  const draft = p.spec.draft;
  const hm = draft ? hookMap(p.spec, draft, pb) : [];
  const { idOf } = evidencePack(p.spec);
  const m: MockMessage = {
    id: db.ids.message++,
    prospect_id: p.id,
    campaign: { id: camp.id, name: camp.name },
    company: { domain: p.spec.domain, name: p.spec.name },
    step,
    to: { name: `${c.first} ${c.last ?? ""}`.trim(), email: contactEmail(p.spec, c), title: c.title },
    delivered_to: null,
    subject,
    body: core,
    footer,
    status,
    validation: step === 0 && draft?.validation && !draft.validation.ok ? { ok: false, failures: draft.validation.failures } : validate(pb, subject, core),
    hook_map: step === 0 ? hm.filter((h) => core.toLowerCase().includes(h.claim.toLowerCase())) : [],
    pain_points: step === 0 && draft ? draft.pains.map((x) => ({ pain: x.pain, role_link: x.role_link, evidence_id: idOf(x.ev) })) : [],
    scheduled_at: null,
    sent_at: null,
    provider_id: null,
    error: null,
    created_at: created,
    mode: null,
  };
  db.messages.push(m);
  return m;
}

function markSent(m: MockMessage, at: string) {
  m.status = "sent";
  m.sent_at = at;
  m.mode = db.settings.demo_mode ? "demo" : db.settings.sending.mode;
  m.delivered_to = m.mode === "demo" ? null : m.mode === "test" ? db.settings.sending.owner_email : m.to.email;
  m.provider_id = `${db.settings.sending.provider ?? "gmail"}_${(hash(m.subject + m.id) % 1e8).toString(16)}`;
}

// ---------------------------------------------------------------------------------------------
// seeding

function insertSeeded(spec: CompanySpec) {
  const created = now() - spec.addedMinutesAgo * MIN;
  const p: MockProspect = {
    id: db.ids.prospect++,
    campaign_id: spec.campaign,
    spec,
    status: "queued",
    stage: null,
    stageIndex: 0,
    nextAt: Infinity,
    contactOverride: null,
    overridden: null,
    error: null,
    updated_at: iso(created),
    created_at: iso(created),
    replied_at: null,
  };
  db.prospects.push(p);
  addEvent("prospect.added", `${spec.domain} added to the campaign`, "info", p, iso(created));

  if (spec.final === "queued") {
    p.nextAt = now() + 3000;
    return;
  }
  if (spec.final === "researching") {
    p.status = "researching";
    p.stageIndex = PIPELINE.indexOf(spec.stage_now ?? "extract");
    p.stage = PIPELINE[p.stageIndex]!;
    p.nextAt = now() + 2500;
    return;
  }
  if (spec.final === "failed") {
    p.status = "failed";
    p.stageIndex = 1;
    p.stage = "scrape";
    p.error = spec.error ?? "Unknown error";
    p.updated_at = iso(created + 2 * MIN);
    addEvent("prospect.failed", `${spec.domain}: ${p.error}`, "error", p, p.updated_at);
    return;
  }
  p.stageIndex = 6;
  const trail = buildTrail(p);
  const t0 = created + 3 * MIN;
  addEvent("research.done", `Read ${trail.scrape?.usable ?? 0} pages on ${spec.domain}`, "info", p, iso(t0));
  if (trail.qualify) {
    const q = trail.qualify;
    addEvent(
      `qualify.${q.verdict}`,
      `${label(p)} ${q.verdict === "qualified" ? "qualified" : q.verdict === "disqualified" ? "disqualified" : "has insufficient data"} (score ${q.score.score_min}-${q.score.score_max})`,
      q.verdict === "qualified" ? "success" : q.verdict === "disqualified" ? "info" : "warning",
      p, iso(t0 + MIN),
    );
  }
  if (trail.poc) addEvent("poc.found", `Contact found: ${trail.poc.contact.first_name} ${trail.poc.contact.last_name ?? ""}, ${trail.poc.contact.position}`, "info", p, iso(t0 + 2 * MIN));
  const natural = finalStatusFromTrail(p, trail);
  if (natural === "no_contact") addEvent("poc.none", `No suitable contact at ${label(p)}`, "warning", p, iso(t0 + 2 * MIN));

  const ms = spec.message;
  if (spec.draft && trail.poc && ms) {
    const draftAt = iso(t0 + 3 * MIN);
    const m = createMessage(p, 0, spec.draft.subject, spec.draft.core, "needs_review", draftAt);
    if (natural === "rejected_draft" || ms.status === "rejected") {
      m.status = "rejected";
      addEvent("draft.rejected", `Validator refused both drafts for ${label(p)}`, "warning", p, draftAt);
    } else addEvent("draft.ready", `Draft ready for review: "${m.subject}"`, "info", p, draftAt);

    if (ms.status === "scheduled") {
      m.status = "scheduled";
      m.scheduled_at = iso(now() + (ms.scheduledInMinutes ?? 60) * MIN);
      addEvent("message.approved", `Approved "${m.subject}" for ${m.to.name}`, "success", p, iso(now() - 40 * MIN));
    }
    if (ms.status === "sent" || ms.status === "bounced") {
      const sentAt = now() - (ms.sentMinutesAgo ?? 60) * MIN;
      markSent(m, iso(sentAt));
      addEvent("message.sent", `Sent "${m.subject}" to ${m.to.name}`, "success", p, iso(sentAt));
      if (ms.status === "bounced") {
        m.status = "bounced";
        m.error = ms.error ?? "Bounced";
        addEvent("message.bounced", `Bounced: ${m.to.email} (${m.error})`, "error", p, iso(sentAt + 4 * MIN));
      }
      if (ms.replied) {
        p.replied_at = iso(sentAt + (5 + (hash(spec.domain) % 30)) * 60 * MIN);
        if (new Date(p.replied_at).getTime() > now()) p.replied_at = iso(now() - 30 * MIN);
        addEvent("message.replied", `${m.to.name} replied`, "success", p, p.replied_at);
      }
      if (ms.followup) {
        const f = createMessage(p, 1, ms.followup.subject, ms.followup.core, "scheduled", iso(sentAt));
        f.validation = { ok: true, failures: [] };
        if (ms.followup.status === "sent") {
          markSent(f, iso(now() + ms.followup.inMinutes * MIN));
          addEvent("message.sent", `Sent follow-up 1 to ${f.to.name}`, "success", p, f.sent_at!);
        } else {
          f.status = ms.followup.status;
          f.scheduled_at = iso(now() + ms.followup.inMinutes * MIN);
        }
      }
    }
    if (spec.final === "unsubscribed") addEvent("prospect.unsubscribed", `${m.to.email} unsubscribed (one-click)`, "warning", p, iso(now() - 11 * 24 * 60 * MIN));
    if (spec.final === "completed") addEvent("sequence.completed", `Sequence finished for ${label(p)} with no reply`, "info", p, iso(now() - 8 * 24 * 60 * MIN));
  }
  p.status = ["sent", "replied", "bounced", "unsubscribed", "completed", "approved"].includes(spec.final) ? spec.final : natural;
  p.stage = null;
  p.updated_at = db.events.find((e) => e.prospect_id === p.id)?.at ?? p.created_at;
}

// ---------------------------------------------------------------------------------------------
// ticker: advances the pipeline and sends approved mail

function tick(): number {
  let processed = 0;
  const t = now();
  for (const p of db.prospects) {
    if (p.nextAt > t) continue;
    const camp = db.campaigns.find((c) => c.id === p.campaign_id);
    if (!camp || camp.status !== "running") continue;
    processed++;
    if (p.status === "queued") {
      p.status = "researching";
      p.stage = "scrape";
      p.stageIndex = 0;
      p.nextAt = t + STAGE_MS;
      p.updated_at = iso(t);
      continue;
    }
    if (p.status !== "researching") continue;
    p.stageIndex += 1;
    p.updated_at = iso(t);
    const trail = buildTrail(p);
    // stop early where the real pipeline would
    const stopNow =
      (p.stageIndex === 1 && !p.spec.pagesInitial.length) ||
      (p.stageIndex >= 3 && trail.qualify && trail.qualify.verdict !== "qualified") ||
      (p.stageIndex >= 4 && !trail.poc) ||
      p.stageIndex >= 6;
    if (p.stageIndex === 1) addEvent("research.done", `Read ${trail.scrape?.usable ?? 0} pages on ${p.spec.domain}`, "info", p);
    if (p.stageIndex === 3 && trail.qualify) {
      const q = trail.qualify;
      addEvent(`qualify.${q.verdict}`, `${label(p)} ${q.verdict.replace("_", " ")} (score ${q.score.score_min}-${q.score.score_max})`, q.verdict === "qualified" ? "success" : q.verdict === "disqualified" ? "info" : "warning", p);
    }
    if (p.stageIndex === 4 && trail.poc) addEvent("poc.found", `Contact found: ${trail.poc.contact.first_name} ${trail.poc.contact.last_name ?? ""}, ${trail.poc.contact.position}`, "info", p);
    if (!stopNow) {
      p.stage = PIPELINE[p.stageIndex] ?? null;
      p.nextAt = t + STAGE_MS;
      continue;
    }
    p.stage = null;
    p.nextAt = Infinity;
    if (p.stageIndex === 1 && !p.spec.pagesInitial.length) {
      p.status = "failed";
      p.error = p.spec.error ?? `No readable pages on ${p.spec.domain}`;
      addEvent("prospect.failed", `${p.spec.domain}: ${p.error}`, "error", p);
      continue;
    }
    p.stageIndex = 6;
    const status = finalStatusFromTrail(p, trail);
    p.status = status;
    if (status === "no_contact") addEvent("poc.none", `No suitable contact at ${label(p)}`, "warning", p);
    if ((status === "needs_review" || status === "rejected_draft") && p.spec.draft) {
      db.messages = db.messages.filter((m) => !(m.prospect_id === p.id && (m.status === "needs_review" || m.status === "rejected")));
      const m = createMessage(p, 0, p.spec.draft.subject, p.spec.draft.core, status === "rejected_draft" ? "rejected" : "needs_review", iso(t));
      if (status === "needs_review" && camp.auto_approve && m.validation.ok) {
        approve(m, null);
        addEvent("message.approved", `Auto-approved "${m.subject}"`, "success", p);
      } else addEvent("draft.ready", `Draft ready for review: "${m.subject}"`, "info", p);
    }
  }
  for (const m of db.messages) {
    if ((m.status === "approved" || m.status === "scheduled") && m.scheduled_at && new Date(m.scheduled_at).getTime() <= t) {
      markSent(m, iso(t));
      processed++;
      const p = db.prospects.find((x) => x.id === m.prospect_id);
      if (p) {
        if (m.step === 0) p.status = "sent";
        p.updated_at = iso(t);
        addEvent("message.sent", `Sent "${m.subject}" to ${m.to.name}${m.mode === "test" ? ` (test mode: delivered to ${m.delivered_to})` : ""}`, "success", p);
      }
    }
  }
  return processed;
}

function pendingCount() {
  const t = now();
  const running = new Set(db.campaigns.filter((c) => c.status === "running").map((c) => c.id));
  const pipeline = db.prospects.filter((p) => running.has(p.campaign_id) && (p.status === "queued" || p.status === "researching")).length;
  const due = db.messages.filter((m) => (m.status === "approved" || m.status === "scheduled") && m.scheduled_at && new Date(m.scheduled_at).getTime() - t < 30_000).length;
  return pipeline + due;
}

function approve(m: MockMessage, sendAt: string | null) {
  m.status = sendAt ? "scheduled" : "approved";
  m.scheduled_at = sendAt ?? iso(now() + 20_000);
  const p = db.prospects.find((x) => x.id === m.prospect_id);
  if (p && m.step === 0) {
    p.status = "approved";
    p.updated_at = iso(now());
  }
}

// ---------------------------------------------------------------------------------------------
// projections

function nextStep(p: MockProspect): string | null {
  const msgs = db.messages.filter((m) => m.prospect_id === p.id);
  const fmt = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  switch (p.status) {
    case "queued": return "Waiting for the worker";
    case "researching": return "Research running";
    case "needs_review": return "Review draft";
    case "insufficient_data": return "Override or rerun";
    case "no_contact": return "Add a contact";
    case "rejected_draft": return "Regenerate or edit draft";
    case "failed": return "Rerun";
    case "approved": {
      const m = msgs.find((x) => x.step === 0);
      return m?.scheduled_at ? `Sends ${fmt(m.scheduled_at)}` : "Sends in the next window";
    }
    case "sent": {
      const f = msgs.find((x) => x.step > 0 && x.status === "scheduled");
      return f?.scheduled_at ? `Follow-up ${f.step} on ${fmt(f.scheduled_at)}` : "Waiting for reply";
    }
    case "replied": return "Reply in your inbox";
    default: return null;
  }
}

function toRow(p: MockProspect): ProspectRow {
  const trail = p.stageIndex >= 3 ? buildTrail(p) : null;
  const q = trail?.qualify;
  const c = contactFor(p);
  const hasContact = c && (p.stageIndex >= 4 || ["sent", "replied", "bounced", "unsubscribed", "completed", "approved"].includes(p.status)) && q?.verdict === "qualified";
  return {
    id: p.id,
    campaign_id: p.campaign_id,
    domain: p.spec.domain,
    company_name: p.stageIndex >= 2 ? p.spec.name : null,
    status: p.status,
    stage: p.status === "researching" ? p.stage : null,
    score: q ? { min: q.score.score_min, max: q.score.score_max, expected: q.score.score_expected } : null,
    contact: hasContact && c ? { name: `${c.first} ${c.last ?? ""}`.trim(), title: c.title, email: contactEmail(p.spec, c), source: p.contactOverride ? "manual" : c.source } : null,
    next_step: nextStep(p),
    error: p.error,
    updated_at: p.updated_at,
  };
}

function toDetail(p: MockProspect): ProspectDetail {
  const row = toRow(p);
  const trail = buildTrail(p);
  const q = trail.qualify;
  let summary: string | null = null;
  if (p.status === "failed") summary = `Failed: ${p.error}`;
  else if (q) {
    const pb = playbookFor(p.campaign_id);
    const top = q.score.signals.filter((s) => s.status === "known" && s.points_min > 0).sort((a, b) => b.points_min - a.points_min)[0];
    if (q.verdict === "qualified")
      summary = `Qualified ${q.score.score_min === q.score.score_max ? q.score.score_min : `${q.score.score_min}-${q.score.score_max}`}${q.manual_override ? " (manual override)" : ""}: ${top ? top.basis.replace(/^status=/, "").replace(/_/g, " ") : "fits the rubric"}, ${pb.product.name} fits.`;
    else if (q.verdict === "disqualified") summary = `Disqualified: ${q.reason}.`;
    else summary = `Not enough evidence: score ${q.score.score_min}-${q.score.score_max}, expected ${q.score.score_expected}, after ${q.research?.fetches ?? 0} extra fetches.`;
  } else if (p.status === "queued") summary = null;
  return {
    ...row,
    summary,
    trail,
    messages: clone(db.messages.filter((m) => m.prospect_id === p.id).sort((a, b) => a.step - b.step)).map(stripMsg),
    events: db.events.filter((e) => e.prospect_id === p.id),
  };
}

function stripMsg(m: MockMessage): Message {
  return m;
}

const QUALIFIED_STATES: ProspectStatus[] = ["no_contact", "rejected_draft", "needs_review", "approved", "sent", "replied", "bounced", "unsubscribed", "completed"];
const SENT_STATES: ProspectStatus[] = ["sent", "replied", "bounced", "unsubscribed", "completed"];

function statsFor(campaignId: number): CampaignStats {
  const ps = db.prospects.filter((p) => p.campaign_id === campaignId);
  const n = (s: ProspectStatus) => ps.filter((p) => p.status === s).length;
  return {
    total: ps.length,
    queued: n("queued"),
    researching: n("researching"),
    qualified: ps.filter((p) => QUALIFIED_STATES.includes(p.status)).length,
    disqualified: n("disqualified"),
    insufficient_data: n("insufficient_data"),
    no_contact: n("no_contact"),
    needs_review: n("needs_review"),
    approved: n("approved"),
    sent: ps.filter((p) => SENT_STATES.includes(p.status)).length,
    replied: n("replied"),
    bounced: n("bounced"),
    failed: n("failed"),
  };
}

function toCampaign(c: Db["campaigns"][number]): Campaign {
  const pb = db.playbooks.find((p) => p.id === c.playbook_id);
  const { playbook_id, ...rest } = c;
  return { ...clone(rest), playbook: { id: playbook_id, name: pb?.name ?? "Deleted playbook" }, stats: statsFor(c.id) };
}

function overview(campaignId?: number): AnalyticsOverview {
  const ps = db.prospects.filter((p) => campaignId === undefined || p.campaign_id === campaignId);
  const ids = new Set(ps.map((p) => p.id));
  const msgs = db.messages.filter((m) => ids.has(m.prospect_id));
  const qualified = ps.filter((p) => QUALIFIED_STATES.includes(p.status)).length;
  const contact = ps.filter((p) => QUALIFIED_STATES.includes(p.status) && p.status !== "no_contact").length;
  const drafted = new Set(msgs.filter((m) => m.step === 0).map((m) => m.prospect_id)).size;
  const sent = ps.filter((p) => SENT_STATES.includes(p.status)).length;
  const replied = ps.filter((p) => p.status === "replied").length;
  const bounced = ps.filter((p) => p.status === "bounced").length;
  const decided = ps.filter((p) => !["queued", "researching", "failed"].includes(p.status)).length;
  const days: AnalyticsOverview["sent_by_day"] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * MIN);
    const key = d.toISOString().slice(0, 10);
    const sameDay = (s: string | null) => !!s && new Date(s).toDateString() === d.toDateString();
    days.push({
      date: key,
      sent: msgs.filter((m) => m.sent_at && sameDay(m.sent_at) && new Date(m.sent_at).getTime() <= now()).length,
      replied: ps.filter((p) => sameDay(p.replied_at)).length,
    });
  }
  const statuses: ProspectStatus[] = ["queued", "researching", "disqualified", "insufficient_data", "no_contact", "rejected_draft", "needs_review", "approved", "sent", "replied", "bounced", "unsubscribed", "completed", "failed"];
  return {
    funnel: [
      { key: "added", label: "Added", count: ps.length },
      { key: "qualified", label: "Qualified", count: qualified },
      { key: "contact_found", label: "Contact found", count: contact },
      { key: "drafted", label: "Drafted", count: drafted },
      { key: "sent", label: "Sent", count: sent },
      { key: "replied", label: "Replied", count: replied },
    ],
    outcomes: statuses.map((s) => ({ key: s, count: ps.filter((p) => p.status === s).length })),
    sent_by_day: days,
    rates: {
      qualification: decided ? qualified / decided : 0,
      contact: qualified ? contact / qualified : 0,
      reply: sent ? replied / sent : 0,
      bounce: sent ? bounced / sent : 0,
    },
    needs_review: msgs.filter((m) => m.status === "needs_review").length,
    hours_saved: Math.round(((drafted * 17.5) / 60) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------------------------
// playbook validation (mirrors what the server checks)

function validatePlaybook(b: PlaybookInput): string[] {
  const errors: string[] = [];
  if (!b.name?.trim()) errors.push("name: required");
  if (!b.product?.name?.trim()) errors.push("product.name: required");
  const claims = b.value_claims ?? [];
  if (claims.length < 1 || claims.length > 5) errors.push("value_claims: between 1 and 5 claims");
  claims.forEach((c, i) => !c.text.trim() && errors.push(`value_claims[${i}] (${c.id}): text is empty`));
  const sum = (b.icp?.signals ?? []).reduce((a, s) => a + (Number(s.weight) || 0), 0);
  if (sum !== 100) errors.push(`icp.signals: weights sum to ${sum}, must be 100`);
  const th = b.icp?.thresholds;
  if (th && th.reject_max >= th.qualify_min) errors.push("icp.thresholds: reject_max must be below qualify_min");
  if (th && (th.unknown_credit < 0 || th.unknown_credit > 1)) errors.push("icp.thresholds.unknown_credit: between 0 and 1");
  const ids = new Set<string>();
  for (const s of b.icp?.signals ?? []) {
    if (ids.has(s.id)) errors.push(`icp.signals: duplicate id ${s.id}`);
    ids.add(s.id);
  }
  const personaIds = new Set((b.personas?.personas ?? []).map((p) => p.id));
  (b.personas?.personas ?? []).forEach((p) => {
    if (!p.title_patterns.length) errors.push(`personas.${p.id}: add at least one title pattern`);
  });
  for (const band of ["small", "mid", "large"] as const)
    for (const id of b.personas?.band_order?.[band] ?? []) if (!personaIds.has(id)) errors.push(`personas.band_order.${band}: unknown persona ${id}`);
  if (b.email && b.email.min_words >= b.email.max_words) errors.push("email: min_words must be below max_words");
  return errors;
}

// ---------------------------------------------------------------------------------------------
// session

const AUTH_KEY = "oos-mock-auth";
function isAuthed() {
  try {
    return localStorage.getItem(AUTH_KEY) !== "0";
  } catch {
    return true;
  }
}
function setAuthed(v: boolean) {
  try {
    localStorage.setItem(AUTH_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function session(): Session {
  return {
    user: clone(db.user),
    workspace: { id: 1, name: db.settings.workspace_name, onboarded: db.settings.onboarded, demo_mode: db.settings.demo_mode },
  };
}

// ---------------------------------------------------------------------------------------------
// router

type Handler = (m: RegExpMatchArray, body: any, q: URLSearchParams) => unknown;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), h]);

const notFound = (what = "Not found") => new ApiError(404, what);
const bad = (detail: string, errors: string[] = []) => new ApiError(422, detail, errors);
const intParam = (m: RegExpMatchArray, k = "id") => Number(m.groups?.[k]);

function getProspect(id: number) {
  const p = db.prospects.find((x) => x.id === id);
  if (!p) throw notFound("Prospect not found");
  return p;
}
function getMessage(id: number) {
  const m = db.messages.find((x) => x.id === id);
  if (!m) throw notFound("Message not found");
  return m;
}

function parseCsv(csv: string): { rows: Record<string, string>[]; error?: string } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], error: "CSV is empty" };
  const split = (l: string) => l.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]!).map((h) => h.toLowerCase());
  if (!header.includes("domain")) return { rows: [], error: "CSV needs a domain column" };
  return {
    rows: lines.slice(1).map((l) => {
      const cells = split(l);
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    }),
  };
}

function addProspects(campaignId: number, body: { domains?: string[]; csv?: string }) {
  const rejected: { input: string; reason: string }[] = [];
  const entries: { domain: string; contact?: CompanySpec["contact"] }[] = [];
  for (const raw of body.domains ?? []) {
    if (!raw.trim()) continue;
    const d = normalizeDomain(raw);
    if (!d) rejected.push({ input: raw, reason: "not a domain" });
    else entries.push({ domain: d });
  }
  if (body.csv) {
    const parsed = parseCsv(body.csv);
    if (parsed.error) throw bad(parsed.error);
    for (const r of parsed.rows) {
      const d = normalizeDomain(r.domain ?? "");
      if (!d) {
        rejected.push({ input: r.domain || "(empty)", reason: "not a domain" });
        continue;
      }
      const contact = r.email && r.first_name
        ? { first: r.first_name, last: r.last_name || null, title: r.title || "Unknown title", email: r.email, confidence: 100, source: "manual" as const }
        : undefined;
      entries.push({ domain: d, contact });
    }
  }
  let added = 0;
  const seen = new Set(db.prospects.filter((p) => p.campaign_id === campaignId).map((p) => p.spec.domain));
  for (const e of entries) {
    if (seen.has(e.domain)) {
      rejected.push({ input: e.domain, reason: "already in this campaign" });
      continue;
    }
    if (db.suppressions.some((s) => (s.kind === "domain" && s.value === e.domain) || (s.kind === "email" && e.contact?.email === s.value))) {
      rejected.push({ input: e.domain, reason: "on the suppression list" });
      continue;
    }
    seen.add(e.domain);
    const known = COMPANY_SPECS.find((s) => s.domain === e.domain);
    const spec: CompanySpec = known ? { ...clone(known), campaign: campaignId, final: "queued" } : syntheticSpec(e.domain, campaignId, e.contact);
    if (e.contact) spec.contact = e.contact;
    const t = now();
    const p: MockProspect = {
      id: db.ids.prospect++, campaign_id: campaignId, spec, status: "queued", stage: null, stageIndex: 0,
      nextAt: t + 1500 + added * 900, contactOverride: e.contact ?? null, overridden: null, error: null,
      updated_at: iso(t), created_at: iso(t), replied_at: null,
    };
    db.prospects.push(p);
    addEvent("prospect.added", `${e.domain} added to the campaign`, "info", p);
    added++;
  }
  return { added, rejected };
}

on("GET", "/api/health", () => ({ ok: true, version: "0.9.0-mock", worker: "stopped" }));

// The dashboard drives processing (no background worker on Vercel): each tick advances the
// simulated pipeline by whatever is due and reports what is still pending.
on("POST", "/api/worker/tick", async () => {
  await sleep(500 + Math.random() * 400);
  const processed = tick();
  return { processed, pending: pendingCount() };
});

on("POST", "/api/auth/signup", (_m, b) => {
  if (!b?.email || !/.+@.+\..+/.test(b.email)) throw bad("Enter a valid email", ["email: invalid"]);
  if (!b?.password || b.password.length < 8) throw bad("Password must be at least 8 characters", ["password: at least 8 characters"]);
  if (!b?.name?.trim()) throw bad("Name is required", ["name: required"]);
  if (!b?.workspace_name?.trim()) throw bad("Workspace name is required", ["workspace_name: required"]);
  db = seed(false);
  db.user = { id: 1, email: b.email, name: b.name };
  db.settings.workspace_name = b.workspace_name;
  db.settings.sending.owner_email = b.email;
  db.settings.sending.from_name = b.name;
  db.settings.sending.from_email = "";
  db.settings.sending.provider = null;
  db.settings.integrations = {
    gemini: { configured: false, source: null, hint: null },
    hunter: { configured: false, source: null, hint: null },
    resend: { configured: false, source: null, hint: null },
    gmail: { configured: false, source: null, hint: null },
  };
  db.settings.hunter_usage.used_this_month = 0;
  db.settings.live_ready = computeLiveReady(db.settings);
  setAuthed(true);
  return session();
});
on("POST", "/api/auth/login", (_m, b) => {
  if (!b?.email || !b?.password) throw bad("Email and password are required");
  if (b.password.length < 8) throw new ApiError(401, "Wrong email or password");
  setAuthed(true);
  return session();
});
on("POST", "/api/auth/logout", () => {
  setAuthed(false);
  return { ok: true };
});
on("GET", "/api/auth/me", () => session());
on("POST", "/api/auth/guest", () => {
  setAuthed(true);
  return session();
});

// settings
on("GET", "/api/settings", () => clone(db.settings));
on("PATCH", "/api/settings", (_m, b: SettingsPatch) => {
  const s = db.settings;
  if (b.workspace_name !== undefined) {
    if (!b.workspace_name.trim()) throw bad("Workspace name is required", ["workspace_name: required"]);
    s.workspace_name = b.workspace_name;
  }
  if (b.demo_mode !== undefined) s.demo_mode = b.demo_mode;
  if (b.onboarded !== undefined) s.onboarded = b.onboarded;
  if (b.models) s.models = { ...s.models, ...b.models };
  if (b.sending) {
    const next = { ...s.sending, ...b.sending, send_window: { ...s.sending.send_window, ...(b.sending.send_window ?? {}) } };
    const errs: string[] = [];
    if (next.daily_cap < 1 || next.daily_cap > 500) errs.push("sending.daily_cap: between 1 and 500");
    if (next.send_window.start_hour >= next.send_window.end_hour) errs.push("sending.send_window: start must be before end");
    if (next.from_email && !/.+@.+\..+/.test(next.from_email)) errs.push("sending.from_email: not an email address");
    if (next.mode === "live") {
      const lr = computeLiveReady({ ...s, sending: next });
      if (!lr.ok) errs.push(`sending.mode: live mode is blocked (${lr.missing.join(", ")})`);
    }
    if (errs.length) throw bad("Some settings are invalid", errs);
    s.sending = next;
  }
  s.live_ready = computeLiveReady(s);
  return clone(s);
});
on("PUT", "/api/settings/secrets", (_m, b: SecretsBody) => {
  const s = db.settings;
  const set = (name: keyof Settings["integrations"], value: string | undefined, hint: (v: string) => string) => {
    if (value === undefined) return;
    s.integrations[name] = value ? { configured: true, source: "workspace", hint: hint(value) } : { configured: false, source: null, hint: null };
  };
  const tail = (v: string) => `…${v.slice(-4)}`;
  set("gemini", b.gemini_api_key, tail);
  set("hunter", b.hunter_api_key, tail);
  set("resend", b.resend_api_key, tail);
  if (b.gmail_user !== undefined || b.gmail_app_password !== undefined) {
    const user = b.gmail_user ?? s.integrations.gmail.hint ?? "";
    const pw = b.gmail_app_password ?? (s.integrations.gmail.configured ? "kept" : "");
    s.integrations.gmail = user && pw ? { configured: true, source: "workspace", hint: user } : { configured: false, source: null, hint: user || null };
  }
  s.live_ready = computeLiveReady(s);
  return clone(s);
});
on("POST", "/api/settings/test/:name", (m) => {
  const name = m.groups!.name as keyof Settings["integrations"];
  const i = db.settings.integrations[name];
  if (!i) throw notFound();
  if (!i.configured) return { ok: false, detail: `No ${titleCase(name)} credentials configured` };
  const detail: Record<string, string> = {
    gemini: `Gemini answered in 412 ms using ${db.settings.models.fast}`,
    hunter: `Hunter key works: ${db.settings.hunter_usage.monthly_budget - db.settings.hunter_usage.used_this_month} searches left this month`,
    gmail: `Test email sent to ${db.settings.sending.owner_email}`,
    resend: `Test email sent to ${db.settings.sending.owner_email}`,
  };
  return { ok: true, detail: detail[name] };
});

// playbooks
const summary = (p: Playbook): PlaybookSummary => ({
  id: p.id, name: p.name, product_name: p.product.name, template: p.template, version: p.version, updated_at: p.updated_at,
  campaign_count: db.campaigns.filter((c) => c.playbook_id === p.id).length,
});
on("GET", "/api/playbooks", () => db.playbooks.map(summary));
on("GET", "/api/playbooks/templates", () => [
  { key: "sprinto", name: "Sprinto", description: "Compliance automation for SOC 2, ISO 27001 and GDPR. The full rubric, personas and email rules used in the demo." },
  { key: "blank", name: "Blank", description: "Start from a minimal rubric and fill in your own product, claims and personas." },
]);
on("POST", "/api/playbooks", (_m, b) => {
  const id = db.ids.playbook++;
  const t = iso(now());
  const p = b?.template === "sprinto" ? sprintoPlaybook(id, t) : blankPlaybook(id, t);
  p.version = 1;
  if (b?.name) p.name = b.name;
  else if (b?.template === "sprinto") p.name = "Sprinto (copy from template)";
  db.playbooks.push(p);
  return clone(p);
});
on("POST", "/api/playbooks/generate", async (_m, b) => {
  const d = normalizeDomain(b?.website ?? "");
  if (!d) throw bad("Enter your company website, like yourcompany.com", ["website: not a domain"]);
  await sleep(2200);
  const id = db.ids.playbook++;
  const p = sprintoPlaybook(id, iso(now()));
  const name = titleCase(d.split(".")[0]!);
  p.name = `${name} — drafted from ${d}`;
  p.version = 1;
  p.template = null;
  p.product = { name, one_liner: `${name} helps B2B teams run their operations with less manual work`, website: `https://${d}`, problem_space: "operations" };
  p.value_claims = [
    { id: "S1", text: `${name} replaces spreadsheets for operations teams` },
    { id: "S2", text: "set up in a day with your existing tools" },
  ];
  p.research = { focus_label: "Operational tooling", focus_description: "Capture mentions of the tools and processes the company uses to run operations, with status and the exact quote." };
  p.email.sender_name = db.user.name;
  db.playbooks.push(p);
  return clone(p);
});
on("GET", "/api/playbooks/:id", (m) => {
  const p = db.playbooks.find((x) => x.id === intParam(m));
  if (!p) throw notFound("Playbook not found");
  return clone(p);
});
on("PUT", "/api/playbooks/:id", (m, b: PlaybookInput) => {
  const p = db.playbooks.find((x) => x.id === intParam(m));
  if (!p) throw notFound("Playbook not found");
  const errors = validatePlaybook(b);
  if (errors.length) throw bad("Playbook is invalid", errors);
  const next: Playbook = { ...clone(b), id: p.id, version: p.version + 1, updated_at: iso(now()) };
  db.playbooks = db.playbooks.map((x) => (x.id === p.id ? next : x));
  return clone(next);
});
on("POST", "/api/playbooks/:id/duplicate", (m) => {
  const p = db.playbooks.find((x) => x.id === intParam(m));
  if (!p) throw notFound("Playbook not found");
  const copy = { ...clone(p), id: db.ids.playbook++, name: `${p.name} (copy)`, version: 1, updated_at: iso(now()) };
  db.playbooks.push(copy);
  return clone(copy);
});
on("DELETE", "/api/playbooks/:id", (m) => {
  const id = intParam(m);
  const used = db.campaigns.filter((c) => c.playbook_id === id);
  if (used.length) throw new ApiError(409, `Used by ${used.length} campaign${used.length > 1 ? "s" : ""}: ${used.map((c) => c.name).join(", ")}`);
  db.playbooks = db.playbooks.filter((x) => x.id !== id);
  return { ok: true };
});

// campaigns
on("GET", "/api/campaigns", () => [...db.campaigns].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toCampaign));
on("POST", "/api/campaigns", (_m, b: NewCampaign) => {
  const errors: string[] = [];
  if (!b?.name?.trim()) errors.push("name: required");
  if (!db.playbooks.some((p) => p.id === b?.playbook_id)) errors.push("playbook_id: choose a playbook");
  if ((b?.followups?.length ?? 0) > 3) errors.push("followups: at most 3 steps");
  if (!b?.domains?.length && !b?.csv) errors.push("domains: add at least one domain or a CSV");
  if (errors.length) throw bad("Campaign is invalid", errors);
  const c = {
    id: db.ids.campaign++, name: b.name, status: "running" as const, playbook_id: b.playbook_id, auto_approve: !!b.auto_approve,
    hunter_live: !!b.hunter_live, followups: b.followups ?? [], created_at: iso(now()),
  };
  db.campaigns.push(c);
  const res = addProspects(c.id, { domains: b.domains, csv: b.csv });
  addEvent("campaign.created", `Campaign "${c.name}" created with ${res.added} companies`, "info", null, iso(now()), c.id);
  return toCampaign(c);
});
on("GET", "/api/campaigns/:id", (m) => {
  const c = db.campaigns.find((x) => x.id === intParam(m));
  if (!c) throw notFound("Campaign not found");
  return toCampaign(c);
});
on("PATCH", "/api/campaigns/:id", (m, b) => {
  const c = db.campaigns.find((x) => x.id === intParam(m));
  if (!c) throw notFound("Campaign not found");
  if (b.name !== undefined) c.name = b.name;
  if (b.auto_approve !== undefined) c.auto_approve = b.auto_approve;
  if (b.followups !== undefined) c.followups = b.followups;
  if (b.status !== undefined && b.status !== c.status) {
    c.status = b.status;
    addEvent(`campaign.${b.status === "paused" ? "paused" : "resumed"}`, `Campaign "${c.name}" ${b.status === "paused" ? "paused" : "resumed"}`, "info", null, iso(now()), c.id);
    if (b.status === "running") for (const p of db.prospects) if (p.campaign_id === c.id && (p.status === "queued" || p.status === "researching")) p.nextAt = now() + 1200;
  }
  return toCampaign(c);
});
on("DELETE", "/api/campaigns/:id", (m) => {
  const id = intParam(m);
  const ids = new Set(db.prospects.filter((p) => p.campaign_id === id).map((p) => p.id));
  db.campaigns = db.campaigns.filter((c) => c.id !== id);
  db.prospects = db.prospects.filter((p) => p.campaign_id !== id);
  db.messages = db.messages.filter((x) => !ids.has(x.prospect_id));
  return { ok: true };
});
on("POST", "/api/campaigns/:id/prospects", (m, b) => {
  const c = db.campaigns.find((x) => x.id === intParam(m));
  if (!c) throw notFound("Campaign not found");
  return addProspects(c.id, b ?? {});
});
on("GET", "/api/campaigns/:id/prospects", (m, _b, q) => {
  const id = intParam(m);
  const status = q.get("status");
  const term = (q.get("q") ?? "").toLowerCase();
  return db.prospects
    .filter((p) => p.campaign_id === id)
    .filter((p) => !status || p.status === status)
    .map(toRow)
    .filter((r) => !term || [r.domain, r.company_name, r.contact?.name, r.contact?.title].some((x) => x?.toLowerCase().includes(term)))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
});

// prospects
on("GET", "/api/prospects/:id", (m) => toDetail(getProspect(intParam(m))));
on("POST", "/api/prospects/:id/rerun", (m) => {
  const p = getProspect(intParam(m));
  db.messages = db.messages.filter((x) => !(x.prospect_id === p.id && ["needs_review", "rejected"].includes(x.status)));
  if (!p.spec.pagesInitial.length && p.spec.error) {
    // the second attempt works in the mock
    Object.assign(p.spec, syntheticSpec(p.spec.domain, p.campaign_id), { error: undefined });
  }
  p.status = "queued";
  p.stage = null;
  p.stageIndex = 0;
  p.error = null;
  p.nextAt = now() + 1200;
  p.updated_at = iso(now());
  addEvent("prospect.rerun", `Rerun queued for ${p.spec.domain}`, "info", p);
  return toRow(p);
});
on("POST", "/api/prospects/:id/override", (m) => {
  const p = getProspect(intParam(m));
  if (p.status !== "insufficient_data") throw new ApiError(409, "Only prospects with insufficient data can be overridden");
  p.overridden = `Manual override by ${db.user.name} on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}: continue as qualified`;
  if (!p.spec.contact) {
    const s = syntheticSpec(`${p.spec.domain}`, p.campaign_id);
    p.spec.contact = s.contact ?? { first: "Jordan", last: "Blake", title: "CTO", confidence: 90, source: "hunter" };
    p.spec.candidates = s.candidates;
    p.spec.candidatesSeen = s.candidatesSeen;
    p.spec.draft = s.draft
      ? { ...s.draft, claims: s.draft.claims.filter((c) => c.ev === "S1" || c.ev === "S2"), pains: s.draft.pains.map((x) => ({ ...x, ev: "offering" as EvKey })) }
      : undefined;
    if (p.spec.draft) p.spec.draft.core = p.spec.draft.core.replace(/saw .*? and hiring a Security Engineer\./, `saw ${p.spec.name} works with ${p.spec.offering?.toLowerCase() ?? "B2B teams"}.`);
  }
  p.status = "researching";
  p.stageIndex = 3;
  p.stage = "poc";
  p.nextAt = now() + 1000;
  p.updated_at = iso(now());
  addEvent("qualify.override", `${label(p)} overridden to qualified by ${db.user.name}`, "warning", p);
  return toRow(p);
});
on("PUT", "/api/prospects/:id/contact", (m, b) => {
  const p = getProspect(intParam(m));
  const errors: string[] = [];
  if (!b?.first_name?.trim()) errors.push("first_name: required");
  if (!b?.email || !/.+@.+\..+/.test(b.email)) errors.push("email: not an email address");
  if (!b?.title?.trim()) errors.push("title: required");
  if (errors.length) throw bad("Contact is invalid", errors);
  p.contactOverride = { first: b.first_name, last: b.last_name || null, title: b.title, email: b.email, confidence: 100, source: "manual" };
  if (!p.spec.draft) {
    const s = syntheticSpec(p.spec.domain, p.campaign_id, p.contactOverride);
    p.spec.draft = s.draft;
  }
  if (p.spec.draft) p.spec.draft.core = p.spec.draft.core.replace(/^Hi [^,]+,/, `Hi ${b.first_name},`);
  db.messages = db.messages.filter((x) => !(x.prospect_id === p.id && ["needs_review", "rejected"].includes(x.status)));
  p.status = "researching";
  p.stageIndex = 4;
  p.stage = "pain_points";
  p.nextAt = now() + 1000;
  p.updated_at = iso(now());
  addEvent("poc.manual", `Contact set manually: ${b.first_name} ${b.last_name ?? ""}, ${b.title}`, "info", p);
  return toRow(p);
});
on("DELETE", "/api/prospects/:id", (m) => {
  const id = intParam(m);
  db.prospects = db.prospects.filter((p) => p.id !== id);
  db.messages = db.messages.filter((x) => x.prospect_id !== id);
  return { ok: true };
});

// messages
on("GET", "/api/messages", (_m, _b, q) => {
  const statuses = (q.get("status") ?? "").split(",").filter(Boolean);
  const cid = q.get("campaign_id");
  return db.messages
    .filter((m) => !statuses.length || statuses.includes(m.status))
    .filter((m) => !cid || m.campaign.id === Number(cid))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .map((m) => stripMsg(clone(m)));
});
on("GET", "/api/messages/:id", (m) => stripMsg(clone(getMessage(intParam(m)))));
on("PATCH", "/api/messages/:id", (m, b) => {
  const msg = getMessage(intParam(m));
  if (!["needs_review", "rejected"].includes(msg.status)) throw new ApiError(409, "Only drafts can be edited");
  const pb = playbookFor(msg.campaign.id);
  if (b.subject !== undefined) msg.subject = b.subject;
  if (b.body !== undefined) msg.body = String(b.body);
  msg.validation = validate(pb, msg.subject, msg.body);
  msg.hook_map = msg.hook_map.filter((h) => msg.body.toLowerCase().includes(h.claim.toLowerCase()));
  return stripMsg(clone(msg));
});
on("POST", "/api/messages/:id/approve", (m, b) => {
  const msg = getMessage(intParam(m));
  if (msg.status !== "needs_review") throw new ApiError(409, "This draft is no longer waiting for review");
  if (!msg.validation.ok && !b?.force)
    throw new ApiError(409, "This draft fails validation. Fix it, or approve anyway.", msg.validation.failures);
  approve(msg, b?.send_at ?? null);
  const p = db.prospects.find((x) => x.id === msg.prospect_id);
  if (p) addEvent("message.approved", `Approved "${msg.subject}" for ${msg.to.name}`, "success", p);
  return stripMsg(clone(msg));
});
on("POST", "/api/messages/:id/reject", (m) => {
  const msg = getMessage(intParam(m));
  msg.status = "rejected";
  const p = db.prospects.find((x) => x.id === msg.prospect_id);
  if (p && msg.step === 0) {
    p.status = "rejected_draft";
    p.updated_at = iso(now());
    addEvent("draft.rejected", `Draft for ${label(p)} rejected by ${db.user.name}`, "warning", p);
  }
  return stripMsg(clone(msg));
});
on("POST", "/api/messages/:id/regenerate", async (m, b) => {
  const msg = getMessage(intParam(m));
  await sleep(1400);
  const pb = playbookFor(msg.campaign.id);
  const first = msg.to.name.split(" ")[0];
  const company = msg.company.name ?? msg.company.domain;
  const lead = msg.hook_map.find((h) => h.evidence_id.startsWith("E"));
  const instr: string = b?.instructions ?? "";
  const shorter = /short|brief|concise/i.test(instr);
  const core = shorter
    ? `Hi ${first}, ${lead ? `saw ${lead.claim} at ${company}` : `saw what ${company} is building`}. That usually means evidence chasing ahead of every customer review. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would a twenty-minute walkthrough be useful this month, or should I send a short summary instead?`
    : `Hi ${first}, ${lead ? `I read that ${company} is ${lead.claim.replace(/^(is |are )/, "")}` : `I read about ${company}`}. For a ${msg.to.title}, that often means weeks of screenshots, access reviews and questionnaires before every customer security review. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection, so the work stays done between audits. Open to a short look next week?`;
  msg.body = core;
  msg.subject = shorter ? msg.subject.split(" ").slice(0, 3).join(" ") : msg.subject;
  msg.status = "needs_review";
  msg.validation = validate(pb, msg.subject, core);
  msg.hook_map = [
    ...(lead && core.toLowerCase().includes(lead.claim.toLowerCase()) ? [lead] : []),
    { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", evidence_id: "S1", quote: pb.value_claims[0]?.text ?? "", source_url: "" },
    { claim: "continuous monitoring and audit-ready evidence collection", evidence_id: "S2", quote: pb.value_claims[1]?.text ?? "", source_url: "" },
  ];
  const p = db.prospects.find((x) => x.id === msg.prospect_id);
  if (p) {
    p.status = "needs_review";
    addEvent("draft.regenerated", `Draft regenerated${instr ? ` with instructions: "${instr}"` : ""}`, "info", p);
  }
  return stripMsg(clone(msg));
});
on("GET", "/api/wins", () => []);
on("POST", "/api/messages/:id/mark-replied", (m) => {
  const msg = getMessage(intParam(m));
  const p = db.prospects.find((x) => x.id === msg.prospect_id);
  if (p) {
    p.status = "replied";
    p.replied_at = iso(now());
    p.updated_at = p.replied_at;
    for (const f of db.messages) if (f.prospect_id === p.id && f.status === "scheduled") f.status = "cancelled";
    addEvent("message.replied", `${msg.to.name} replied (marked by ${db.user.name}); follow-ups stopped`, "success", p);
  }
  return stripMsg(clone(msg));
});
on("POST", "/api/messages/bulk-approve", (_m, b) => {
  let approved = 0;
  let skipped = 0;
  for (const id of b?.ids ?? []) {
    const msg = db.messages.find((x) => x.id === id);
    if (msg && msg.status === "needs_review" && !msg.validation.ok) skipped++;
    else if (msg && msg.status === "needs_review") {
      approve(msg, null);
      approved++;
      const p = db.prospects.find((x) => x.id === msg.prospect_id);
      if (p) addEvent("message.approved", `Approved "${msg.subject}" for ${msg.to.name}`, "success", p);
    }
  }
  return { approved, skipped };
});

// analytics and activity
on("GET", "/api/analytics/overview", (_m, _b, q) => overview(q.get("campaign_id") ? Number(q.get("campaign_id")) : undefined));
on("GET", "/api/activity", (_m, _b, q) => {
  const limit = Number(q.get("limit") ?? 50);
  const pid = q.get("prospect_id");
  return db.events.filter((e) => !pid || e.prospect_id === Number(pid)).filter((e) => new Date(e.at).getTime() <= now()).slice(0, limit);
});

// suppressions
on("GET", "/api/suppressions", () => [...db.suppressions].sort((a, b) => b.created_at.localeCompare(a.created_at)));
on("POST", "/api/suppressions", (_m, b) => {
  const v = String(b?.value ?? "").trim().toLowerCase();
  const isEmail = v.includes("@");
  const value = isEmail ? v : normalizeDomain(v);
  if (!value || (isEmail && !/.+@.+\..+/.test(v))) throw bad("Enter an email address or a domain", ["value: not an email or domain"]);
  if (db.suppressions.some((s) => s.value === value)) throw new ApiError(409, `${value} is already suppressed`);
  const s: Suppression = { id: db.ids.suppression++, value, kind: isEmail ? "email" : "domain", reason: b?.reason || "Added manually", created_at: iso(now()) };
  db.suppressions.push(s);
  return s;
});
on("DELETE", "/api/suppressions/:id", (m) => {
  db.suppressions = db.suppressions.filter((s) => s.id !== intParam(m));
  return { ok: true };
});

// ---------------------------------------------------------------------------------------------

const PUBLIC = ["/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/auth/guest", "/api/health"];

export async function mockRequest(method: string, fullPath: string, body?: unknown): Promise<unknown> {
  const url = new URL(fullPath, "http://mock.local");
  await sleep(120 + Math.random() * 220);
  if (!PUBLIC.includes(url.pathname) && !isAuthed()) throw new ApiError(401, "not_authenticated");
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = url.pathname.match(re);
    if (match) return clone(await h(match, body === undefined ? undefined : clone(body), url.searchParams));
  }
  throw notFound(`No mock route for ${method} ${url.pathname}`);
}

export function mockExportCsv(campaignId: number): string {
  const rows = db.prospects.filter((p) => p.campaign_id === campaignId).map(toRow);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["domain", "company", "status", "score_min", "score_max", "score_expected", "contact_name", "contact_title", "contact_email", "next_step", "updated_at"];
  return [
    header.join(","),
    ...rows.map((r) => [r.domain, r.company_name, r.status, r.score?.min, r.score?.max, r.score?.expected, r.contact?.name, r.contact?.title, r.contact?.email, r.next_step, r.updated_at].map(esc).join(",")),
  ].join("\n");
}

db = seed(true);
