import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePref = "system" | "light" | "dark";
type Ctx = { pref: ThemePref; resolved: "light" | "dark"; setPref: (p: ThemePref) => void; cycle: () => void };
const ThemeCtx = createContext<Ctx | null>(null);
const KEY = "oos-theme";

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem(KEY) as ThemePref) || "system";
    } catch {
      return "system";
    }
  });
  const [sys, setSys] = useState(systemDark());
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => setSys(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  const resolved = pref === "system" ? (sys ? "dark" : "light") : pref;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
  }, []);
  const cycle = useCallback(() => setPref(pref === "system" ? "light" : pref === "light" ? "dark" : "system"), [pref, setPref]);
  return <ThemeCtx.Provider value={{ pref, resolved, setPref, cycle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
