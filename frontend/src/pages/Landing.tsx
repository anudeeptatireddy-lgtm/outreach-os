import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Mail, Monitor, Moon, ShieldCheck, Sun, UserX } from "lucide-react";
import { Orb, Wordmark } from "../components/brand/Orb";
import { gsap, prefersReducedMotion, scrambleIn, useGSAP } from "../components/motion/gsap";
import { useTheme } from "../lib/theme";
import { BinaryField } from "./landing/BinaryField";
import { Label } from "./landing/bits";
import { TrailShowcase } from "./landing/Showcase";
import { StepsSection } from "./landing/Steps";

const STATUS = "> scraping ledgerloop.io … 6 pages · 14 facts quoted · score 82/100 · contact: Dana Whitfield, Head of Security";

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setT(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const tz = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(t).find((p) => p.type === "timeZoneName")?.value ?? "";
  return <span className="num">{tz} {t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>;
}

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const Icon = pref === "system" ? Monitor : pref === "light" ? Sun : Moon;
  return (
    <button onClick={cycle} aria-label={`Theme: ${pref}. Switch theme`} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-active hover:text-ink">
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-[1240px] items-center gap-6 px-5 py-5 sm:px-8">
        <Link to="/" aria-label="Outreach OS home"><Wordmark /></Link>
        <nav aria-label="Sections" className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.08em] text-muted md:flex">
          <a href="#steps" className="hover:text-ink">Pipeline</a>
          <a href="#trail" className="hover:text-ink">Decision trail</a>
          <a href="#playbooks" className="hover:text-ink">Playbooks</a>
          <a href="#guardrails" className="hover:text-ink">Guardrails</a>
          <a href="#try" className="hover:text-ink">Try it</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-muted lg:inline"><Clock /></span>
          <ThemeToggle />
          <Link to="/app" className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-[14px] font-medium text-ground hover:bg-ink/90">Try the demo</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const root = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  useGSAP(
    () => {
      const h = root.current!.querySelector<HTMLElement>("[data-hero-title]");
      if (h) scrambleIn(h, { delay: 0.15, duration: 1.6, chars: "01" });
      const el = status.current!;
      if (prefersReducedMotion()) {
        el.textContent = STATUS;
        return;
      }
      const o = { n: 0 };
      el.textContent = "";
      gsap.to(o, {
        n: STATUS.length,
        duration: 3.2,
        delay: 1.4,
        ease: "none",
        onUpdate: () => {
          el.textContent = STATUS.slice(0, Math.round(o.n));
        },
      });
      gsap.from(root.current!.querySelectorAll("[data-rise]"), { y: 18, opacity: 0, duration: 0.8, stagger: 0.08, delay: 0.6, ease: "power3.out" });
    },
    { scope: root },
  );
  return (
    <section ref={root} aria-labelledby="hero-h" className="grain relative flex min-h-[100svh] flex-col overflow-hidden">
      <BinaryField className="absolute inset-0 h-full w-full" />
      <Orb variant="hero" animate className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2" />
      <div className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-1 flex-col items-center justify-center px-5 pt-28 text-center sm:px-8">
        <h1 id="hero-h" className="font-display text-[52px] leading-[0.95] tracking-[-0.025em] text-white [text-shadow:0_2px_30px_rgba(5,6,26,.35)] sm:text-[88px] lg:text-[120px]">
          <span data-hero-title>Cold outreach</span>
          <br />
          <span className="italic">you can defend.</span>
        </h1>
      </div>
      <div className="relative z-10 mx-auto w-full max-w-[1240px] px-5 pb-10 sm:px-8">
        <div className="grid items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p data-rise className="max-w-[52ch] text-[16px] leading-7 text-ink sm:text-[17px]">
              Outreach OS qualifies each account against your ICP, finds the decision-maker and writes a short email where every claim is quoted from the company's own website. You approve; it sends.
            </p>
            <p ref={status} aria-label={STATUS} className="mt-4 min-h-[20px] font-mono text-[12px] text-muted" />
          </div>
          <div data-rise className="flex flex-wrap gap-2">
            <Link to="/app" className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-white hover:bg-accent/90">
              Try the live demo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Playbooks() {
  const weights = [
    ["Pursuing a compliance framework", 30],
    ["Named enterprise customers", 20],
    ["Hiring for security or infra", 20],
    ["B2B product", 10],
    ["Regulated vertical", 10],
    ["Funding stage", 5],
    ["Headcount band", 5],
  ] as const;
  return (
    <section id="playbooks" aria-labelledby="pb-h" className="border-y border-line bg-surface/60">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:py-32">
        <div>
          <Label n="03">Playbooks</Label>
          <h2 id="pb-h" data-scramble className="mt-4 font-display text-[44px] leading-[46px] tracking-[-0.02em] sm:text-[64px] sm:leading-[64px]">
            Built for any B2B team. Tuned for Sprinto.
          </h2>
          <p className="mt-6 max-w-[48ch] text-[16px] leading-7 text-muted">
            A playbook holds what you sell, the only product claims an email may make, the ICP rubric, who to contact by company size and the email rules. Start from the Sprinto template, start blank, or have one drafted from your own website.
          </p>
        </div>
        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7" data-ui>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">playbook · icp.2</p>
              <h3 className="mt-1 font-display text-[30px] leading-8">Sprinto</h3>
              <p className="text-[14px] text-muted">Compliance automation for SOC 2, ISO 27001 and GDPR</p>
            </div>
            <span className="rounded-full bg-positive-bg px-2.5 py-0.5 font-mono text-[11px] text-positive-ink">weights 100/100</span>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">Rubric</p>
              <ul className="mt-2 flex flex-col gap-2">
                {weights.map(([l, w]) => (
                  <li key={l} className="text-[13px]">
                    <div className="flex justify-between gap-2"><span className="truncate">{l}</span><span className="num font-mono text-xs text-muted">{w}</span></div>
                    <div className="mt-1 h-1 rounded-full bg-active"><div className="h-1 rounded-full bg-accent" style={{ width: `${(w / 30) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-5">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">The only claims allowed</p>
                <p className="mt-2 text-[13px]"><span className="mr-1.5 font-mono text-xs text-muted">S1</span>Sprinto automates compliance for SOC 2, ISO 27001 and GDPR</p>
                <p className="mt-1.5 text-[13px]"><span className="mr-1.5 font-mono text-xs text-muted">S2</span>continuous monitoring and audit-ready evidence collection</p>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">Who to contact, 51-200 people</p>
                <ol className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                  {["Security lead", "Engineering lead", "IT lead", "GRC lead", "CTO", "CEO"].map((p, i) => (
                    <li key={p} className="rounded-full border border-line px-2 py-0.5"><span className="font-mono text-faint">{i + 1}</span> {p}</li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">Email</p>
                <p className="mt-2 text-[13px] text-muted">50–90 words · plain, specific, peer to peer · 2 follow-up angles</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function Guardrails() {
  const items = [
    { icon: ShieldCheck, t: "Every claim is quoted", b: "Facts come from the prospect's own site, verbatim, with the link. A validator rejects anything it can't trace." },
    { icon: Mail, t: "Test mode to your inbox", b: "Until you switch to live, every email lands with you, the real recipient shown in the subject." },
    { icon: UserX, t: "Unsubscribe and suppression", b: "One-click unsubscribe, a postal address in every footer, and bounces and complaints suppressed automatically." },
  ];
  return (
    <section id="guardrails" aria-labelledby="g-h" className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 lg:py-28">
      <Label n="04">Guardrails</Label>
      <h2 id="g-h" data-scramble className="mt-4 max-w-[18ch] font-display text-[44px] leading-[46px] tracking-[-0.02em] sm:text-[56px] sm:leading-[58px]">Nothing goes out you didn't approve.</h2>
      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
        {items.map((x) => (
          <div key={x.t} className="bg-surface p-6">
            <x.icon className="h-5 w-5 text-accent" strokeWidth={1.6} aria-hidden />
            <h3 className="mt-4 text-[17px] font-medium">{x.t}</h3>
            <p className="mt-1.5 text-[14px] leading-6 text-muted">{x.b}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const SAMPLE_DOMAINS = "ledgerloop.io\npayrollpilot.com\nclaimsbridge.ai\nfieldnote.dev\npocketpals.app\nglobalbank-cloud.com\nstealthco.xyz\nquietops.io";

function TryIt() {
  const steps = [
    { t: "Open the app", b: <>No sign-in. Your browser gets its own private workspace, in demo mode, with the Sprinto playbook.</> },
    { t: "Run a demo campaign", b: <><span className="text-ink">Campaigns → New campaign</span>, paste the sample domains below and start. They cover every outcome: qualified, disqualified, too little data, no contact.</> },
    { t: "Read the trail, then review", b: <>Open a company to see each fact's quote, the score breakdown and why this person. In <span className="text-ink">Review</span>, edit a draft and approve it. Add a claim like "we are the fastest" and approval is blocked.</> },
    { t: "Try real companies", b: <><span className="text-ink">Settings → Demo mode</span> off, then a campaign with real domains such as openstatus.dev. If Hunter's free searches are used up, choose <span className="text-ink">Add a contact</span> to see the draft.</> },
  ];
  return (
    <section id="try" aria-labelledby="try-h" className="border-t border-line bg-surface/60">
      <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 lg:py-28">
        <Label n="05">Try it</Label>
        <h2 id="try-h" data-scramble className="mt-4 max-w-[20ch] font-display text-[44px] leading-[46px] tracking-[-0.02em] sm:text-[56px] sm:leading-[58px]">Test it yourself in ten minutes.</h2>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2 lg:grid-cols-4">
          {steps.map((x, i) => (
            <li key={x.t} className="bg-surface p-6">
              <span className="font-mono text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-[17px] font-medium">{x.t}</h3>
              <p className="mt-1.5 text-[14px] leading-6 text-muted">{x.b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Sample domains</p>
            <pre className="mt-3 font-mono text-[13px] leading-6 text-ink">{SAMPLE_DOMAINS}</pre>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 text-[14px] leading-6 text-muted">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em]">Good to know</p>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-4">
              <li>Approved emails go out in test mode, to the site owner's inbox. Nothing is ever sent to a prospect from this site.</li>
              <li>To receive test emails yourself, add your own Resend or Gmail key in <span className="text-ink">Settings → Integrations</span>.</li>
              <li>On this site's keys, real research is capped at 10 companies per workspace a day. Your own Gemini key lifts it.</li>
            </ul>
          </div>
        </div>
        <Link to="/app" className="mt-10 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-ground hover:bg-ink/90">
          Open the app <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-h" className="grain relative overflow-hidden">
      <Orb variant="hero" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-95" />
      <div className="relative mx-auto flex min-h-[80vh] max-w-[1240px] flex-col items-center justify-center px-5 py-24 text-center sm:px-8">
        <h2 id="cta-h" data-scramble className="font-display text-[48px] leading-[50px] tracking-[-0.02em] text-white [text-shadow:0_2px_30px_rgba(5,6,26,.35)] sm:text-[80px] sm:leading-[80px]">
          See your first trail.
        </h2>
        <p className="mt-5 max-w-[42ch] text-[16px] leading-7 text-white/90 [text-shadow:0_1px_16px_rgba(5,6,26,.5)]">Demo mode needs no keys. Paste a few domains and read why each one qualified.</p>
        <Link to="/app" className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#0b0c1a] hover:bg-white/90">
          Try the live demo <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      root.current!.querySelectorAll<HTMLElement>("[data-scramble]").forEach((el) => scrambleIn(el, { trigger: el, start: "top 85%" }));
    },
    { scope: root },
  );
  return (
    <div ref={root} className="min-h-full overflow-x-clip">
      <Nav />
      <main>
        <Hero />
        <StepsSection />
        <TrailShowcase />
        <Playbooks />
        <Guardrails />
        <TryIt />
        <FinalCta />
      </main>
      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 sm:px-8">
        <Wordmark />
        <span className="font-mono text-[11px] text-muted">Evidence-cited outbound for B2B teams</span>
        <span className="ml-auto flex gap-4 text-[13px] text-muted">
          <Link to="/app" className="hover:text-ink">Open the app</Link>
        </span>
      </footer>
    </div>
  );
}
