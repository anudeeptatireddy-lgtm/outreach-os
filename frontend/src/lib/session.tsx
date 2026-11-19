import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { qk } from "../api/hooks";
import type { Session } from "../api/types";
import { FullPageSpinner } from "../components/ui/Feedback";

type Ctx = { session: Session; refresh: () => Promise<unknown> };
const SessionCtx = createContext<Ctx | null>(null);

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        // No sign-in: a first visit gets its own guest workspace.
        if (e instanceof ApiError && e.status === 401) return await api.guest();
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

/** Gate for the app: creates a guest workspace on first visit, onboarding until it is onboarded. */
export function RequireSession({ children }: { children: ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const loc = useLocation();
  if (me.isPending) return <FullPageSpinner label="Loading your workspace" />;
  if (me.isError) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Can't reach outreach-os.</p>
          <p className="mt-1 text-sm text-muted">The server did not answer. Check that the backend is running.</p>
          <button className="mt-3 text-sm font-medium text-accent hover:underline" onClick={() => me.refetch()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!me.data) return null;
  try {
    sessionStorage.removeItem("guest-reload");
  } catch {
    /* storage unavailable */
  }
  if (!me.data.workspace.onboarded && loc.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return (
    <SessionCtx.Provider value={{ session: me.data, refresh: () => qc.invalidateQueries({ queryKey: qk.me }) }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside RequireSession");
  return c;
}
