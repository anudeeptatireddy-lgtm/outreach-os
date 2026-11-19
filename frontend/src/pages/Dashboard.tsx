import { Link } from "react-router-dom";
import { ArrowRight, Inbox } from "lucide-react";
import { useActivity, useOverview, useSettings } from "../api/hooks";
import type { Event } from "../api/types";
import { Orb } from "../components/brand/Orb";
import { Button } from "../components/ui/Button";
import { ErrorState, Notice, Skeleton } from "../components/ui/Feedback";
import { Panel, PanelHeader } from "../components/ui/Panel";
import { cn } from "../lib/cn";
import { num, pct, plural, relTime } from "../lib/format";
import { useSession } from "../lib/session";
import { SentChart, SentChartLegend } from "./dashboard/SentChart";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const LEVEL_DOT: Record<Event["level"], string> = {
  info: "bg-faint",
  success: "bg-positive",
  warning: "bg-warning",
  error: "bg-negative",
};

function HeaderCard() {
  const { session } = useSession();
  const ov = useOverview();
  const n = ov.data?.needs_review ?? 0;
  const first = session.user.name.split(" ")[0];
  return (
    <section className="grain relative mb-6 overflow-hidden rounded-xl border border-line bg-surface">
      <Orb variant="card" className="absolute -right-24 -top-28 opacity-90 sm:-right-10" />
      <div className="relative flex flex-col gap-5 px-5 py-7 sm:px-8 sm:py-9">
        <div>
          <p className="font-mono text-xs text-muted">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="mt-2 max-w-[22ch] font-display text-[34px] leading-[38px] tracking-[-0.015em] sm:text-[42px] sm:leading-[46px]">
            {greeting()}, {first}
            {ov.isPending ? "." : n > 0 ? <> — {plural(n, "draft")} {n === 1 ? "needs" : "need"} your review.</> : <> — your review queue is clear.</>}
          </h1>
          {ov.data && (
            <p className="mt-2 max-w-[56ch] text-[14px] text-muted">
              Every draft cites quotes from the company's own pages. Approve the ones you would defend.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {n > 0 ? (
            <Link to="/app/review">
              <Button variant="primary" icon={<Inbox className="h-4 w-4" />}>Review {plural(n, "draft")}</Button>
            </Link>
          ) : (
            <Link to="/app/campaigns">
              <Button variant="primary">Open campaigns</Button>
            </Link>
          )}
          <Link to="/app/campaigns">
            <Button>All campaigns</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function ModeBanners() {
  const s = useSettings();
  if (!s.data) return null;
  return (
    <div className="mb-6 flex flex-col gap-2 empty:hidden">
      {s.data.demo_mode && (
        <Notice tone="info" title="Demo mode is on" action={<Link className="font-medium underline" to="/app/settings?tab=demo">Turn off</Link>}>
          The pipeline uses built-in sample data. No API keys are used and nothing is really sent.
        </Notice>
      )}
      {!s.data.demo_mode && s.data.sending.mode === "test" && (
        <Notice tone="warning" title="Test mode" action={<Link className="font-medium underline" to="/app/settings?tab=sending">Sending settings</Link>}>
          Every email goes to {s.data.sending.owner_email || "your own inbox"}; the real recipient is shown in the subject.
        </Notice>
      )}
    </div>
  );
}

function Funnel() {
  const ov = useOverview();
  if (ov.isError) return <ErrorState error={ov.error} onRetry={() => ov.refetch()} what="the funnel" />;
  const steps = ov.data?.funnel ?? [];
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <Panel>
      <PanelHeader title="Pipeline" meta="All campaigns" />
      <ol className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3 xl:grid-cols-6">
        {(ov.isPending ? Array.from({ length: 6 }, (_, i) => ({ key: String(i), label: "", count: 0 })) : steps).map((s, i) => {
          const prev = i > 0 ? steps[i - 1]?.count ?? 0 : null;
          const conv = prev ? s.count / prev : null;
          return (
            <li key={s.key} className="bg-surface px-4 py-4">
              <div className="flex items-center justify-between text-[13px] text-muted">
                {ov.isPending ? <Skeleton className="h-3 w-16" /> : <span>{s.label}</span>}
                {conv !== null && !ov.isPending && <span className="num font-mono text-[11px] text-faint">{pct(conv)}</span>}
              </div>
              <div className="num mt-2 font-display text-[34px] leading-none">{ov.isPending ? <Skeleton className="h-7 w-10" /> : num(s.count)}</div>
              <div className="mt-3 h-1 rounded-full bg-active">
                <div className={cn("h-1 rounded-full", i === 5 ? "bg-positive" : "bg-accent")} style={{ width: `${(s.count / top) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Kpis() {
  const ov = useOverview();
  const d = ov.data;
  const sent = d?.funnel.find((f) => f.key === "sent")?.count ?? 0;
  const replied = d?.funnel.find((f) => f.key === "replied")?.count ?? 0;
  const drafted = d?.funnel.find((f) => f.key === "drafted")?.count ?? 0;
  const cells = [
    { label: "Needs review", value: d ? num(d.needs_review) : null, sub: d ? (d.needs_review ? <Link to="/app/review" className="text-accent hover:underline">Open the queue</Link> : "Nothing waiting") : null },
    { label: "Reply rate", value: d ? pct(d.rates.reply, 1) : null, sub: d ? `${replied} of ${sent} sent` : null },
    { label: "Hours saved", value: d ? num(d.hours_saved, 1) : null, sub: d ? `${drafted} drafts × 17.5 min of research` : null },
    { label: "Bounce rate", value: d ? pct(d.rates.bounce, 1) : null, sub: d ? `Qualification rate ${pct(d.rates.qualification)}` : null },
  ];
  return (
    <Panel className="grid grid-cols-2 gap-px overflow-hidden bg-rule lg:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface px-4 py-4">
          <div className="text-[13px] text-muted">{c.label}</div>
          <div className="num mt-1.5 font-display text-[34px] leading-none">{c.value ?? <Skeleton className="h-7 w-14" />}</div>
          <div className="mt-2 text-xs text-muted">{c.sub ?? <Skeleton className="h-3 w-24" />}</div>
        </div>
      ))}
    </Panel>
  );
}

function Activity() {
  const act = useActivity(undefined, 12);
  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Recent activity" />
      {act.isError ? (
        <div className="p-4"><ErrorState error={act.error} onRetry={() => act.refetch()} what="activity" /></div>
      ) : act.isPending ? (
        <ul className="divide-y divide-rule">{Array.from({ length: 6 }).map((_, i) => <li key={i} className="px-4 py-3"><Skeleton className="h-3.5 w-3/4" /></li>)}</ul>
      ) : act.data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No activity yet. Create a campaign and the pipeline's steps show up here.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {act.data.slice(0, 9).map((e) => {
            const inner = (
              <>
                <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[e.level])} aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{e.message}</span>
                <time className="num shrink-0 text-xs text-faint" dateTime={e.at}>{relTime(e.at)}</time>
              </>
            );
            return (
              <li key={e.id}>
                {e.prospect_id ? (
                  <Link to={`/app/prospects/${e.prospect_id}`} className="flex gap-2.5 px-4 py-2.5 hover:bg-raised">{inner}</Link>
                ) : (
                  <div className="flex gap-2.5 px-4 py-2.5">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Chart() {
  const ov = useOverview();
  const total = ov.data?.sent_by_day.reduce((a, d) => a + d.sent, 0) ?? 0;
  const replies = ov.data?.sent_by_day.reduce((a, d) => a + d.replied, 0) ?? 0;
  return (
    <Panel>
      <PanelHeader title="Sent and replied" meta={ov.data ? `Last 14 days · ${total} sent · ${replies} replied` : "Last 14 days"} actions={<SentChartLegend />} />
      <div className="px-4 pb-3 pt-4">
        {ov.isError ? <ErrorState error={ov.error} onRetry={() => ov.refetch()} what="the chart" /> : ov.isPending ? <Skeleton className="h-[200px] w-full" /> : <SentChart data={ov.data.sent_by_day} />}
      </div>
    </Panel>
  );
}

export default function Dashboard() {
  return (
    <div>
      <HeaderCard />
      <ModeBanners />
      <div className="flex flex-col gap-6">
        <Funnel />
        <Kpis />
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Chart />
          <Activity />
        </div>
        <div className="flex justify-end">
          <Link to="/app/campaigns" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Go to campaigns <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
