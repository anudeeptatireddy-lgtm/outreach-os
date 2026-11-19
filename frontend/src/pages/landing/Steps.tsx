import { useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion, useGSAP } from "../../components/motion/gsap";
import { cn } from "../../lib/cn";
import { Label } from "./bits";

export const STEPS = [
  { key: "scrape", title: "Read the website", body: "Home, about, careers, security, pricing and customers pages, fetched politely and cached." },
  { key: "extract", title: "Quote the facts", body: "An LLM extracts facts, and every fact must be found verbatim on the page it cites. The rest is dropped." },
  { key: "qualify", title: "Score against your ICP", body: "A weighted rubric gives a min, max and expected score. In the gray band, a research loop fetches the pages that would settle it." },
  { key: "poc", title: "Find the person", body: "Hunter's people are ranked by title for the company's size. Sales, HR and interns are never picked." },
  { key: "pain", title: "Pick two pains", body: "Each pain is tied to a quoted fact and to why this person, in this role, owns it." },
  { key: "draft", title: "Write the email", body: "50 to 90 words, one observation, one product line. A strict validator rejects any claim it can't trace." },
  { key: "send", title: "Send, or test first", body: "You approve. Test mode delivers to your own inbox; live mode respects your window, cap and suppression list." },
] as const;

const NOISE = "<div class=\"hero\"><h1>Payments for credit unions</h1><script src=\"/_next/static/chunks/8f2a.js\"></script>01001011 <nav><a href=\"/security\">Security</a><a href=\"/careers\">Careers</a></nav>";

function useTyped(text: string, on: boolean, cps = 55) {
  const [n, setN] = useState(on ? 0 : text.length);
  useEffect(() => {
    if (!on || prefersReducedMotion()) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = window.setInterval(() => setN((x) => (x >= text.length ? (window.clearInterval(id), x) : x + 2)), 1000 / cps);
    return () => window.clearInterval(id);
  }, [text, on, cps]);
  return text.slice(0, n);
}

function Line({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" | "live" }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-[64px] shrink-0 text-white/45 sm:w-[92px]">{k}</span>
      <span className={cn("min-w-0", tone === "ok" ? "text-[#7be3a7]" : tone === "warn" ? "text-[#f7c7a3]" : tone === "live" ? "text-[#4fd6ec]" : "text-white/85")}>{v}</span>
    </div>
  );
}

const EMAIL =
  "Hi Elena, saw Kestrel Pay plans to certify against ISO 27001 this year and is hiring a Head of Security. With Tidewater Bank and other credit unions as customers, that usually means security reviews asking for proof long before the audit. Sprinto automates compliance for SOC 2, ISO 27001 and GDPR…";

