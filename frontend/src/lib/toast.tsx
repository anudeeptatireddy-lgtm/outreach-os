import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "./cn";

type Kind = "success" | "error" | "info" | "warning";
type Toast = { id: number; kind: Kind; title: string; body?: string; action?: { label: string; onClick: () => void } };
type Ctx = { push: (t: Omit<Toast, "id">) => void };
const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(1);
  const dismiss = useCallback((tid: number) => setToasts((ts) => ts.filter((t) => t.id !== tid)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const tid = id.current++;
      setToasts((ts) => [...ts.slice(-3), { ...t, id: tid }]);
      window.setTimeout(() => dismiss(tid), t.kind === "error" ? 7000 : 4200);
    },
    [dismiss],
  );
  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const tone = { success: "text-positive", error: "text-negative", info: "text-accent", warning: "text-warning" };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((t) => {
          const Icon = icon[t.kind];
          return (
            <div key={t.id} className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-float">
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone[t.kind])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-muted">{t.body}</p>}
                {t.action && (
                  <button className="mt-1 text-sm font-medium text-accent hover:underline" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                    {t.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Dismiss" className="rounded p-0.5 text-faint hover:text-ink" onClick={() => dismiss(t.id)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return {
    success: (title: string, body?: string) => c.push({ kind: "success", title, body }),
    error: (title: string, body?: string) => c.push({ kind: "error", title, body }),
    info: (title: string, body?: string) => c.push({ kind: "info", title, body }),
    warning: (title: string, body?: string) => c.push({ kind: "warning", title, body }),
    push: c.push,
  };
}
