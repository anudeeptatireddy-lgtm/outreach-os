# Outreach OS

**Cold outreach you can defend.** Outreach OS is an AI SDR for B2B teams. Give it a list of
company domains and it reads each company's website, scores it against your ideal customer
profile, finds the right decision-maker, works out their two most likely pain points and writes a
short, personal email whose every claim is quoted from the company's own pages. You review,
edit and approve; it sends from your Gmail or Resend, follows up in the same thread and stops the
moment someone replies or unsubscribes.

Every decision is logged and shown in the app: **why this company** (each scoring signal with
the quote that earned it), **why this person** (the ranked candidates and the rule that picked
them) and **why this email** (each sentence mapped to its evidence).

It works for any B2B product through *playbooks*, and ships with a tuned **Sprinto** playbook
(compliance automation for SOC 2, ISO 27001 and GDPR).

## Try the live build

**https://outreach-os-self.vercel.app**: no sign-in. Each browser gets its own private
workspace, so nothing you do is visible to anyone else. About 10 minutes end to end.

**1. Demo run (sample data, about 2 minutes)**
1. Click **Try the demo**. The workspace opens in demo mode with the Sprinto playbook.
2. **Campaigns → New campaign**. Paste these sample domains and click **Create and start research**:
   ```
   ledgerloop.io
   payrollpilot.com
   claimsbridge.ai
   fieldnote.dev
   pocketpals.app
   globalbank-cloud.com
   stealthco.xyz
   quietops.io
   ```
   They cover every outcome: qualified, disqualified (a consumer app, an already-certified
   bank), not enough data, and qualified with no contact.
3. Open any company to read its **decision trail**: the pages read, each fact with its quote,
   the score breakdown, why this person, and which evidence backs each sentence of the email.
4. **Review**: edit a draft, then approve it. Try adding an unsupported claim such as "we are
   the fastest in the market". The validator blocks approval until it is removed. Approved
   emails show under **Sent** as "demo, not sent".

**2. Real companies (live research with Gemini)**
1. **Settings → Demo mode**: switch it off.
2. Create a campaign with real domains, for example `openstatus.dev`. The app reads the live
   website, scores it against the rubric and drafts from what it found. Most well-known
   companies are disqualified because they already hold SOC 2; that is the rubric working.
3. Contacts come from Hunter, whose free plan runs out each month. When it does, the company
   shows **Add a contact**. Enter any name, title and email to see the draft written.

**3. Sending**
- Approved emails go out in **test mode**: to the site owner's inbox, with the real recipient
  shown in the subject. Nothing is ever sent to a prospect from this site.
- To receive the test emails yourself, add your own Resend key (or Gmail address and app
  password) in **Settings → Integrations** and set your address in **Settings → Sending**.

**Limits on this site**: on the site's own keys, real research is capped at 10 companies per
workspace and 40 site-wide per day, and the shared email account sends at most 50 test emails a
day. Adding your own Gemini key in **Settings → Integrations** lifts the research cap.

## How it works

Components map (swimlanes, loops and stack): [docs/components-map.html](docs/components-map.html).

Seven steps per company, with no human decision needed in between:

| # | Step | What happens |
|---|------|--------------|
| 1 | **Scrape** | Homepage plus about, careers, security/trust, pricing and customers pages. robots.txt respected, same-site only, size and time capped, private addresses refused. |
| 2 | **Extract** | Gemini turns page text into a structured company profile. Every fact must quote the page verbatim or it is dropped; prompt-injection lines are stripped. |
| 3 | **Qualify** | The playbook's ICP rubric is scored in code, never by the LLM, as a min / max / expected score. A gray-band company triggers a bounded research loop (at most 3 extra same-site pages, each with a logged reason). |
| 4 | **Find the person** | One Hunter.io domain search per qualified company, cached forever, ranked by persona and company size. Or bring your own contacts in a CSV, or add one by hand. |
| 5 | **Pain points** | Two pains for that person's role, each tied to a piece of evidence. |
| 6 | **Draft** | A short plain-text email that greets the person by name and opens with a specific hook. A deterministic validator rejects wrong names, links, banned phrases, unsupported numbers or names, and any product claim outside the playbook's whitelist. |
| 7 | **Send** | After your approval (or automatically, if you allow it): Gmail or Resend, inside your send window and daily cap, with an unsubscribe link, one-click List-Unsubscribe headers and threaded follow-ups. |

**Test mode is the default.** Every email goes to your own inbox, with the real recipient named
in the subject (`[TEST -> Priya Raman <priya@acme.com>] ...`), so you see exactly what they would
receive. Live mode unlocks only once a provider, a sender name and a postal address are set.

**Demo mode** runs the real pipeline over a built-in synthetic web, so you can try the whole
product with no API keys. These sample domains show every outcome: `ledgerloop.io`,
`payrollpilot.com`, `claimsbridge.ai`, `fieldnote.dev`, `pocketpals.app`,
`globalbank-cloud.com`, `stealthco.xyz` and `quietops.io`.

## Features

