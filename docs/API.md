# outreach-os HTTP API (v1 contract)

The FastAPI backend serves this API under `/api` and the built dashboard (`frontend/dist`) at `/`.
Auth is a session cookie (`oos_session`, HttpOnly, SameSite=Lax) set by signup/login. Every
`/api/*` route except `/api/auth/*`, `/api/health` and `/api/webhooks/*` needs it and answers
`401 {"detail": "not_authenticated"}` without it. All data is scoped to the caller's workspace.

Errors: `4xx/5xx` with `{"detail": string}`; validation errors are `422 {"detail": string, "errors": string[]}`.
Times are ISO-8601 UTC strings. IDs are integers.

The types below are the wire format (TypeScript notation).

## Enums

```ts
type ProspectStatus =
  | "queued"            // waiting for the worker
  | "researching"       // scrape/extract/qualify/poc/draft running; see `stage`
  | "disqualified"      // failed a gate or scored below reject_max
  | "insufficient_data" // gray band after research; can be overridden
  | "no_contact"        // qualified, but no suitable person found; can set one manually
  | "rejected_draft"    // the validator refused both drafts; can regenerate or edit
  | "needs_review"      // a draft is waiting in the review queue
  | "approved"          // approved, waiting for its send time
  | "sent"              // first email sent (follow-ups may be pending)
  | "replied" | "bounced" | "unsubscribed"
  | "completed"         // sequence finished with no reply
  | "failed";           // an error; `error` says why; can rerun

type Stage = "scrape" | "extract" | "qualify" | "poc" | "pain_points" | "draft" | "send";

type MessageStatus =
  | "needs_review" | "approved" | "scheduled" | "sending" | "sent"
  | "rejected" | "failed" | "bounced" | "cancelled";

type SendingMode = "test" | "live";
// test: every email goes to the workspace owner_email, subject prefixed "[TEST -> Name <email>]".
// live: emails go to the real contact. Requires provider configured, from_email, physical_address.
type Provider = "gmail" | "resend";
```

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/signup` | `{email, password, name, workspace_name}` | `Session` |
| POST | `/api/auth/login` | `{email, password}` | `Session` |
| POST | `/api/auth/logout` | - | `{ok: true}` |
| GET | `/api/auth/me` | - | `Session` or 401 |
| POST | `/api/auth/guest` | - | `Session` (no sign-in: returns this browser's workspace, creating a private guest workspace on first visit; the dashboard calls it when `/me` is 401) |

```ts
type Session = {
  user: { id: number; email: string; name: string };
  workspace: { id: number; name: string; onboarded: boolean; demo_mode: boolean };
};
```
Password: at least 8 characters. Signup creates the workspace and seeds the Sprinto playbook.

## Health

`GET /api/health` -> `{ok: true, version: string, worker: "running" | "stopped"}`

## Worker

Serverless hosts have no background thread, so the open dashboard drives processing:

- `POST /api/worker/tick` (body `{}`) -> `{processed: number, pending: number}`. Runs queued work for
  the caller's workspace (one pipeline stage, one send or one follow-up draft per unit) for up to
  ~20 s. Call again while `pending > 0`; otherwise every ~15 s.
- `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` does the same for every workspace
  (Vercel Cron or any scheduler).

## Settings

`GET /api/settings` -> `Settings`; `PATCH /api/settings` with any subset of the editable fields
(`workspace_name`, `sending`, `models`, `demo_mode`, `onboarded`) -> `Settings`.

```ts
type Settings = {
  workspace_name: string;
  demo_mode: boolean;          // true: pipeline uses built-in sample data, no keys, no network, nothing sent
  onboarded: boolean;
  sending: {
    mode: SendingMode;
    provider: Provider | null;
    from_name: string;
    from_email: string;        // gmail: the Gmail address; resend: an address on a verified domain
    reply_to: string;
    owner_email: string;       // test-mode recipient
    physical_address: string;  // required in live mode (CAN-SPAM)
    daily_cap: number;         // max emails per day, default 30
    send_window: { start_hour: number; end_hour: number; timezone: string; weekdays_only: boolean };
  };
  models: { smart: string; fast: string };
  integrations: {
    gemini: Integration; hunter: Integration; resend: Integration; gmail: Integration;
  };
  hunter_usage: { monthly_budget: number; used_this_month: number };
  live_ready: { ok: boolean; missing: string[] };  // what blocks live mode
  webhook_url: string;                             // paste into Resend > Webhooks
};
type Integration = { configured: boolean; source: "workspace" | "env" | null; hint: string | null }; // hint e.g. "…a1b2" or the gmail user
```

`PUT /api/settings/secrets` body (any subset; empty string clears):
`{gemini_api_key?, hunter_api_key?, resend_api_key?, gmail_user?, gmail_app_password?, resend_webhook_secret?}` -> `Settings`.
Secrets are encrypted at rest and never returned.

`POST /api/settings/test/{gemini|hunter|resend|gmail}` -> `{ok: boolean, detail: string}`
(gmail/resend send one test email to `owner_email`).

## Playbooks

A playbook is everything that makes the pipeline specific to one product: what you sell, the
claims an email may make, the ICP rubric, who to contact and the email rules.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/playbooks` | - | `PlaybookSummary[]` |
| GET | `/api/playbooks/templates` | - | `{key, name, description}[]` (`sprinto`, `blank`) |
| POST | `/api/playbooks` | `{template: "sprinto" \| "blank", name?}` | `Playbook` |
| POST | `/api/playbooks/generate` | `{website: string}` | `Playbook` (AI-drafted from your own site; demo mode returns a sample) |
| GET | `/api/playbooks/{id}` | - | `Playbook` |
| PUT | `/api/playbooks/{id}` | `Playbook` (without id/version/updated_at) | `Playbook` or 422 with `errors` |
| POST | `/api/playbooks/{id}/duplicate` | - | `Playbook` |
| DELETE | `/api/playbooks/{id}` | - | `{ok: true}` (409 if a campaign uses it) |

