import { useRef } from "react";
import { ExternalLink } from "lucide-react";
import { countUp, gsap, prefersReducedMotion, useGSAP } from "../../components/motion/gsap";
import { Label } from "./bits";

function Quote({ children, src }: { children: string; src: string }) {
  return (
    <figure className="mt-3">
      <blockquote className="text-[14px] leading-6">
        “<mark data-hl className="bg-no-repeat text-ink [background-image:linear-gradient(rgb(var(--accent-soft)),rgb(var(--accent-soft)))] [background-size:100%_100%] bg-transparent">{children}</mark>”
      </blockquote>
      <figcaption className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-accent">
        kestrelpay.com{src} <ExternalLink className="h-3 w-3" aria-hidden />
      </figcaption>
    </figure>
  );
}

function Card({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <article className="flex flex-col rounded-xl border border-line bg-surface p-5 sm:p-6">
      <p className="font-mono text-[11px] text-faint">[{n}]</p>
      <h3 className="mt-2 font-display text-[28px] leading-8">{title}</h3>
      <div className="mt-2 flex-1">{children}</div>
    </article>
  );
}

export function TrailShowcase() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const el = root.current!;
      const marks = el.querySelectorAll<HTMLElement>("[data-hl]");
      if (!prefersReducedMotion()) {
        gsap.fromTo(marks, { backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%", duration: 0.9, ease: "power2.out", stagger: 0.18, scrollTrigger: { trigger: el, start: "top 65%", once: true } });
      }
      el.querySelectorAll<HTMLElement>("[data-count]").forEach((n) => countUp(n, Number(n.dataset.count), { trigger: el, decimals: Number(n.dataset.decimals ?? 0) }));
    },
    { scope: root },
  );
  return (
    <section ref={root} id="trail" aria-labelledby="trail-h" className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 lg:py-32">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <Label n="02">The decision trail</Label>
          <h2 id="trail-h" data-scramble className="mt-4 font-display text-[44px] leading-[46px] tracking-[-0.02em] sm:text-[64px] sm:leading-[64px]">
            Defend every email.
          </h2>
        </div>
        <p className="max-w-[52ch] text-[16px] leading-7 text-muted">
          For each company you get three answers, and each one rests on quotes from the company's own pages with the link. If a fact can't be traced, it doesn't reach the email.
        </p>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <Card n="1" title="Why this company">
          <div className="flex items-end gap-4">
            <div>
              <p className="text-xs text-muted">Score</p>
              <p className="num font-display text-[56px] leading-none"><span data-count="98">98</span><span className="text-[24px] text-faint">/100</span></p>
            </div>
            <p className="pb-2 text-[13px] text-positive">Qualified · rubric icp.2</p>
          </div>
          <div className="relative mt-3 h-2 rounded-full bg-active"><div className="absolute inset-y-0 left-0 w-[98%] rounded-full bg-positive" /><div className="absolute -inset-y-1 left-[60%] w-px bg-ink/60" /></div>
          <Quote src="/security">We plan to certify against ISO 27001 this year</Quote>
          <Quote src="/careers">We are hiring a Head of Security</Quote>
        </Card>
        <Card n="2" title="Why this person">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft font-display text-[18px] text-accent-ink">EV</span>
            <div>
              <p className="font-medium">Elena Varga, CISO</p>
              <p className="font-mono text-xs text-muted">verified · confidence 96</p>
            </div>
          </div>
          <p className="mt-4 text-[14px] leading-6 text-muted">Top title match for a company of about 300 people, ahead of the Director of Engineering. The VP Marketing was excluded by keyword.</p>
          <Quote src="/about">a team of about 300 people across Austin and Dublin</Quote>
        </Card>
        <Card n="3" title="Why this email">
          <p className="text-[14px] leading-7">
            Hi Elena, saw Kestrel Pay <mark data-hl className="bg-no-repeat text-ink [background-image:linear-gradient(rgb(var(--accent-soft)),rgb(var(--accent-soft)))] [background-size:100%_100%] bg-transparent">plans to certify against ISO 27001 this year</mark> and is{" "}
            <mark data-hl className="bg-no-repeat text-ink [background-image:linear-gradient(rgb(var(--accent-soft)),rgb(var(--accent-soft)))] [background-size:100%_100%] bg-transparent">hiring a Head of Security</mark>. With{" "}
            <mark data-hl className="bg-no-repeat text-ink [background-image:linear-gradient(rgb(var(--accent-soft)),rgb(var(--accent-soft)))] [background-size:100%_100%] bg-transparent">Tidewater Bank</mark> and other credit unions as customers…
          </p>
          <p className="mt-4 font-mono text-[11px] text-muted">5 claims · 5 traced · validator passed</p>
        </Card>
      </div>
      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          { v: 17.5, d: 1, l: "minutes of research saved per company" },
          { v: 100, d: 0, l: "percent of claims traced to a quote", suffix: "%" },
          { v: 0, d: 0, l: "emails sent before you approve (unless you turn on auto-approve)" },
        ].map((x) => (
          <div key={x.l} className="bg-surface px-5 py-5">
            <p className="num font-display text-[44px] leading-none"><span data-count={x.v} data-decimals={x.d}>{x.v}</span>{x.suffix}</p>
            <p className="mt-2 text-[13px] text-muted">{x.l}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