/** The terminal-like panel whose content morphs with the active step. */
export function Readout({ step, live = true }: { step: number; live?: boolean }) {
  const email = useTyped(EMAIL, live && step === 5);
  const [noise, setNoise] = useState(NOISE);
  useEffect(() => {
    if (!live || step !== 0 || prefersReducedMotion()) return;
    const id = window.setInterval(() => setNoise((s) => s.slice(7) + s.slice(0, 7)), 90);
    return () => window.clearInterval(id);
  }, [step, live]);
  return (
    <div className="grain relative overflow-hidden rounded-xl border border-white/10 bg-[#07081c] font-mono text-[12px] leading-[20px] text-white/85 shadow-float" data-ui>
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[11px] text-white/50">
        <span className="h-2 w-2 rounded-full bg-[#4fd6ec]" />
        <span>kestrelpay.com</span>
        <span className="ml-auto">[{String(step + 1).padStart(2, "0")}/07] {STEPS[step]!.key}</span>
      </div>
      <div key={step} className={cn("animate-pop-in px-4 py-4", live && "min-h-[300px]")}>
        {step === 0 && (
          <>
            <Line k="GET" v="https://kestrelpay.com/  200 · 8.4 kB" tone="ok" />
            <Line k="GET" v="/about  200 · 5.1 kB" tone="ok" />
            <Line k="GET" v="/pricing  200 · 3.9 kB" tone="ok" />
            <Line k="GET" v="/trust  403 · blocked_by_robots" tone="warn" />
            <div className="mt-3 max-h-[120px] overflow-hidden break-all text-white/30">{noise}{noise}</div>
          </>
        )}
        {step === 1 && (
          <>
            <Line k="is_b2b" v='"a B2B payments platform for credit unions"' tone="ok" />
            <Line k="stage" v='"We raised a $38M Series B"' tone="ok" />
            <Line k="headcount" v='"a team of about 300 people"' tone="ok" />
            <Line k="focus" v='"We plan to certify against ISO 27001 this year"' tone="ok" />
            <Line k="dropped" v='"Join 400+ financial institutions" · not a named customer' tone="warn" />
            <p className="mt-3 text-white/45">12 facts kept · 1 dropped · every quote found verbatim</p>
          </>
        )}
        {step === 2 && (
          <>
            <Line k="initial" v="28–98 · gray band → research loop" tone="warn" />
            <Line k="fetch /security" v="compliance_pursuit resolved +30" tone="live" />
            <Line k="fetch /customers" v="enterprise_customers resolved +20" tone="live" />
            <Line k="fetch /careers" v="security_hiring resolved +20" tone="live" />
            <div className="mt-4">
              <div className="flex justify-between text-white/45"><span>score</span><span className="text-white">98 / 100</span></div>
              <div className="relative mt-1.5 h-2 rounded-full bg-white/10">
                <div className="absolute inset-y-0 left-0 rounded-full bg-[#7be3a7] transition-[width] duration-[1200ms] ease-out" style={{ width: live ? "98%" : "98%" }} />
                <div className="absolute -inset-y-1 left-[60%] w-px bg-white/70" />
              </div>
              <p className="mt-1.5 text-white/45">qualified · score_min 98 ≥ qualify_min 60</p>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <div className="rounded-lg border border-white/10 p-3">
              <p className="font-display text-[22px] leading-6 text-white">Elena Varga</p>
              <p className="text-white/60">CISO · elena@kestrelpay.com</p>
              <p className="mt-2 text-[#7be3a7]">verified · confidence 96</p>
            </div>
            <Line k="band" v="large · headcount 201-500" />
            <Line k="#2" v="Tomás Reyes, Director of Engineering · 40" />
            <Line k="excluded" v="Hannah Ostrowski, VP Marketing · keyword: marketing" tone="warn" />
          </>
        )}
        {step === 4 && (
          <>
            <Line k="E1" v="Bank customers ask for proof of ISO 27001 progress in security reviews." tone="live" />
            <Line k="why" v="a CISO owns security posture and proof to customers" />
            <div className="h-3" />
            <Line k="E2" v="A new Head of Security inherits evidence collection across teams." tone="live" />
            <Line k="why" v="a CISO owns the compliance programme" />
          </>
        )}
        {step === 5 && (
          <>
            <p className="text-white/45">subject: iso 27001 this year</p>
            <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-6 text-white">
              {email}
              {live && email.length < EMAIL.length && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-[#4fd6ec]" />}
            </p>
            <p className="mt-3 text-[#7be3a7]">validator: 5 claims · 5 traced · 66 words · passed</p>
          </>
        )}
        {step === 6 && (
          <>
            <Line k="mode" v="test" tone="warn" />
            <Line k="to" v="you@yourcompany.com" />
            <Line k="subject" v="[TEST -> Elena Varga <elena@kestrelpay.com>] iso 27001 this year" />
            <Line k="window" v="Tue 09:30 ET · 4 of 30 today" />
            <Line k="status" v="sent · follow-up 1 in 3 days" tone="ok" />
          </>
        )}
      </div>
    </div>
  );
}

/** Pinned on desktop: scrolling walks through the seven steps. Stacked and static otherwise. */
export function StepsSection() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
        setPinned(true);
        const st = gsap.timeline({
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: () => `+=${window.innerHeight * 3.2}`,
            pin: true,
            scrub: 0.4,
            onUpdate: (self) => setActive(Math.min(STEPS.length - 1, Math.floor(self.progress * STEPS.length * 0.999))),
          },
        });
        st.to(root.current!.querySelector("[data-progress]"), { scaleY: 1, ease: "none" });
        return () => setPinned(false);
      });
      return () => mm.revert();
    },
    { scope: root },
  );
  return (
    <section ref={root} id="steps" aria-labelledby="steps-h" className="relative bg-ground">
      <div className="mx-auto grid min-h-screen max-w-[1240px] items-center gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
        <div>
          <Label n="01">The pipeline</Label>
          <h2 id="steps-h" data-scramble className="mt-4 font-display text-[44px] leading-[46px] tracking-[-0.02em] sm:text-[64px] sm:leading-[64px]">
            Seven steps, zero guesswork.
          </h2>
          <ol className="relative mt-10 flex flex-col">
            <span aria-hidden className="absolute bottom-3 left-[15px] top-3 w-px bg-line" />
            <span aria-hidden data-progress className="absolute bottom-3 left-[15px] top-3 w-px origin-top scale-y-0 bg-accent" />
            {STEPS.map((s, i) => {
              const on = pinned ? i === active : true;
              return (
                <li key={s.key} className={cn("relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 py-2.5 transition-opacity duration-300", pinned && !on && "opacity-40")}>
                  <span className={cn("relative z-10 grid h-8 w-8 place-items-center rounded-full border font-mono text-[11px] transition-colors", pinned && i <= active ? "border-accent bg-accent text-white" : "border-ink/30 bg-surface text-ink/80")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="pt-1 text-[17px] font-medium">{s.title}</h3>
                    <p className={cn("mt-1 max-w-[46ch] text-[14px] leading-6 text-muted", pinned && !on && "hidden")}>{s.body}</p>
                    {!pinned && <div className="mt-4 lg:hidden"><Readout step={i} live={false} /></div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className={cn(pinned ? "block" : "hidden lg:block")}>
          <Readout step={pinned ? active : 5} live={pinned} />
        </div>
      </div>
    </section>
  );
}
