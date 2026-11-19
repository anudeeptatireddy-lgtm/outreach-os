import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api/client";
import { AppShell } from "./layout/AppShell";
import { ConfirmProvider } from "./components/ui/Dialog";
import { FullPageSpinner } from "./components/ui/Feedback";
import { RequireSession, useMe } from "./lib/session";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import { WorkerPumpProvider } from "./lib/worker";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/auth/Login"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CampaignsList = lazy(() => import("./pages/campaigns/CampaignsList"));
const CampaignDetail = lazy(() => import("./pages/campaigns/CampaignDetail"));
const ProspectPage = lazy(() => import("./pages/prospect/ProspectPage"));
const ReviewQueue = lazy(() => import("./pages/review/ReviewQueue"));
const Sent = lazy(() => import("./pages/Sent"));
const PlaybooksList = lazy(() => import("./pages/playbooks/PlaybooksList"));
const PlaybookEditor = lazy(() => import("./pages/playbooks/PlaybookEditor"));
const SettingsPage = lazy(() => import("./pages/settings/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

function Authed({ children, shell = true }: { children: ReactNode; shell?: boolean }) {
  return (
    <RequireSession>
      <WorkerPumpProvider enabled>{shell ? <AppShell>{children}</AppShell> : children}</WorkerPumpProvider>
    </RequireSession>
  );
}

/** "/" is the public landing page; signed-in visitors go straight to the app. */
function Home() {
  const me = useMe();
  if (me.isPending) return <FullPageSpinner label="Loading" />;
  if (me.data) return <Navigate to={me.data.workspace.onboarded ? "/app" : "/onboarding"} replace />;
  return <Landing />;
}

/** Old un-prefixed links keep working. */
function Legacy({ to }: { to: string }) {
  const p = useParams();
  return <Navigate to={to.replace(":id", p.id ?? "")} replace />;
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <Suspense fallback={<FullPageSpinner label="Loading" />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/onboarding" element={<Authed shell={false}><Onboarding /></Authed>} />
                  <Route path="/app" element={<Authed><Dashboard /></Authed>} />
                  <Route path="/app/campaigns" element={<Authed><CampaignsList /></Authed>} />
                  <Route path="/app/campaigns/:id" element={<Authed><CampaignDetail /></Authed>} />
                  <Route path="/app/prospects/:id" element={<Authed><ProspectPage /></Authed>} />
                  <Route path="/app/review" element={<Authed><ReviewQueue /></Authed>} />
                  <Route path="/app/sent" element={<Authed><Sent /></Authed>} />
                  <Route path="/app/playbooks" element={<Authed><PlaybooksList /></Authed>} />
                  <Route path="/app/playbooks/:id" element={<Authed><PlaybookEditor /></Authed>} />
                  <Route path="/app/settings" element={<Authed><SettingsPage /></Authed>} />
                  <Route path="/campaigns/:id" element={<Legacy to="/app/campaigns/:id" />} />
                  <Route path="/prospects/:id" element={<Legacy to="/app/prospects/:id" />} />
                  <Route path="/review" element={<Navigate to="/app/review" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