```ts
type PlaybookSummary = { id: number; name: string; product_name: string; template: string | null;
  version: number; updated_at: string; campaign_count: number };

type Playbook = {
  id: number; name: string; version: number; updated_at: string; template: string | null;
  product: {
    name: string;            // "Sprinto"
    one_liner: string;       // "Compliance automation for SOC 2, ISO 27001 and GDPR"
    website: string;
    problem_space: string;   // "compliance" -> drives pain-point prompts
  };
  value_claims: { id: string; text: string }[];   // S1..S5; the ONLY product claims an email may make
  research: {
    focus_label: string;        // "Compliance frameworks" (what CompanyProfile.focus mentions capture)
    focus_description: string;  // instructions for extraction, e.g. "SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS..."
  };
  icp: Rubric;                  // see below; validated server side (weights sum to 100 etc.)
  personas: {
    personas: { id: string; label: string; title_patterns: string[]; pains: [string, string]; role_link: string }[];
    band_order: { small: string[]; mid: string[]; large: string[] };   // persona ids, best first
    exclude_title_keywords: string[];
  };
  email: {
    min_words: number; max_words: number;      // 50..90 for Sprinto
    tone: string;                              // free text guidance
    extra_banned_phrases: string[];
    sender_name: string; sender_title: string;
    followup_angles: string[];                 // one per follow-up step
  };
};

type Rubric = {
  version: string; description: string;
  thresholds: { qualify_min: number; reject_max: number; reference_year: number;
                unknown_credit: number; qualify_expected: number };
  gates: { id: string; label: string; field: string; fail_values: unknown[] }[];
  signals: {
    id: string; label: string; group: string; weight: number;
    kind: "map" | "best" | "count" | "keyword" | "year_recency" | "text_keyword";
    field: string; attribute?: string | null;
    points?: Record<string, number>; tiers?: [number, number][];
    keyword_groups?: { points: number; keywords: string[] }[]; keywords?: string[];
    observed_on?: string[]; target_kinds?: string[];
  }[];
  penalties: { id: string; label: string; points: number; requires: string[]; excludes?: string[] }[];
};
```
Profile fields a rubric may read: `is_b2b, stage, headcount, offering, focus_mentions,
hiring_signals, enterprise_customers`. Page kinds: `home, about, careers, security, pricing, customers`.

