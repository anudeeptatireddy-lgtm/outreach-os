# Outreach OS

AI SDR for B2B outbound: scrape -> extract -> qualify (ICP rubric + bounded research loop) ->
find the person -> pain points -> draft (validated) -> review -> send (Gmail/Resend) + follow-ups.
Playbooks make it product-agnostic; the Sprinto playbook is the flagship default.

## Layout
- `src/outreach/` engine. Pure, offline-testable; every external call goes through `Context`
  (llm, hunter, fetcher). `playbook.py` holds the product-specific config; `demo.py` is a
  synthetic web for demo mode.
- `src/outreach/server/` FastAPI app. `pipeline.py` runs ONE stage per call and persists to
  `Prospect.trail`; `worker.py` ticks (thread locally, `/api/worker/tick` + cron on Vercel);
  `mailer.py` is the only place mail leaves.
- `frontend/` React + TS + Tailwind + GSAP dashboard and landing page. Contract: `docs/API.md`.
- `api/index.py` + `vercel.json`: Vercel deployment (Postgres via DATABASE_URL).

## Rules
- The LLM never decides what code can check: scores come from the rubric, contacts from
  Hunter or the user, and drafts must pass `validate_draft`.
- Every product claim in an email must be in the playbook's value-claim whitelist.
- Test mode (all mail to owner_email) stays the default; live mode is gated by `live_ready`.
- Keep the suite offline: `.venv/bin/python -m pytest -q` (no network, fakes only).
- Never put secrets in code, logs or API responses; `scripts/check_secrets.py` guards the repo.
