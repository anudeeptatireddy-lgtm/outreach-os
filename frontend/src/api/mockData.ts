// Seed data for the in-memory mock (VITE_MOCK=1). Fictional companies and people.
// The Sprinto rubric mirrors config/icp.toml (icp.2), with `compliance_mentions` renamed `focus_mentions`.
import type { FocusStatus, Playbook, ProspectStatus, Rubric } from "./types";

export type PageKind = "home" | "about" | "careers" | "security" | "pricing" | "customers";

export const SPRINTO_RUBRIC: Rubric = {
  version: "icp.2",
  description: "Sprinto ICP: B2B software companies about to need SOC 2 / ISO 27001 / GDPR evidence",
  thresholds: { qualify_min: 60, reject_max: 45, reference_year: 2026, unknown_credit: 0.5, qualify_expected: 55 },
  gates: [
    { id: "G1_b2b", label: "Sells to businesses (not a consumer product)", field: "is_b2b", fail_values: [false] },
    { id: "G3_size_ceiling", label: "Under 1001 employees", field: "headcount", fail_values: ["1001+"] },
  ],
  signals: [
    {
      id: "b2b_software", label: "B2B product", group: "A", weight: 10, kind: "map", field: "is_b2b",
      target_kinds: ["home", "pricing", "about"], points: { true: 10, false: 0 },
    },
    {
      id: "funding_stage", label: "Funding stage", group: "A", weight: 5, kind: "map", field: "stage",
      target_kinds: ["about"],
      points: { series_a: 5, series_b: 5, series_c: 5, seed: 4, bootstrapped: 3, pre_seed: 2, series_d_or_later: 1, public: 1 },
    },
    {
      id: "headcount_band", label: "Headcount band", group: "A", weight: 5, kind: "map", field: "headcount",
      target_kinds: ["about", "careers"],
      points: { "51-200": 5, "11-50": 4, "201-500": 3, "501-1000": 2, "1-10": 1, "1001+": 0 },
    },
    {
      id: "compliance_pursuit", label: "Pursuing a compliance framework", group: "B", weight: 30, kind: "best",
      field: "focus_mentions", attribute: "status", observed_on: ["security"], target_kinds: ["security"],
      points: { in_progress: 30, planned: 30, mentioned: 12, certified: 7 },
    },
    {
      id: "enterprise_customers", label: "Named enterprise customers", group: "B", weight: 20, kind: "count",
      field: "enterprise_customers", tiers: [[3, 20], [2, 13], [1, 7]], observed_on: ["customers"], target_kinds: ["customers"],
    },
    {
      id: "security_hiring", label: "Hiring for security, compliance or infrastructure", group: "B", weight: 20,
      kind: "keyword", field: "hiring_signals", attribute: "role", observed_on: ["careers"], target_kinds: ["careers"],
      keyword_groups: [
        { points: 20, keywords: ["security", "compliance", "grc", "risk", "privacy", "trust", "governance", "ciso", "infosec"] },
        { points: 7, keywords: ["devops", "sre", "site reliability", "infrastructure", "platform", "it"] },
      ],
    },
    {
      id: "regulated_vertical", label: "Regulated or compliance-heavy vertical", group: "C", weight: 10,
      kind: "text_keyword", field: "offering",
      keywords: [
        "fintech", "finance", "financial", "payment", "payments", "payroll", "accounts payable",
        "banking", "lending", "insurance", "health", "healthcare", "medical", "clinical",
        "hr", "human resources", "legal", "government",
      ],
      target_kinds: ["home", "about"], points: { match: 10 },
    },
  ],
  penalties: [
    { id: "P1_mature_soc2_type2_and_iso27001", label: "Already certified SOC 2 Type II and ISO 27001", points: 30, requires: ["soc2typeii", "iso27001"] },
    { id: "P2_soc2_type2_only", label: "Already certified SOC 2 Type II", points: 15, requires: ["soc2typeii"], excludes: ["iso27001"] },
  ],
};

