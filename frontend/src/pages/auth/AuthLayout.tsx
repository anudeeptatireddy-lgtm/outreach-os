import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Orb, Wordmark } from "../../components/brand/Orb";
import { scrambleIn, useGSAP } from "../../components/motion/gsap";

/** Split screen: the form on warm paper, the orb on the right (a small orb above the form on phones). */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const h = root.current?.querySelector<HTMLElement>("[data-scramble]");
      if (h) scrambleIn(h, { delay: 0.1, chars: "01" });
    },
    { scope: root },
  );
  return (
    <div ref={root} className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-full flex-col px-5 py-6 sm:px-10">
        <Link to="/" className="w-fit" aria-label="Outreach OS home"><Wordmark /></Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <Orb variant="small" className="mb-6 lg:hidden" />
          <h1 data-scramble className="font-display text-[40px] leading-[44px] tracking-[-0.015em]">{title}</h1>
          <p className="mt-2 text-[14px] text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-[14px] text-muted">{footer}</div>
        </div>
        <p className="font-mono text-[11px] text-faint">Every claim quoted · Test mode by default · Unsubscribe built in</p>
      </div>
      <div className="grain relative hidden overflow-hidden bg-[#eeeeec] lg:block dark:bg-[#06071a]">
        <Orb variant="hero" animate className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <p className="max-w-[26ch] font-display text-[34px] leading-[38px] text-[#0b0c1a] dark:text-white">
            Why this company, why this person, why this email.
          </p>
          <p className="mt-3 max-w-[44ch] font-mono text-xs text-[#0b0c1a]/70 dark:text-white/75">Each answer backed by quotes from the company's own pages, with the link.</p>
        </div>
      </div>
    </div>
  );
}
