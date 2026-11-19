import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, ChevronsUpDown, Inbox, LayoutGrid, Menu as MenuIcon, Monitor, Moon, Send, Settings, Sun, Target, X } from "lucide-react";
import { useMessages, useSettings } from "../api/hooks";
import { Wordmark } from "../components/brand/Orb";
import { Menu } from "../components/ui/Menu";
import { LiveDot, Pill } from "../components/ui/Pill";
import { cn } from "../lib/cn";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useWorker } from "../lib/worker";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/app/campaigns", label: "Campaigns", icon: Target },
  { to: "/app/review", label: "Review", icon: Inbox, badge: "review" as const },
  { to: "/app/sent", label: "Sent", icon: Send },
  { to: "/app/playbooks", label: "Playbooks", icon: BookOpen },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const review = useMessages("needs_review");
  const count = review.data?.length ?? 0;
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex h-9 items-center gap-2.5 rounded-control px-2.5 text-[14px] transition-colors",
              isActive ? "bg-active font-medium text-ink" : "text-muted hover:bg-active/60 hover:text-ink",
            )
          }
        >
          <n.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">{n.label}</span>
          {n.badge === "review" && count > 0 && (
            <span className="num rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white" aria-label={`${count} drafts need review`}>
              {count}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeButton() {
  const { pref, cycle } = useTheme();
  const Icon = pref === "system" ? Monitor : pref === "light" ? Sun : Moon;
  const label = `Theme: ${pref}. Switch theme`;
  return (
    <button onClick={cycle} aria-label={label} title={label} className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-active hover:text-ink">
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function SidebarFooter() {
  const { session } = useSession();
  const { pending } = useWorker();
  const settings = useSettings();
  const nav = useNavigate();
  const mode = settings.data?.demo_mode ? "Demo mode" : settings.data?.sending.mode === "live" ? "Live sending" : "Test mode";
  return (
    <div className="mt-auto flex flex-col gap-2 pt-4">
      <div className="flex min-h-[22px] items-center gap-2 px-2.5">
        {pending > 0 ? (
          <LiveDot label={<span className="num">Processing {pending}…</span>} />
        ) : (
          settings.data && (
            <Pill tone={settings.data.demo_mode ? "live" : settings.data.sending.mode === "live" ? "positive" : "warning"} dot>
              {mode}
            </Pill>
          )
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-line pt-3">
        <Menu
          label="Account"
          align="start"
          items={[
            { label: "Settings", icon: <Settings className="h-4 w-4" />, onSelect: () => nav("/app/settings") },
          ]}
          trigger={(p) => (
            <button {...p} className="flex min-w-0 flex-1 items-center gap-2 rounded-control px-1.5 py-1.5 text-left hover:bg-active">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">
                {session.workspace.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{session.workspace.name}</span>
                <span className="block truncate text-xs text-faint">Private to this browser</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            </button>
          )}
        />
        <ThemeButton />
      </div>
    </div>
  );
}

function Brand() {
  const { session } = useSession();
  return (
    <div className="px-2.5 pb-5 pt-1">
      <Wordmark />
      <div className="mt-1 truncate pl-[26px] text-xs text-faint">{session.workspace.name}</div>
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { pending } = useWorker();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="min-h-full lg:pl-[240px]">
      {/* dark mode: a faint orb glow in the top-right corner of the work surface */}
      <div aria-hidden className="pointer-events-none fixed right-0 top-0 hidden h-[520px] w-[720px] dark:block" style={{ background: "radial-gradient(closest-side at 70% 30%, rgba(47,75,255,.16), rgba(94,200,240,.05) 55%, transparent 100%)" }} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-[240px] flex-col border-r border-line bg-ground/80 px-3 py-4 lg:flex">
        <Brand />
        <NavItems />
        <SidebarFooter />
      </aside>
      {/* phone and tablet top bar */}
      <div className="sticky top-0 z-30 flex h-[52px] items-center gap-2 border-b border-line bg-ground/95 px-3 lg:hidden">
        <button aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-control text-muted hover:bg-active">
          <MenuIcon className="h-5 w-5" />
        </button>
        <Wordmark size="sm" />
        <div className="ml-auto">{pending > 0 && <LiveDot label={<span className="num">{pending}</span>} />}</div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-[#06071a]/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] animate-slide-in flex-col bg-ground px-3 py-4 shadow-float">
            <div className="flex items-start">
              <Brand />
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="ml-auto rounded p-2 text-muted hover:bg-active">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setOpen(false)} />
            <SidebarFooter />
          </div>
        </div>
      )}
      <main id="main" className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
