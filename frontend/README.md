# outreach-os dashboard

The web app for outreach-os: a public landing page at `/`, auth and onboarding, and the app under
`/app` (dashboard, campaigns, prospect decision trails, review queue, sent mail, playbooks,
settings). Vite + React 18 + TypeScript (strict) + Tailwind v3 + React Router v6 + TanStack Query v5.
GSAP (ScrollTrigger, ScrambleText) is used on brand surfaces only (landing, auth, onboarding).

The API contract is `../docs/API.md`; wire types live in `src/api/types.ts` and the typed client in
`src/api/client.ts`.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173, proxies /api and /u to http://127.0.0.1:8000
```

Run the FastAPI backend on port 8000 alongside it. The dev server proxies `/api` and `/u`.

## Mock mode (no backend)

```bash
VITE_MOCK=1 npm run dev     # or: npm run dev:mock
```

`src/api/mock.ts` implements the whole contract in memory (seed data in `src/api/mockData.ts`):
the Sprinto playbook with the real `icp.2` rubric, two campaigns, about 30 prospects across every
status, messages in every status, events, analytics and a suppression list. Scores are computed by
applying the rubric to each company's quoted facts, so the decision trails are internally consistent.

- You start signed in as a sample user. Log out and sign in with any email and a password of 8+
  characters. Signing up starts an empty workspace and runs onboarding.
- Processing is driven by `POST /api/worker/tick`, as on Vercel: the app shell pumps it while you are
  signed in, and the mock advances queued -> researching (stage by stage) -> needs review over a few
  seconds. Add domains to a campaign to watch it. The demo domains `ledgerloop.io`,
  `payrollpilot.com`, `claimsbridge.ai`, `fieldnote.dev`, `pocketpals.app`,
  `globalbank-cloud.com`, `stealthco.xyz` and `quietops.io` show every outcome.
- State lives in memory and resets on reload.

## Build

```bash
npm run build        # tsc --noEmit, then vite build into dist/
npx tsc --noEmit     # type check only
```

The backend serves `dist/` with an SPA fallback to `index.html`. Base path is `/`. The mock is not
included in a normal build (only when `VITE_MOCK=1` is set at build time).

## Layout

```
src/api/          types.ts (wire types), client.ts (fetch client), hooks.ts (TanStack Query),
                  mock.ts + mockData.ts (VITE_MOCK=1)
src/lib/          session, worker pump, theme, toasts, formatting, safe redirects, grain tile
src/components/   ui/ primitives (Button, Field, Dialog/Drawer, Pill, Tabs, TagInput, Menu, Panel),
                  brand/Orb.tsx (the gradient orb and wordmark), motion/gsap.ts, ScoreBar.tsx
src/layout/       AppShell (sidebar, phone menu, processing indicator)
src/pages/        Landing (+ landing/), auth/, Onboarding, Dashboard, campaigns/, prospect/ (decision
                  trail), review/, Sent, playbooks/, settings/
```

Keyboard in the review queue: `j`/`k` move, `a` approve, `r` reject, `e` edit the body.
Motion respects `prefers-reduced-motion` (text renders final, no pinning, no character field).