export function sprintoPlaybook(id: number, now: string): Playbook {
  return {
    id,
    name: "Sprinto — SOC 2 & ISO 27001 seekers",
    version: 4,
    updated_at: now,
    template: "sprinto",
    product: {
      name: "Sprinto",
      one_liner: "Compliance automation for SOC 2, ISO 27001 and GDPR",
      website: "https://sprinto.com",
      problem_space: "compliance",
    },
    value_claims: [
      { id: "S1", text: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR" },
      { id: "S2", text: "continuous monitoring and audit-ready evidence collection" },
    ],
    research: {
      focus_label: "Compliance frameworks",
      focus_description:
        "Capture every mention of SOC 2 (Type I or II), ISO 27001, GDPR, HIPAA or PCI DSS with its status: certified, in_progress, planned or mentioned. Quote the exact sentence and keep the page URL. A trust-centre badge alone counts as certified.",
    },
    icp: structuredClone(SPRINTO_RUBRIC),
    personas: {
      personas: [
        {
          id: "security_lead", label: "Security lead",
          title_patterns: ["ciso", "chief information security officer", "head of security", "vp security", "security director"],
          pains: [
            "Customers keep asking for proof of security posture through questionnaires and trust requests.",
            "Screenshot-based evidence and spreadsheet tracking let controls drift between audits.",
          ],
          role_link: "a security lead owns posture and evidence",
        },
        {
          id: "compliance", label: "Compliance / GRC lead",
          title_patterns: ["grc", "compliance", "governance"],
          pains: [
            "The same controls get re-mapped across SOC 2, ISO 27001 and GDPR.",
            "Audit prep turns into sprints dominated by evidence chasing.",
          ],
          role_link: "a compliance lead owns control mapping and audits",
        },
        {
          id: "cofounder_cto", label: "Technical co-founder",
          title_patterns: ["co-founder & cto", "technical co-founder", "cto and co-founder"],
          pains: [
            "Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
            "A months-long observation window needs controls to hold continuously, with auditor back-and-forth.",
          ],
          role_link: "an engineering leader owns roadmap time",
        },
        {
          id: "cto", label: "CTO",
          title_patterns: ["cto", "chief technology officer", "chief technical officer"],
          pains: [
            "Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
            "A months-long observation window needs controls to hold continuously, with auditor back-and-forth.",
          ],
          role_link: "an engineering leader owns roadmap time",
        },
        {
          id: "eng_lead", label: "Engineering lead",
          title_patterns: ["vp engineering", "head of engineering", "director of engineering", "engineering director"],
          pains: [
            "Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.",
            "A months-long observation window needs controls to hold continuously, with auditor back-and-forth.",
          ],
          role_link: "an engineering leader owns roadmap time",
        },
        {
          id: "ceo_founder", label: "CEO / founder",
          title_patterns: ["ceo", "chief executive", "founder", "co-founder", "president"],
          pains: [
            "Enterprise deals can stall at the security review when buyers ask for a SOC 2 report.",
            "Founder time goes to security questionnaires and chasing evidence instead of selling.",
          ],
          role_link: "a founder or executive owns deal speed",
        },
        {
          id: "it_lead", label: "IT lead",
          title_patterns: ["head of it", "it director", "it manager", "vp information technology"],
          pains: [
            "Onboarding, offboarding and device evidence is scattered across tools and teams.",
            "Access reviews and policy acknowledgements need constant chasing.",
          ],
          role_link: "an IT lead owns access and device controls",
        },
        {
          id: "coo", label: "Operations lead",
          title_patterns: ["coo", "chief operating officer", "head of operations", "vp operations"],
          pains: [
            "Enterprise deals can stall at the security review when buyers ask for a SOC 2 report.",
            "Founder time goes to security questionnaires and chasing evidence instead of selling.",
          ],
          role_link: "a founder or executive owns deal speed",
        },
        {
          id: "sec_eng", label: "Security engineer",
          title_patterns: ["security engineer", "security manager", "senior security", "staff security"],
          pains: [
            "Customers keep asking for proof of security posture through questionnaires and trust requests.",
            "Screenshot-based evidence and spreadsheet tracking let controls drift between audits.",
          ],
          role_link: "a security lead owns posture and evidence",
        },
      ],
      band_order: {
        small: ["security_lead", "cofounder_cto", "cto", "ceo_founder", "eng_lead", "coo", "it_lead", "compliance"],
        mid: ["security_lead", "eng_lead", "it_lead", "compliance", "cofounder_cto", "cto", "coo", "ceo_founder"],
        large: ["security_lead", "compliance", "it_lead", "eng_lead", "cto", "cofounder_cto", "sec_eng"],
      },
      exclude_title_keywords: [
        "sales", "marketing", "hr", "human resources", "recruit", "talent", "people", "customer success",
        "support", "finance", "cfo", "intern", "advisor", "board", "revenue", "growth",
        "business development", "partnership", "account executive", "brand", "content", "legal", "counsel", "design",
      ],
    },
    email: {
      min_words: 50,
      max_words: 90,
      tone: "Plain and specific, peer to peer. One observation from their own site, one pain it implies for this person, one product line, one soft question. No hype, no flattery.",
      extra_banned_phrases: ["game-changer", "synergy", "touch base", "circle back"],
      sender_name: "Priya Raman",
      sender_title: "Account Executive",
      followup_angles: [
        "Bump with a single useful fact: how long a typical SOC 2 observation window takes.",
        "Close the loop politely and offer a one-page checklist instead of a call.",
      ],
    },
  };
}

export function blankPlaybook(id: number, now: string, name = "Untitled playbook"): Playbook {
  return {
    id,
    name,
    version: 1,
    updated_at: now,
    template: "blank",
    product: { name: "", one_liner: "", website: "", problem_space: "" },
    value_claims: [{ id: "S1", text: "" }],
    research: { focus_label: "", focus_description: "" },
    icp: {
      version: "v1",
      description: "",
      thresholds: { qualify_min: 60, reject_max: 45, reference_year: 2026, unknown_credit: 0.5, qualify_expected: 55 },
      gates: [{ id: "G1_b2b", label: "Sells to businesses", field: "is_b2b", fail_values: [false] }],
      signals: [
        { id: "b2b_software", label: "B2B product", group: "A", weight: 40, kind: "map", field: "is_b2b", points: { true: 40, false: 0 }, target_kinds: ["home"] },
        { id: "headcount_band", label: "Headcount band", group: "A", weight: 60, kind: "map", field: "headcount",
          points: { "51-200": 60, "11-50": 45, "201-500": 40, "501-1000": 20, "1-10": 10, "1001+": 0 }, target_kinds: ["about"] },
      ],
      penalties: [],
    },
    personas: {
      personas: [
        { id: "ceo_founder", label: "CEO / founder", title_patterns: ["ceo", "founder"], pains: ["", ""], role_link: "" },
      ],
      band_order: { small: ["ceo_founder"], mid: ["ceo_founder"], large: ["ceo_founder"] },
      exclude_title_keywords: ["intern", "advisor"],
    },
    email: {
      min_words: 50, max_words: 90, tone: "", extra_banned_phrases: [], sender_name: "", sender_title: "", followup_angles: [],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Company specs: compact descriptions the mock engine turns into full decision trails.

export type FactSpec = { quote: string; page: PageKind };

export type EvKey = `focus:${number}` | `hiring:${number}` | "customers" | "headcount" | "offering" | "S1" | "S2";

export type DraftSpec = {
  subject: string;
  core: string; // greeting + body, without footer
  pains: { pain: string; role_link: string; ev: EvKey }[];
  claims: { claim: string; ev: EvKey }[];
  validation?: { ok: boolean; failures: string[]; attempts: number };
  pains_source?: string;
};

export type MessageSpec = {
  status: "needs_review" | "approved" | "scheduled" | "sent" | "rejected" | "failed" | "bounced";
  sentMinutesAgo?: number;
  scheduledInMinutes?: number;
  replied?: boolean;
  followup?: { status: "scheduled" | "sent" | "cancelled"; inMinutes: number; subject: string; core: string };
  error?: string;
};

export type CompanySpec = {
  domain: string;
  name: string | null;
  campaign: number;
  addedMinutesAgo: number;
  offering: string | null;
  offeringQuote?: FactSpec;
  is_b2b: boolean | null;
  b2bQuote?: FactSpec;
  stage?: { value: string; as_of?: string | null } & FactSpec;
  headcount?: { value: string } & FactSpec;
  focus?: ({ framework: string; status: FocusStatus; as_of?: string | null } & FactSpec)[];
  hiring?: ({ role: string } & FactSpec)[];
  customers?: ({ name: string } & FactSpec)[];
  pagesInitial: PageKind[];
  pagesFailed?: { path: string; kind: PageKind | null; status: string; reason: string }[];
  research?: { kind: PageKind; path?: string; reason: string; outcome?: "fetched" | "unavailable" }[];
  dropped?: { field: string; quote: string; page: PageKind; reason: string }[];
  contact?: { first: string; last: string | null; title: string; email?: string; confidence: number; source: "hunter" | "manual" | "sample" };
  candidates?: { first: string | null; last: string | null; position: string | null; category: string | null; score: number; eligible: boolean; notes: string[] }[];
  candidatesSeen?: number;
  risks?: string[];
  noContactReason?: string;
  draft?: DraftSpec;
  message?: MessageSpec;
  final: ProspectStatus;
  error?: string;
  /** stage the prospect is in when final is "researching" */
  stage_now?: "scrape" | "extract" | "qualify" | "poc" | "pain_points" | "draft";
};

export const CAMPAIGN_SEEDS = [
  {
    id: 1,
    name: "Fintech & HR SaaS — November",
    status: "running" as const,
    playbook_id: 1,
    auto_approve: false,
    hunter_live: true,
    followups: [{ delay_days: 3 }, { delay_days: 5 }],
    createdDaysAgo: 6,
  },
  {
    id: 2,
    name: "Devtools pilot",
    status: "paused" as const,
    playbook_id: 1,
    auto_approve: false,
    hunter_live: true,
    followups: [{ delay_days: 4 }],
    createdDaysAgo: 16,
  },
];

const H = 60;
const D = 24 * 60;

export const COMPANY_SPECS: CompanySpec[] = [
  // ---------------- Campaign 1 ----------------
  {
    domain: "kestrelpay.com", name: "Kestrel Pay", campaign: 1, addedMinutesAgo: 2 * D + 3 * H,
    offering: "B2B payments platform that helps credit unions reconcile transfers",
    offeringQuote: { quote: "Kestrel Pay helps credit unions reconcile every transfer in real time", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Kestrel Pay is a B2B payments platform for credit unions and community banks", page: "home" },
    stage: { value: "series_b", as_of: "2026-03", quote: "We raised a $38M Series B led by Northgate Ventures", page: "about" },
    headcount: { value: "201-500", quote: "a team of about 300 people across Austin and Dublin", page: "about" },
    focus: [
      { framework: "ISO 27001", status: "planned", as_of: "2026", quote: "We plan to certify against ISO 27001 this year", page: "security" },
      { framework: "SOC 2 Type I", status: "certified", as_of: "2025", quote: "Kestrel Pay holds a SOC 2 Type I report", page: "security" },
    ],
    hiring: [{ role: "Head of Security", quote: "We are hiring a Head of Security to own our security programme", page: "careers" }],
    customers: [
      { name: "Fairmont Credit Union", quote: "Trusted by Fairmont Credit Union, Tidewater Bank and Granite State Savings", page: "customers" },
      { name: "Tidewater Bank", quote: "Trusted by Fairmont Credit Union, Tidewater Bank and Granite State Savings", page: "customers" },
      { name: "Granite State Savings", quote: "Trusted by Fairmont Credit Union, Tidewater Bank and Granite State Savings", page: "customers" },
    ],
    pagesInitial: ["home", "about", "pricing"],
    pagesFailed: [{ path: "/trust", kind: "security", status: "unavailable", reason: "blocked_by_robots" }],
    research: [
      { kind: "security", path: "/security", reason: "compliance_pursuit is unknown and worth 30 points; the footer links a Security page", outcome: "fetched" },
      { kind: "customers", path: "/customers", reason: "enterprise_customers is unknown (20 points); a Customers page is linked from the nav", outcome: "fetched" },
      { kind: "careers", path: "/careers", reason: "security_hiring is unknown (20 points); the careers page may list security roles", outcome: "fetched" },
    ],
    dropped: [
      { field: "enterprise_customers", quote: "Join 400+ financial institutions", page: "home", reason: "not a named customer" },
    ],
    contact: { first: "Elena", last: "Varga", title: "CISO", confidence: 96, source: "hunter" },
    candidates: [
      { first: "Elena", last: "Varga", position: "CISO", category: "security_lead", score: 77, eligible: true, notes: ["security_lead rank 1 of 7 for the large band", "verified valid"] },
      { first: "Tomás", last: "Reyes", position: "Director of Engineering", category: "eng_lead", score: 40, eligible: true, notes: ["eng_lead rank 4 of 7 for the large band", "verified valid"] },
      { first: "Hannah", last: "Ostrowski", position: "VP Marketing", category: null, score: 0, eligible: false, notes: ["excluded title keyword: marketing"] },
    ],
    candidatesSeen: 11,
    draft: {
      subject: "iso 27001 this year",
      core:
        "Hi Elena, saw Kestrel Pay plans to certify against ISO 27001 this year and is hiring a Head of Security. With Tidewater Bank and other credit unions as customers, that usually means security reviews asking for proof long before the audit. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would it help to see how other payments teams run that?",
      pains: [
        { pain: "Bank customers ask for proof of ISO 27001 progress during their security reviews.", role_link: "a CISO owns security posture and proof to customers", ev: "focus:0" },
        { pain: "A new Head of Security inherits evidence collection across every team.", role_link: "a CISO owns the compliance programme", ev: "hiring:0" },
      ],
      claims: [
        { claim: "plans to certify against ISO 27001 this year", ev: "focus:0" },
        { claim: "hiring a Head of Security", ev: "hiring:0" },
        { claim: "Tidewater Bank and other credit unions as customers", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "needs_review" },
    final: "needs_review",
  },
  {
    domain: "tallyledger.io", name: "Tally Ledger", campaign: 1, addedMinutesAgo: 2 * D + 3 * H,
    offering: "Accounts payable automation for mid-market finance teams",
    offeringQuote: { quote: "Tally Ledger automates accounts payable for finance teams", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Tally Ledger is a B2B SaaS platform for finance teams", page: "home" },
    headcount: { value: "51-200", quote: "We are a team of about 80 people", page: "about" },
    focus: [{ framework: "SOC 2 Type II", status: "in_progress", as_of: "2026", quote: "We are working toward SOC 2 Type II certification", page: "security" }],
    hiring: [{ role: "Security Engineer", quote: "We are hiring a Security Engineer to own our compliance programme", page: "careers" }],
    customers: [
      { name: "Contoso Freight", quote: "Finance teams at Contoso Freight and Larkspur Hotels close faster with Tally", page: "customers" },
      { name: "Larkspur Hotels", quote: "Finance teams at Contoso Freight and Larkspur Hotels close faster with Tally", page: "customers" },
    ],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: { first: "Daniel", last: "Okafor", title: "VP Engineering", confidence: 92, source: "hunter" },
    candidates: [
      { first: "Daniel", last: "Okafor", position: "VP Engineering", category: "eng_lead", score: 64, eligible: true, notes: ["eng_lead rank 2 of 8 for the mid band", "verified valid"] },
      { first: "Grace", last: "Lindholm", position: "CEO & Co-founder", category: "ceo_founder", score: 22, eligible: true, notes: ["ceo_founder rank 8 of 8 for the mid band", "verified valid"] },
    ],
    candidatesSeen: 6,
    risks: ["No security lead on file; the Security Engineer role is still open"],
    draft: {
      subject: "your soc 2 type ii timeline",
      core:
        "Hi Daniel, I saw Tally Ledger is working toward SOC 2 Type II and is hiring a Security Engineer to own the programme. Until that hire lands, evidence collection, access reviews and policy work usually fall on engineering, right when finance customers like Contoso Freight want the report. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection, so the observation window does not eat the roadmap. Worth a short walkthrough next week? It would take about twenty minutes and I can tailor it to your stack.",
      pains: [
        { pain: "Engineering roadmap time gets pulled into evidence collection and access reviews.", role_link: "a VP Engineering owns roadmap time", ev: "focus:0" },
        { pain: "The open security role leaves the SOC 2 programme without an owner.", role_link: "a VP Engineering covers the gap until the hire", ev: "hiring:0" },
      ],
      claims: [
        { claim: "working toward SOC 2 Type II", ev: "focus:0" },
        { claim: "hiring a Security Engineer", ev: "hiring:0" },
        { claim: "finance customers like Contoso Freight", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 2 },
    },
    message: { status: "needs_review" },
    final: "needs_review",
  },
  {
    domain: "harborhr.io", name: "Harbor HR", campaign: 1, addedMinutesAgo: 1 * D + 20 * H / 2,
    offering: "HR and payroll software for multi-site employers",
    offeringQuote: { quote: "Harbor HR runs payroll and people operations for multi-site employers", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Built for HR teams at companies with 50 to 5,000 employees", page: "home" },
    stage: { value: "series_a", as_of: "2025-09", quote: "Harbor HR closed its Series A in September 2025", page: "about" },
    headcount: { value: "51-200", quote: "Our 120-person team works from Toronto and Lisbon", page: "about" },
    focus: [
      { framework: "SOC 2 Type II", status: "in_progress", as_of: "2026", quote: "Our SOC 2 Type II audit window opens in January", page: "security" },
      { framework: "GDPR", status: "mentioned", as_of: null, quote: "We process EU employee data in line with GDPR", page: "security" },
    ],
    hiring: [{ role: "GRC Analyst", quote: "Open role: GRC Analyst, Toronto", page: "careers" }],
    customers: [{ name: "Northlake Clinics", quote: "Northlake Clinics runs payroll for 40 sites on Harbor", page: "customers" }],
    pagesInitial: ["home", "about", "security", "careers", "customers", "pricing"],
    contact: { first: "Sofia", last: "Lindqvist", title: "Head of Security", confidence: 88, source: "hunter" },
    candidates: [
      { first: "Sofia", last: "Lindqvist", position: "Head of Security", category: "security_lead", score: 71, eligible: true, notes: ["security_lead rank 1 of 8 for the mid band", "accept_all, confidence >= 80"] },
      { first: "Marcus", last: "Bell", position: "CTO", category: "cto", score: 38, eligible: true, notes: ["cto rank 6 of 8 for the mid band", "verified valid"] },
      { first: "Ines", last: "Carvalho", position: "Head of People", category: null, score: 0, eligible: false, notes: ["excluded title keyword: people"] },
    ],
    candidatesSeen: 9,
    risks: ["Email is accept_all; delivery is likely but not verified"],
    draft: {
      subject: "soc 2 window in january",
      core:
        "Hi Sofia, read that Harbor HR's SOC 2 Type II audit window opens in January and that you are hiring a GRC Analyst. Running payroll for employers like Northlake Clinics means a long observation window where controls have to hold every day. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Open to comparing notes before January?",
      pains: [
        { pain: "Controls have to hold continuously through a months-long observation window.", role_link: "a security lead owns posture and evidence", ev: "focus:0" },
        { pain: "A new GRC hire spends the first months mapping controls instead of improving them.", role_link: "a security lead owns the compliance programme", ev: "hiring:0" },
      ],
      claims: [
        { claim: "SOC 2 Type II audit window opens in January", ev: "focus:0" },
        { claim: "hiring a GRC Analyst", ev: "hiring:0" },
        { claim: "employers like Northlake Clinics", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "needs_review" },
    final: "needs_review",
  },
  {
    domain: "quillhealth.com", name: "Quill Health", campaign: 1, addedMinutesAgo: 3 * D,
    offering: "Clinical documentation software for outpatient clinics",
    offeringQuote: { quote: "Quill Health turns clinical visits into structured notes for outpatient clinics", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Quill Health sells to clinic groups and health systems", page: "home" },
    stage: { value: "seed", as_of: "2025", quote: "backed by a seed round from Hollis Health Fund", page: "about" },
    headcount: { value: "11-50", quote: "We are 34 people", page: "about" },
    focus: [{ framework: "HIPAA", status: "mentioned", quote: "Quill Health is built for HIPAA-covered entities", page: "security" }, { framework: "SOC 2 Type II", status: "planned", quote: "SOC 2 Type II is on our 2026 roadmap", page: "security" }],
    hiring: [{ role: "DevOps Engineer", quote: "Hiring: DevOps Engineer (remote, US)", page: "careers" }],
    customers: [],
    pagesInitial: ["home", "about", "security", "careers"],
    contact: { first: "Arjun", last: "Desai", title: "Co-founder & CTO", confidence: 97, source: "hunter" },
    candidates: [{ first: "Arjun", last: "Desai", position: "Co-founder & CTO", category: "cofounder_cto", score: 69, eligible: true, notes: ["cofounder_cto rank 2 of 8 for the small band", "verified valid"] }],
    candidatesSeen: 4,
    draft: {
      subject: "soc 2 on the 2026 roadmap",
      core:
        "Hi Arjun, noticed SOC 2 Type II is on Quill Health's 2026 roadmap and that you are hiring a DevOps Engineer. For a technical founder that usually means the audit lands on engineering time while clinic groups wait on security reviews. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would a short look before you start the audit be useful?",
      pains: [
        { pain: "Engineering roadmap time gets pulled into evidence collection, access reviews and policy writing.", role_link: "a co-founder CTO owns roadmap time", ev: "focus:1" },
        { pain: "A new DevOps hire inherits audit evidence on top of infrastructure work.", role_link: "a CTO owns infrastructure and its controls", ev: "hiring:0" },
      ],
      claims: [
        { claim: "SOC 2 Type II is on Quill Health's 2026 roadmap", ev: "focus:1" },
        { claim: "hiring a DevOps Engineer", ev: "hiring:0" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "scheduled", scheduledInMinutes: 14 * H + 25 },
    final: "approved",
  },
  {
    domain: "orbitpayroll.com", name: "Orbit Payroll", campaign: 1, addedMinutesAgo: 5 * D,
    offering: "Global payroll and contractor payments for remote teams",
    offeringQuote: { quote: "Orbit Payroll pays employees and contractors in 90 countries", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Orbit Payroll is built for finance and people teams at remote-first companies", page: "home" },
    headcount: { value: "51-200", quote: "a 150-person team spread across 14 countries", page: "about" },
    focus: [{ framework: "ISO 27001", status: "in_progress", quote: "Our ISO 27001 certification is in progress", page: "security" }],
    hiring: [{ role: "Compliance Manager", quote: "We're looking for a Compliance Manager", page: "careers" }],
    customers: [
      { name: "Bramble Studios", quote: "Bramble Studios, Polaris Freight and Wexley Labs run payroll on Orbit", page: "customers" },
      { name: "Polaris Freight", quote: "Bramble Studios, Polaris Freight and Wexley Labs run payroll on Orbit", page: "customers" },
      { name: "Wexley Labs", quote: "Bramble Studios, Polaris Freight and Wexley Labs run payroll on Orbit", page: "customers" },
    ],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: { first: "Noah", last: "Feldman", title: "Head of Engineering", confidence: 94, source: "hunter" },
    candidates: [{ first: "Noah", last: "Feldman", position: "Head of Engineering", category: "eng_lead", score: 63, eligible: true, notes: ["eng_lead rank 2 of 8 for the mid band", "verified valid"] }],
    candidatesSeen: 7,
    draft: {
      subject: "iso 27001 in progress",
      core:
        "Hi Noah, saw Orbit Payroll's ISO 27001 certification is in progress and that you are looking for a Compliance Manager. Paying people in 90 countries usually means every new customer security review asks for the same evidence again. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Is that worth twenty minutes this month?",
      pains: [
        { pain: "Each customer security review asks for the same evidence in a new format.", role_link: "an engineering leader owns the systems the evidence comes from", ev: "focus:0" },
        { pain: "Until the Compliance Manager starts, audit prep runs on engineering time.", role_link: "an engineering leader owns roadmap time", ev: "hiring:0" },
      ],
      claims: [
        { claim: "ISO 27001 certification is in progress", ev: "focus:0" },
        { claim: "looking for a Compliance Manager", ev: "hiring:0" },
        { claim: "Paying people in 90 countries", ev: "offering" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: {
      status: "sent", sentMinutesAgo: 2 * D + 2 * H,
      followup: { status: "scheduled", inMinutes: 1 * D - 2 * H, subject: "re: iso 27001 in progress", core: "Hi Noah, one more note on this. Teams that run the ISO 27001 audit alongside customer reviews usually spend most of the prep on collecting the same evidence twice. Happy to share how others handle it, or I can leave it here." },
    },
    final: "sent",
  },
  {
    domain: "cobaltclaims.com", name: "Cobalt Claims", campaign: 1, addedMinutesAgo: 6 * D,
    offering: "Claims automation for commercial insurance carriers",
    offeringQuote: { quote: "Cobalt automates claims intake for commercial insurance carriers", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Cobalt Claims works with carriers, MGAs and brokers", page: "home" },
    stage: { value: "series_a", quote: "after our Series A in 2025", page: "about" },
    headcount: { value: "51-200", quote: "Cobalt is a team of 70", page: "about" },
    focus: [{ framework: "SOC 2 Type II", status: "in_progress", quote: "We are completing our SOC 2 Type II audit", page: "security" }],
    hiring: [{ role: "Information Security Lead", quote: "Information Security Lead — New York", page: "careers" }],
    customers: [
      { name: "Sentinel Mutual", quote: "Carriers like Sentinel Mutual and Ironbridge Insurance", page: "customers" },
      { name: "Ironbridge Insurance", quote: "Carriers like Sentinel Mutual and Ironbridge Insurance", page: "customers" },
    ],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: { first: "Leah", last: "Marston", title: "CTO", confidence: 95, source: "hunter" },
    candidates: [{ first: "Leah", last: "Marston", position: "CTO", category: "cto", score: 52, eligible: true, notes: ["cto rank 6 of 8 for the mid band", "verified valid"] }],
    candidatesSeen: 5,
    draft: {
      subject: "soc 2 type ii for carriers",
      core:
        "Hi Leah, saw Cobalt is completing its SOC 2 Type II audit and hiring an Information Security Lead. Carriers like Sentinel Mutual tend to ask for that report and a questionnaire on top, which lands on engineering until the new lead is in. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would a short walkthrough help?",
      pains: [
        { pain: "Carrier security reviews ask for the report and a questionnaire on top.", role_link: "a CTO owns the answers engineering has to give", ev: "customers" },
        { pain: "The open security lead role leaves audit work on engineering.", role_link: "a CTO owns roadmap time", ev: "hiring:0" },
      ],
      claims: [
        { claim: "completing its SOC 2 Type II audit", ev: "focus:0" },
        { claim: "hiring an Information Security Lead", ev: "hiring:0" },
        { claim: "Carriers like Sentinel Mutual", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "sent", sentMinutesAgo: 4 * D + 5 * H, replied: true },
    final: "replied",
  },
  {
    domain: "lumenlegal.com", name: "Lumen Legal", campaign: 1, addedMinutesAgo: 6 * D,
    offering: "Contract review software for in-house legal teams",
    offeringQuote: { quote: "Lumen helps in-house legal teams review contracts faster", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Lumen is used by legal teams at growing companies", page: "home" },
    headcount: { value: "11-50", quote: "We're a team of 28", page: "about" },
    focus: [{ framework: "SOC 2 Type I", status: "in_progress", quote: "Our SOC 2 Type I report is underway", page: "security" }],
    hiring: [],
    customers: [{ name: "Harlow & Finch", quote: "Harlow & Finch's legal team cut review time in half", page: "customers" }],
    pagesInitial: ["home", "about", "security", "customers", "careers"],
    contact: { first: "Owen", last: "Pryce", title: "CEO", confidence: 71, source: "hunter" },
    candidates: [{ first: "Owen", last: "Pryce", position: "CEO", category: "ceo_founder", score: 24, eligible: true, notes: ["ceo_founder rank 4 of 8 for the small band", "low confidence or unverified (risk)"] }],
    candidatesSeen: 3,
    risks: ["Hunter confidence 71 and unverified; the address may bounce"],
    draft: {
      subject: "soc 2 type i underway",
      core:
        "Hi Owen, saw Lumen's SOC 2 Type I report is underway. For a founder-led team of 28, that usually means security questionnaires from legal teams like Harlow & Finch land on your desk while the audit is still open. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Worth a look before Type II?",
      pains: [
        { pain: "Founder time goes to security questionnaires instead of selling.", role_link: "a founder owns deal speed", ev: "focus:0" },
        { pain: "Enterprise legal buyers ask for the SOC 2 report before signing.", role_link: "a founder owns deal speed", ev: "customers" },
      ],
      claims: [
        { claim: "SOC 2 Type I report is underway", ev: "focus:0" },
        { claim: "team of 28", ev: "headcount" },
        { claim: "legal teams like Harlow & Finch", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "bounced", sentMinutesAgo: 4 * D + 2 * H, error: "550 5.1.1 The email account that you tried to reach does not exist" },
    final: "bounced",
  },
  {
    domain: "pocketpals.app", name: "Pocket Pals", campaign: 1, addedMinutesAgo: 2 * D,
    offering: "Mobile game for kids and families",
    offeringQuote: { quote: "Pocket Pals is a mobile game for kids and families", page: "home" },
    is_b2b: false, b2bQuote: { quote: "Pocket Pals is a mobile game for kids and families", page: "home" },
    pagesInitial: ["home", "about"],
    pagesFailed: [{ path: "/careers", kind: "careers", status: "unavailable", reason: "http_404" }],
    final: "disqualified",
  },
  {
    domain: "vantagegrid.com", name: "Vantage Grid", campaign: 1, addedMinutesAgo: 2 * D,
    offering: "Energy analytics for commercial buildings",
    offeringQuote: { quote: "Vantage Grid shows facility teams where their buildings waste energy", page: "home" },
    is_b2b: true, b2bQuote: { quote: "for facility managers and property owners", page: "home" },
    focus: [],
    pagesInitial: ["home", "pricing"],
    pagesFailed: [
      { path: "/about", kind: "about", status: "ok", reason: "too_short" },
      { path: "/security", kind: "security", status: "unavailable", reason: "http_403" },
    ],
    research: [
      { kind: "security", path: "/trust", reason: "compliance_pursuit is unknown (30 points); /trust is linked from the footer", outcome: "unavailable" },
      { kind: "customers", path: "/case-studies", reason: "enterprise_customers is unknown (20 points); a case studies page is linked", outcome: "unavailable" },
      { kind: "careers", path: "/jobs", reason: "security_hiring is unknown (20 points)", outcome: "unavailable" },
    ],
    final: "insufficient_data",
  },
  {
    domain: "ferrolabs.dev", name: "Ferro Labs", campaign: 1, addedMinutesAgo: 1 * D + 4 * H,
    offering: "Data pipeline platform for fintech engineering teams",
    offeringQuote: { quote: "Ferro Labs moves financial data between ledgers, banks and warehouses", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Ferro Labs is infrastructure for fintech engineering teams", page: "home" },
    headcount: { value: "11-50", quote: "We're 22 engineers and operators", page: "about" },
    focus: [{ framework: "SOC 2 Type II", status: "planned", quote: "SOC 2 Type II is planned for Q2", page: "security" }],
    hiring: [{ role: "Platform Engineer", quote: "Platform Engineer, Berlin", page: "careers" }],
    customers: [{ name: "Brightline Bank", quote: "Brightline Bank streams its ledger through Ferro", page: "customers" }],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    candidates: [
      { first: "Jonas", last: "Weber", position: "Head of Sales", category: null, score: 0, eligible: false, notes: ["excluded title keyword: sales"] },
      { first: null, last: null, position: null, category: null, score: 0, eligible: false, notes: ["generic address (info@)"] },
    ],
    candidatesSeen: 2,
    noContactReason: "Hunter returned no suitable named person for this company",
    final: "no_contact",
  },
  {
    domain: "parcelstack.io", name: "Parcelstack", campaign: 1, addedMinutesAgo: 8,
    offering: "Shipping and returns software for B2B wholesalers",
    offeringQuote: { quote: "Parcelstack handles shipping and returns for wholesalers", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Parcelstack is built for B2B wholesalers", page: "home" },
    headcount: { value: "51-200", quote: "Parcelstack has grown to 90 people", page: "about" },
    focus: [{ framework: "SOC 2 Type II", status: "in_progress", quote: "We are in our SOC 2 Type II observation period", page: "security" }],
    hiring: [{ role: "Security Engineer", quote: "Senior Security Engineer (remote)", page: "careers" }],
    customers: [{ name: "Hollow Oak Supply", quote: "Hollow Oak Supply ships 2,000 orders a day with Parcelstack", page: "customers" }],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: { first: "Ravi", last: "Kulkarni", title: "Head of Security", confidence: 93, source: "hunter" },
    candidates: [{ first: "Ravi", last: "Kulkarni", position: "Head of Security", category: "security_lead", score: 74, eligible: true, notes: ["security_lead rank 1 of 8 for the mid band", "verified valid"] }],
    candidatesSeen: 5,
    draft: {
      subject: "soc 2 observation period",
      core:
        "Hi Ravi, saw Parcelstack is in its SOC 2 Type II observation period and hiring a Senior Security Engineer. That stretch is where controls drift if evidence still lives in screenshots and spreadsheets, and wholesalers like Hollow Oak Supply will ask for the report the day it lands. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Worth comparing notes?",
      pains: [
        { pain: "Screenshot-based evidence lets controls drift during the observation period.", role_link: "a security lead owns posture and evidence", ev: "focus:0" },
        { pain: "Customers ask for the SOC 2 report as soon as it exists.", role_link: "a security lead owns proof to customers", ev: "customers" },
      ],
      claims: [
        { claim: "in its SOC 2 Type II observation period", ev: "focus:0" },
        { claim: "hiring a Senior Security Engineer", ev: "hiring:0" },
        { claim: "wholesalers like Hollow Oak Supply", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "needs_review" },
    final: "researching",
    stage_now: "extract",
  },
  {
    domain: "mintcircuit.dev", name: "Mint Circuit", campaign: 1, addedMinutesAgo: 2,
    offering: "Embedded lending APIs for vertical SaaS platforms",
    offeringQuote: { quote: "Mint Circuit adds lending to any vertical SaaS platform through one API", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Mint Circuit sells to software platforms, not consumers", page: "home" },
    headcount: { value: "11-50", quote: "We're a 40-person team in Chicago", page: "about" },
    focus: [{ framework: "SOC 2 Type II", status: "planned", quote: "We expect to begin our SOC 2 Type II audit next quarter", page: "security" }],
    hiring: [{ role: "Compliance Lead", quote: "Compliance Lead (lending), Chicago", page: "careers" }],
    customers: [],
    pagesInitial: ["home", "about", "security", "careers"],
    contact: { first: "Camille", last: "Durand", title: "Co-founder & CTO", confidence: 98, source: "hunter" },
    candidates: [{ first: "Camille", last: "Durand", position: "Co-founder & CTO", category: "cofounder_cto", score: 70, eligible: true, notes: ["cofounder_cto rank 2 of 8 for the small band", "verified valid"] }],
    candidatesSeen: 4,
    draft: {
      subject: "soc 2 audit next quarter",
      core:
        "Hi Camille, read that Mint Circuit expects to begin its SOC 2 Type II audit next quarter and is hiring a Compliance Lead. Lending APIs sold to software platforms usually face a security review in every deal, and until the new lead starts, that work sits with engineering. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would a short walkthrough before the audit help?",
      pains: [
        { pain: "Every platform deal brings a security review before the audit exists.", role_link: "a co-founder CTO owns deal-blocking technical questions", ev: "focus:0" },
        { pain: "The compliance work sits with engineering until the new lead starts.", role_link: "a CTO owns roadmap time", ev: "hiring:0" },
      ],
      claims: [
        { claim: "begin its SOC 2 Type II audit next quarter", ev: "focus:0" },
        { claim: "hiring a Compliance Lead", ev: "hiring:0" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "needs_review" },
    final: "queued",
  },

  // ---------------- Campaign 2 ----------------
  {
    domain: "brightforms.io", name: "Brightforms", campaign: 2, addedMinutesAgo: 15 * D,
    offering: "Form builder for banking and insurance onboarding",
    offeringQuote: { quote: "Brightforms builds onboarding forms for banking and insurance teams", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Brightforms is used by onboarding teams at banks and insurers", page: "home" },
    headcount: { value: "11-50", quote: "We are 25 people", page: "about" },
    focus: [{ framework: "SOC 2 Type II", status: "planned", quote: "SOC 2 Type II is planned for next year", page: "security" }],
    hiring: [],
    customers: [{ name: "Riverstone Insurance", quote: "Riverstone Insurance onboards customers with Brightforms", page: "customers" }],
    pagesInitial: ["home", "about", "security", "customers", "careers"],
    contact: { first: "Mei", last: "Tanaka", title: "CTO", confidence: 90, source: "hunter" },
    candidates: [{ first: "Mei", last: "Tanaka", position: "CTO", category: "cto", score: 58, eligible: true, notes: ["cto rank 3 of 8 for the small band", "verified valid"] }],
    candidatesSeen: 3,
    draft: {
      subject: "soc 2 type ii next year",
      core:
        "Hi Mei, saw SOC 2 Type II is planned for next year at Brightforms. Selling onboarding to insurers like Riverstone Insurance usually means the security review arrives before the report does, and engineering answers it by hand. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Would it help to see how that works before you start?",
      pains: [
        { pain: "Security reviews arrive before the report does.", role_link: "a CTO owns the technical answers", ev: "customers" },
        { pain: "Engineering time goes to audit prep instead of product.", role_link: "a CTO owns roadmap time", ev: "focus:0" },
      ],
      claims: [
        { claim: "SOC 2 Type II is planned for next year", ev: "focus:0" },
        { claim: "insurers like Riverstone Insurance", ev: "customers" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "sent", sentMinutesAgo: 13 * D, followup: { status: "sent", inMinutes: -9 * D, subject: "re: soc 2 type ii next year", core: "Hi Mei, closing the loop on this. If SOC 2 moves up the list, I can send a one-page checklist of what the audit asks for. Otherwise I will leave it here." } },
    final: "completed",
  },
  {
    domain: "signalforge.dev", name: "Signalforge", campaign: 2, addedMinutesAgo: 14 * D,
    offering: "Observability for event-driven backends",
    offeringQuote: { quote: "Signalforge traces every event through your backend", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Signalforge is built for platform teams", page: "home" },
    headcount: { value: "11-50", quote: "We are 18 people", page: "about" },
    focus: [{ framework: "SOC 2", status: "mentioned", quote: "Questions about SOC 2? Contact us", page: "security" }],
    hiring: [{ role: "Security Engineer", quote: "Security Engineer (EU remote)", page: "careers" }],
    customers: [{ name: "Corvid Analytics", quote: "Corvid Analytics runs Signalforge in production", page: "customers" }, { name: "Patchwork Retail", quote: "and Patchwork Retail", page: "customers" }, { name: "Morrow Mobility", quote: "Morrow Mobility moved from logs to traces with Signalforge", page: "customers" }],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: { first: "Pieter", last: "de Vries", title: "CEO & Founder", confidence: 91, source: "hunter" },
    candidates: [{ first: "Pieter", last: "de Vries", position: "CEO & Founder", category: "ceo_founder", score: 33, eligible: true, notes: ["ceo_founder rank 4 of 8 for the small band", "verified valid"] }],
    candidatesSeen: 2,
    draft: {
      subject: "soc 2 questions",
      core:
        "Hi Pieter, Signalforge already serves 3,000 engineering teams and SOC 2 questions keep coming up. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR in weeks. Want to chat?",
      pains: [
        { pain: "Enterprise deals can stall at the security review when buyers ask for a SOC 2 report.", role_link: "a founder owns deal speed", ev: "focus:0" },
        { pain: "Founder time goes to security questionnaires and chasing evidence instead of selling.", role_link: "a founder owns deal speed", ev: "customers" },
      ],
      pains_source: "library (llm pain points failed validation)",
      claims: [
        { claim: "SOC 2 questions keep coming up", ev: "focus:0" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
      ],
      validation: {
        ok: false,
        failures: [
          "Unsupported claim: \"serves 3,000 engineering teams\" has no evidence on the company's pages",
          "Unsupported product claim: \"in weeks\" is not one of the playbook's value claims",
          "Body is 31 words; the playbook allows 50 to 90",
        ],
        attempts: 2,
      },
    },
    message: { status: "rejected" },
    final: "rejected_draft",
  },
  {
    domain: "relaybase.io", name: null, campaign: 2, addedMinutesAgo: 14 * D,
    offering: null, is_b2b: null,
    pagesInitial: [],
    pagesFailed: [{ path: "/", kind: "home", status: "error", reason: "timeout after 3 attempts" }],
    final: "failed",
    error: "Timed out fetching https://relaybase.io/ after 3 attempts",
  },
  {
    domain: "dockyard.dev", name: "Dockyard", campaign: 2, addedMinutesAgo: 15 * D,
    offering: "Preview environments for every pull request",
    offeringQuote: { quote: "Dockyard spins up a preview environment for every pull request", page: "home" },
    is_b2b: true, b2bQuote: { quote: "Dockyard is used by engineering teams at 600 companies", page: "home" },
    stage: { value: "seed", quote: "Dockyard raised a seed round in 2025", page: "about" },
    headcount: { value: "11-50", quote: "We're 31 people", page: "about" },
    focus: [{ framework: "SOC 2 Type I", status: "in_progress", quote: "Our SOC 2 Type I audit is in progress", page: "security" }],
    hiring: [{ role: "Infrastructure Engineer", quote: "Infrastructure Engineer — remote", page: "careers" }],
    customers: [{ name: "Fernhill Software", quote: "Fernhill Software ships faster with Dockyard", page: "customers" }],
    pagesInitial: ["home", "about", "security", "careers", "customers"],
    contact: { first: "Sam", last: "Achterberg", title: "VP Engineering", confidence: 89, source: "hunter" },
    candidates: [{ first: "Sam", last: "Achterberg", position: "VP Engineering", category: "eng_lead", score: 41, eligible: true, notes: ["eng_lead rank 5 of 8 for the small band", "verified valid"] }],
    candidatesSeen: 3,
    draft: {
      subject: "soc 2 type i in progress",
      core:
        "Hi Sam, saw Dockyard's SOC 2 Type I audit is in progress and that you are hiring an Infrastructure Engineer. Preview environments for every pull request mean a lot of short-lived infrastructure for an auditor to reason about. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR, with continuous monitoring and audit-ready evidence collection. Worth a short look before Type II?",
      pains: [
        { pain: "Short-lived infrastructure is hard to evidence for an auditor.", role_link: "an engineering leader owns those systems", ev: "offering" },
        { pain: "Audit prep pulls engineers off the roadmap.", role_link: "an engineering leader owns roadmap time", ev: "focus:0" },
      ],
      claims: [
        { claim: "SOC 2 Type I audit is in progress", ev: "focus:0" },
        { claim: "hiring an Infrastructure Engineer", ev: "hiring:0" },
        { claim: "Preview environments for every pull request", ev: "offering" },
        { claim: "Sprinto automates compliance for SOC 2, ISO 27001 and GDPR", ev: "S1" },
        { claim: "continuous monitoring and audit-ready evidence collection", ev: "S2" },
      ],
      validation: { ok: true, failures: [], attempts: 1 },
    },
    message: { status: "sent", sentMinutesAgo: 12 * D },
    final: "unsubscribed",
  },
  {
    domain: "nimbusci.dev", name: "Nimbus CI", campaign: 2, addedMinutesAgo: 3 * D,
    offering: null, is_b2b: null,
    pagesInitial: [],
    final: "queued",
  },
];

// Extra historical prospects for the paused campaign so the 14-day chart has honest history.
export const HISTORY: { domain: string; name: string; persona: [string, string, string]; framework: string; status: FocusStatus; sentDaysAgo: number; outcome: "sent" | "replied" | "completed" | "disqualified" }[] = [
  { domain: "lanternlogs.dev", name: "Lantern Logs", persona: ["Yusuf", "Aydin", "CTO"], framework: "SOC 2 Type II", status: "planned", sentDaysAgo: 13, outcome: "completed" },
  { domain: "graphkeep.io", name: "Graphkeep", persona: ["Rosa", "Mendel", "Head of Security"], framework: "ISO 27001", status: "in_progress", sentDaysAgo: 12, outcome: "replied" },
  { domain: "tidepool.dev", name: "Tidepool", persona: ["Kofi", "Mensah", "VP Engineering"], framework: "SOC 2 Type II", status: "in_progress", sentDaysAgo: 11, outcome: "completed" },
  { domain: "quarryapi.com", name: "Quarry API", persona: ["Ana", "Petrov", "Co-founder & CTO"], framework: "SOC 2 Type I", status: "planned", sentDaysAgo: 10, outcome: "completed" },
  { domain: "beaconflags.io", name: "Beacon Flags", persona: ["Liam", "O'Neill", "CEO"], framework: "SOC 2 Type II", status: "in_progress", sentDaysAgo: 10, outcome: "replied" },
  { domain: "sparrowdb.dev", name: "SparrowDB", persona: ["Hiro", "Sato", "Head of Engineering"], framework: "SOC 2 Type II", status: "planned", sentDaysAgo: 9, outcome: "completed" },
  { domain: "kitebuild.io", name: "Kitebuild", persona: ["Nadia", "Haddad", "CISO"], framework: "ISO 27001", status: "planned", sentDaysAgo: 8, outcome: "sent" },
  { domain: "folioqueue.com", name: "Folioqueue", persona: ["Erik", "Lund", "CTO"], framework: "SOC 2 Type II", status: "in_progress", sentDaysAgo: 7, outcome: "sent" },
  { domain: "pixelcrate.app", name: "Pixelcrate", persona: ["", "", ""], framework: "", status: "mentioned", sentDaysAgo: 0, outcome: "disqualified" },
  { domain: "hexgate.dev", name: "Hexgate", persona: ["Zara", "Qureshi", "VP Engineering"], framework: "SOC 2 Type II", status: "in_progress", sentDaysAgo: 6, outcome: "sent" },
];

/** Demo-mode sample domains that together show every outcome (also offered in onboarding). */
export const DEMO_DOMAINS = [
  "ledgerloop.io", "payrollpilot.com", "claimsbridge.ai", "fieldnote.dev",
  "pocketpals.app", "globalbank-cloud.com", "stealthco.xyz", "quietops.io",
];

export const SUPPRESSION_SEEDS = [
  { value: "dockyard.dev", kind: "domain" as const, reason: "Unsubscribed (one-click)", daysAgo: 11 },
  { value: "owen@lumenlegal.com", kind: "email" as const, reason: "Hard bounce: 550 5.1.1", daysAgo: 4 },
  { value: "competitor-watch.com", kind: "domain" as const, reason: "Added manually: existing customer", daysAgo: 20 },
];