## Campaigns

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/campaigns` | - | `Campaign[]` |
| POST | `/api/campaigns` | `NewCampaign` | `Campaign` |
| GET | `/api/campaigns/{id}` | - | `Campaign` |
| PATCH | `/api/campaigns/{id}` | `{name?, status?: "running" \| "paused", auto_approve?, followups?}` | `Campaign` |
| DELETE | `/api/campaigns/{id}` | - | `{ok: true}` |
| POST | `/api/campaigns/{id}/prospects` | `{domains?: string[], csv?: string}` | `{added: number, rejected: {input: string, reason: string}[]}` |
| GET | `/api/campaigns/{id}/export.csv` | - | CSV file |

```ts
type NewCampaign = {
  name: string; playbook_id: number;
  domains?: string[];           // one per entry, any of "acme.com", "https://www.acme.com/x"
  csv?: string;                 // header row; columns: domain (required), first_name, last_name, email, title
  auto_approve: boolean;        // true: drafts that pass validation skip the review queue
  followups: { delay_days: number }[];   // 0-3 follow-up steps after the first email
  hunter_live: boolean;         // false: no Hunter search; contacts come from the CSV or are added by hand
};

type Campaign = {
  id: number; name: string; status: "running" | "paused" | "completed";
  playbook: { id: number; name: string };
  auto_approve: boolean; hunter_live: boolean; followups: { delay_days: number }[];
  created_at: string;
  stats: CampaignStats;
};
type CampaignStats = {
  total: number; queued: number; researching: number; qualified: number; disqualified: number;
  insufficient_data: number; no_contact: number; needs_review: number; approved: number;
  sent: number; replied: number; bounced: number; failed: number;
};
```
CSV rows that include a contact skip the Hunter search and use that person (manual PoC).

## Prospects

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/campaigns/{id}/prospects?status=&q=` | - | `ProspectRow[]` |
| GET | `/api/prospects/{id}` | - | `ProspectDetail` |
| POST | `/api/prospects/{id}/rerun` | `{}` | `ProspectRow` (re-queued from the start; caches make it cheap) |
| POST | `/api/prospects/{id}/override` | `{}` | `ProspectRow` (insufficient_data -> continue as qualified, logged as manual override) |
| PUT | `/api/prospects/{id}/contact` | `{first_name, last_name?, email, title}` | `ProspectRow` (manual PoC, then drafts) |
| DELETE | `/api/prospects/{id}` | - | `{ok: true}` |

```ts
type ProspectRow = {
  id: number; campaign_id: number; domain: string; company_name: string | null;
  status: ProspectStatus; stage: Stage | null;
  score: { min: number; max: number; expected: number | null } | null;
  contact: { name: string; title: string; email: string; source: "hunter" | "manual" | "sample" } | null;
  next_step: string | null;      // human readable: "Review draft", "Follow-up 1 on Nov 24", ...
  error: string | null;
  updated_at: string;
};

type ProspectDetail = ProspectRow & {
  summary: string | null;        // one-line plain-English verdict, e.g. "Qualified 68-80: pursuing SOC 2 ..."
  trail: {                       // raw engine outputs, present once the stage ran (null otherwise)
    scrape: { pages: { url: string; status: string; kind: string | null; chars: number; reason: string | null }[];
              usable: number; kinds_found: string[] } | null;
    extract: { profile: CompanyProfile; evidence_total: number; evidence_kept: number;
               evidence_dropped: { field: string; quote: string; source_url: string; reason: string }[];
               injection_suspected_pages: string[] } | null;
    qualify: Qualification | null;
    poc: { contact: {...}; band: "small" | "mid" | "large"; band_basis: string; reason: string;
           top_candidates: { first_name: string | null; last_name: string | null; position: string | null;
                             category: string | null; score: number; eligible: boolean; notes: string[] }[];
           candidates_seen: number; risks: string[] } | null;
    draft: { pain_points: { pain: string; role_link: string; evidence_id: string }[];
             pain_points_source: string;
             evidence_pack: { id: string; kind: string; fact: string; quote: string; source_url: string }[];
             hook_map: { claim: string; evidence_id: string; quote: string; source_url: string }[];
             validation: { ok: boolean; failures: string[]; attempts: number } | null } | null;
  };
  messages: Message[];
  events: Event[];
};
// CompanyProfile: { name, offering, is_b2b, stage, headcount: {value, quote, source_url} | null;
//   focus_mentions: {framework, status, as_of, quote, source_url}[];
//   hiring_signals: {role, quote, source_url}[]; enterprise_customers: {name, quote, source_url}[] }
// Qualification: { verdict, initial_verdict, reason, rubric_version, thresholds,
//   score: { signals: {id,label,group,weight,status:"known"|"unknown",points_min,points_max,basis,evidence:{quote,source_url}[]}[],
//            gates: {id,label,status:"pass"|"fail"|"unknown",basis}[], penalties: {id,label,points}[],
//            score_min, score_max, score_expected, unknown_signals: string[] },
//   research: { stop_reason, iterations, fetches, steps: {iteration,tool,url,reason,outcome,resolved_signals,score_min,score_max}[] } | null,
//   manual_override?: string | null }
```

