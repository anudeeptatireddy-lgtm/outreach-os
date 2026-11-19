import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";

/**
 * The Pryzm orb: a soft, out-of-focus heart-shaped gradient (deep indigo core, electric-blue ring,
 * sky-cyan upper-left edge, magenta-peach lower-left) under heavy film grain. Built from layered
 * radial gradients and a blur, so it scales to any size and costs no image.
 */
export type OrbVariant = "hero" | "card" | "small";

const SIZE: Record<OrbVariant, string> = { hero: "min(92vmin, 880px)", card: "460px", small: "132px" };
const BLUR: Record<OrbVariant, number> = { hero: 84, card: 52, small: 15 };

const blob = (s: CSSProperties): CSSProperties => ({ position: "absolute", borderRadius: "50%", ...s });

export function Orb({ variant = "hero", className, animate = false, style }: { variant?: OrbVariant; className?: string; animate?: boolean; style?: CSSProperties }) {
  return (
    <div aria-hidden className={cn("pointer-events-none shrink-0", /\b(absolute|fixed)\b/.test(className ?? "") ? "" : "relative", className)} style={{ width: SIZE[variant], height: SIZE[variant], ...style }}>
      <div className={cn("absolute inset-0", animate && "will-change-transform motion-safe:animate-drift")} style={{ filter: `blur(${BLUR[variant]}px) saturate(1.08)` }}>
        {/* cyan rim, upper-left */}
        <span style={blob({ left: "4%", top: "8%", width: "58%", height: "58%", background: "radial-gradient(circle at 38% 38%, #5ec8f0 0%, rgba(94,200,240,.75) 38%, rgba(94,200,240,0) 70%)" })} />
        {/* magenta and peach, lower-left */}
        <span style={blob({ left: "2%", top: "40%", width: "60%", height: "56%", background: "radial-gradient(circle at 42% 52%, #f06aa8 0%, rgba(240,106,168,.8) 26%, rgba(247,199,163,.7) 48%, rgba(247,199,163,0) 72%)" })} />
        {/* two blue lobes make the heart */}
        <span style={blob({ left: "14%", top: "14%", width: "62%", height: "62%", background: "radial-gradient(circle, #0b0f6b 0%, #1f2bff 36%, #2f4bff 54%, rgba(47,75,255,0) 72%)" })} />
        <span style={blob({ left: "34%", top: "10%", width: "58%", height: "60%", background: "radial-gradient(circle, #0b0f6b 0%, #1f2bff 38%, rgba(47,75,255,.85) 52%, rgba(47,75,255,0) 72%)" })} />
        {/* near-black core */}
        <span style={blob({ left: "30%", top: "28%", width: "44%", height: "44%", background: "radial-gradient(circle, #05061a 0%, #0b0f6b 46%, rgba(11,15,107,0) 76%)" })} />
      </div>
      <div
        className="noise-bg absolute inset-0"
        style={{
          opacity: variant === "small" ? 0.18 : 0.26,
          mixBlendMode: "soft-light",
          WebkitMaskImage: "radial-gradient(circle, #000 35%, transparent 70%)",
          maskImage: "radial-gradient(circle, #000 35%, transparent 70%)",
        }}
      />
    </div>
  );
}

/** The wordmark: "Outreach OS" in the display serif with a small orb mark. */
export function Wordmark({ className, mark = true, size = "md" }: { className?: string; mark?: boolean; size?: "sm" | "md" | "lg" }) {
  const text = { sm: "text-[19px]", md: "text-[22px]", lg: "text-[30px]" }[size];
  return (
    <span className={cn("inline-flex items-center gap-2 leading-none", className)}>
      {mark && <OrbMark className={size === "lg" ? "h-6 w-6" : "h-[18px] w-[18px]"} />}
      <span className={cn("font-display tracking-[-0.01em]", text)}>Outreach OS</span>
    </span>
  );
}

export function OrbMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block rounded-full", className)}
      style={{
        background:
          "radial-gradient(circle at 34% 30%, #5ec8f0 0%, rgba(94,200,240,0) 42%), radial-gradient(circle at 30% 78%, #f06aa8 0%, rgba(240,106,168,0) 46%), radial-gradient(circle at 55% 50%, #05061a 0%, #0b0f6b 30%, #1f2bff 58%, #2f4bff 80%)",
      }}
    />
  );
}
