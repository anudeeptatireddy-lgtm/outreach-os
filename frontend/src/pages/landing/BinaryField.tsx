import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../components/motion/gsap";

/**
 * A faint field of drifting 0/1 characters on a canvas. ~20 fps, paused while offscreen or
 * when the tab is hidden, not drawn at all under prefers-reduced-motion.
 */
export function BinaryField({ className, density = 18 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || prefersReducedMotion()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let grid: { c: string; a: number; v: number }[] = [];
    let offset = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = density;
    const color = () => getComputedStyle(document.documentElement).getPropertyValue("--text").trim().split(/\s+/).join(",");
    let rgb = color();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / size);
      rows = Math.ceil(h / size) + 1;
      grid = Array.from({ length: cols * rows }, () => ({ c: Math.random() < 0.5 ? "0" : "1", a: Math.random() * 0.5, v: Math.random() }));
      rgb = color();
    };
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || t - last < 50) return;
      last = t;
      offset = (offset + 0.35) % size;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `${Math.round(size * 0.62)}px "Geist Mono Variable", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const g = grid[y * cols + x]!;
          if (Math.random() < 0.012) g.c = g.c === "0" ? "1" : "0";
          g.a += (Math.random() - 0.5) * 0.05;
          g.a = Math.max(0, Math.min(0.55, g.a));
          // fade toward the edges so the field reads as texture, not a wall
          const cx = x / cols - 0.5;
          const cy = y / rows - 0.5;
          const edge = Math.max(0, 1 - Math.sqrt(cx * cx + cy * cy) * 1.6);
          const alpha = g.a * edge * 0.55;
          if (alpha < 0.02) continue;
          ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
          ctx.fillText(g.c, x * size + size / 2, y * size - offset + size / 2);
        }
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting && !document.hidden));
    io.observe(canvas);
    const onVis = () => (visible = !document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const mo = new MutationObserver(() => (rgb = color()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [density]);
  return <canvas ref={ref} aria-hidden className={className} />;
}