- **Playbooks**: product, value claims (the only claims an email may make), research focus, ICP
  rubric (gates, weighted signals, penalties, thresholds), buyer personas ranked per company
  size, email rules and follow-up angles. Edit them in the app, or **draft one from your own
  website**, with every claim quote-checked against your pages.
- **Campaigns**: paste domains or upload a CSV (optionally with contacts), choose a playbook,
  auto-approve or review, and set up to three follow-ups.
- **Review queue**: keyboard-driven (`j`/`k`, `a` approve, `r` reject, `e` edit). Edits are
  re-validated as you type, you can regenerate a draft with instructions, and bulk-approve.
- **Decision trail** for every company: pages read, facts kept and dropped, score breakdown,
  research steps, contact ranking, pain points and the evidence behind each sentence.
- **Deliverability and compliance**: suppression list (unsubscribes, bounces and complaints are
  added automatically), send window, daily cap, Resend webhooks, CAN-SPAM footer.
- **Dashboard**: funnel, reply and bounce rates, sends over time, hours saved and an activity
  feed.
- **No sign-in**: every browser gets its own private workspace on first visit (`OPEN_ACCESS=1`,
  the default). API keys are stored per workspace, encrypted at rest, and never returned by the
  API. Keys set in the server environment act as fallbacks; the site owner's email account only
  ever sends test emails to `OWNER_EMAIL`, never to prospects.

## Run it locally

Requires Python 3.11+ and Node 20+.

```bash
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
npm --prefix frontend ci && npm --prefix frontend run build
.venv/bin/python -m outreach serve        # http://localhost:8000
```

Open the app: no sign-in. The workspace starts in demo mode with the Sprinto playbook. To go
real, add your keys in **Settings > Integrations** (or in `.env`, for every workspace):

- **Gemini API key** (required): drives extraction, research and writing.
- **Hunter.io key** (optional): contact search. The free tier gives 25 to 50 searches a month,
  and each domain is searched once and cached.
- **Gmail address and app password**, or a **Resend key**: for sending.

For dashboard development, run `npm --prefix frontend run dev` (Vite on :5173, with `/api`
proxied to :8000). Set `VITE_MOCK=1` to run the UI against an in-memory mock API.

### Command line

The engine also runs without the web app:

```bash
cp .env.example .env                                   # GEMINI_API_KEY, HUNTER_API_KEY, OWNER_EMAIL, ...
.venv/bin/python -m outreach run domains.txt           # dry run: prints the exact payloads
.venv/bin/python -m outreach run domains.txt --live-hunter --send
.venv/bin/python -m outreach show example.com          # the readable decision log
```

## Deploy on Vercel

The repo is Vercel-ready. Vercel's CDN serves the dashboard from `frontend/dist`, and the API
runs as one Python function (`api/index.py`).

1. Create a Postgres database (Neon works well) and import the repo into Vercel.
2. Set these environment variables:
   - `DATABASE_URL`: the Postgres connection string.
   - `SECRET_KEY`: a long random string. It signs sessions and encrypts stored keys.
   - `CRON_SECRET`: a random string.
   - Optional: `PUBLIC_BASE_URL`, plus fallback `GEMINI_API_KEY`, `HUNTER_API_KEY` and so on.
3. Deploy.

Serverless functions have no background worker, so work runs in short, leased *ticks*. While
the dashboard is open it pumps `POST /api/worker/tick`, and Vercel Cron calls `/api/cron/tick`
for scheduled sends and follow-ups. The schedule is daily on the Hobby plan; point any external
scheduler at the endpoint, with `Authorization: Bearer $CRON_SECRET`, for minute-level sends.
On a long-running host (`outreach serve`, Docker, a VM) a background thread does the same work.

## Architecture

```
frontend/              React + TypeScript dashboard and landing page (Vite, Tailwind, GSAP)
src/outreach/          the engine: scrape, extract, qualify, agent, poc, draft, followup, playbook, demo
src/outreach/server/   FastAPI app: auth, workspaces, playbooks, campaigns, review queue,
                       pipeline (one stage per tick), mailer (Gmail/Resend), worker, webhooks
api/index.py           Vercel entry point
config/icp.toml        the Sprinto ICP rubric (hashed into every decision)
docs/API.md            the HTTP API contract
tests/                 offline test suite (fakes and mocked HTTP only)
```

The engine never lets the LLM decide anything that can be checked in code. Scores come from the
rubric, contacts come from Hunter or from you, and every email passes the validator before it can
be approved. You can override a failed validation, but only explicitly, and the override is logged.

## Tests

```bash
.venv/bin/python -m pytest -q             # engine + API end to end, fully offline
.venv/bin/python scripts/check_secrets.py # no key-shaped strings in the repo
npm --prefix frontend run build           # type-checks and builds the dashboard
```

## Compliance notes

- Fill in your sender name and postal address before any live campaign. CAN-SPAM requires a
  physical address and a working opt-out, and opt-outs here take effect immediately.
- GDPR, UK PECR and CASL are stricter for EU, UK and Canadian recipients. B2B cold email there
  needs a legitimate-interest basis. Review your list before sending live.
- No tracking pixels, no fake "Re:" subjects (follow-ups are genuine replies in the same
  thread) and no claims outside your playbook's whitelist.
