// GSAP setup for brand surfaces (landing, auth, onboarding). App work surfaces do not animate.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, ScrambleTextPlugin, useGSAP);
// Real time even when frames are slow: an entrance must never stall half-way on a busy device.
gsap.ticker.lagSmoothing(0);

export { gsap, ScrollTrigger, useGSAP };

export const BINARY = "01";
export const GLYPHS = "01<>/{}#*";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scramble an element's text from 0/1 and glyphs into its real text. The real text is kept in
 * data-text so a StrictMode re-run or a context revert never reads the scrambled state back.
 */
export function scrambleIn(
  el: HTMLElement,
  opts: { delay?: number; duration?: number; chars?: string; trigger?: Element; start?: string } = {},
) {
  const text = el.dataset.text ?? el.textContent ?? "";
  el.dataset.text = text;
  if (prefersReducedMotion() || !text.trim()) {
    el.textContent = text;
    return null;
  }
  const noise = text.replace(/\S/g, (_c, i: number) => (i % 3 === 0 ? "1" : "0"));
  return gsap.fromTo(
    el,
    { textContent: noise },
    {
      duration: opts.duration ?? Math.min(1.6, 0.6 + text.length * 0.02),
      delay: opts.delay ?? 0,
      ease: "none",
      scrambleText: { text, chars: opts.chars ?? GLYPHS, revealDelay: 0.2, speed: 0.55 },
      scrollTrigger: opts.trigger ? { trigger: opts.trigger, start: opts.start ?? "top 80%", once: true } : undefined,
      onComplete: () => {
        el.textContent = text;
      },
    },
  );
}

/** Count a number up into an element when it scrolls in. */
export function countUp(el: HTMLElement, to: number, opts: { decimals?: number; trigger?: Element; duration?: number } = {}) {
  const fmt = (v: number) => v.toFixed(opts.decimals ?? 0);
  if (prefersReducedMotion()) {
    el.textContent = fmt(to);
    return null;
  }
  const o = { v: 0 };
  el.textContent = fmt(0);
  return gsap.to(o, {
    v: to,
    duration: opts.duration ?? 1.4,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = fmt(o.v);
    },
    scrollTrigger: opts.trigger ? { trigger: opts.trigger, start: "top 80%", once: true } : undefined,
  });
}
