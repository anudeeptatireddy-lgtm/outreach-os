// The worker pump. On Vercel there is no background worker, so the open dashboard drives the
// pipeline: call POST /api/worker/tick; while pending > 0 call it again as soon as it returns
// (one request in flight); when idle, tick every 15 s. Mutations call kick() to start at once.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { invalidateWork } from "../api/hooks";

type Ctx = { pending: number; kick: () => void };
const WorkerCtx = createContext<Ctx>({ pending: 0, kick: () => {} });

const IDLE_MS = 15_000;
const ERROR_BACKOFF_MS = 10_000;

export function WorkerPumpProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(0);
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  const again = useRef(false);

  const schedule = useCallback((ms: number, fn: () => void) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  }, []);

  const run = useCallback(async () => {
    if (!alive.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    inFlight.current = true;
    let next = IDLE_MS;
    try {
      const r = await api.workerTick();
      setPending(r.pending);
      if (r.processed > 0 || r.pending > 0) invalidateWork(qc);
      next = r.pending > 0 ? 0 : IDLE_MS;
    } catch {
      next = ERROR_BACKOFF_MS;
    } finally {
      inFlight.current = false;
    }
    if (!alive.current) return;
    if (again.current) {
      again.current = false;
      next = 0;
    }
    schedule(next, () => void run());
  }, [qc, schedule]);

  useEffect(() => {
    alive.current = enabled;
    if (!enabled) return;
    void run();
    return () => {
      alive.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [enabled, run]);

  const kick = useCallback(() => {
    if (enabled) void run();
  }, [enabled, run]);

  return <WorkerCtx.Provider value={{ pending, kick }}>{children}</WorkerCtx.Provider>;
}

export const useWorker = () => useContext(WorkerCtx);