## Messages (review queue and sent mail)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/messages?status=&campaign_id=` | - | `Message[]` (newest first) |
| GET | `/api/messages/{id}` | - | `Message` |
| PATCH | `/api/messages/{id}` | `{subject?, body?}` | `Message` (re-validated; failures become warnings, editing is allowed) |
| POST | `/api/messages/{id}/approve` | `{send_at?: string \| null, force?: boolean}` | `Message` (null: next slot in the send window; 409 `{detail, errors}` when validation fails and `force` is not true) |
| POST | `/api/messages/{id}/reject` | `{}` | `Message` |
| POST | `/api/messages/{id}/regenerate` | `{instructions?: string}` | `Message` |
| POST | `/api/messages/{id}/mark-replied` | `{}` | `Message` (stops the sequence) |
| POST | `/api/messages/bulk-approve` | `{ids: number[]}` | `{approved: number, skipped: number}` (skips drafts that fail validation) |

```ts
type Message = {
  id: number; prospect_id: number; campaign: { id: number; name: string };
  company: { domain: string; name: string | null };
  step: number;                         // 0 first email, 1.. follow-ups
  to: { name: string; email: string; title: string };
  delivered_to: string | null;          // actual recipient (owner_email in test mode)
  subject: string;
  body: string;                         // the editable body only
  footer: string;                       // read-only: sender identity, postal address, unsubscribe line
  status: MessageStatus;
  validation: { ok: boolean; failures: string[] };
  hook_map: { claim: string; evidence_id: string; quote: string; source_url: string }[];
  pain_points: { pain: string; role_link: string; evidence_id: string }[];
  scheduled_at: string | null; sent_at: string | null; provider_id: string | null;
  error: string | null; created_at: string; mode: SendingMode | "demo" | null;
};
```

## Analytics and activity

`GET /api/analytics/overview?campaign_id=` ->
```ts
{
  funnel: { key: string; label: string; count: number }[];   // added, qualified, contact_found, drafted, sent, replied
  outcomes: { key: ProspectStatus; count: number }[];
  sent_by_day: { date: string; sent: number; replied: number }[];  // last 14 days
  rates: { qualification: number; contact: number; reply: number; bounce: number }; // 0..1
  needs_review: number;
  hours_saved: number;          // drafted emails x 17.5 min / 60 (the brief's 15-20 min/company)
}
```
`GET /api/activity?limit=50&prospect_id=` -> `Event[]`
```ts
type Event = { id: number; at: string; kind: string; message: string;
               prospect_id: number | null; campaign_id: number | null; level: "info" | "success" | "warning" | "error" };
```

## Suppression list

`GET /api/suppressions` -> `{id, value, kind: "email" | "domain", reason, created_at}[]`;
`POST /api/suppressions {value, reason?}`; `DELETE /api/suppressions/{id}`.
Unsubscribes, bounces and complaints are added automatically.

## Public (no auth)

- `GET /u/{token}` unsubscribe confirmation page; `POST /u/{token}` (also RFC 8058 one-click).
- `POST /api/webhooks/resend/{workspace_id}` (Svix-signed with the workspace's webhook secret)
  updates delivery, bounce and complaint status.

Mutating `/api/*` requests must send `Content-Type: application/json` (a CSRF guard alongside the
SameSite cookie).
