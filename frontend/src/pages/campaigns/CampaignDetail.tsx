import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Download, MoreHorizontal, Pause, Play, Plus, Search, Trash2 } from "lucide-react";
import { api, downloadCampaignCsv, errorMessage } from "../../api/client";
import { invalidateWork, qk, useCampaign, usePlaybook, useProspects, useQueryClient } from "../../api/hooks";
import type { ProspectRow, ProspectStatus } from "../../api/types";
import { ScoreBar, ScoreText } from "../../components/ScoreBar";
import { Button, IconButton } from "../../components/ui/Button";
import { useConfirm } from "../../components/ui/Dialog";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Field";
import { Menu } from "../../components/ui/Menu";
import { PageHeader, Panel } from "../../components/ui/Panel";
import { LiveDot, StatusPill } from "../../components/ui/Pill";
import { Chips } from "../../components/ui/Tabs";
import { cn } from "../../lib/cn";
import { PROSPECT_STATUS_LABEL, STAGE_LABEL, relTime, shortDate } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { useWorker } from "../../lib/worker";
import { CampaignStatusPill } from "./CampaignsList";
import { AddCompaniesDialog } from "./NewCampaignDialog";
import { CampaignProgress } from "./progress";

const FILTERS: (ProspectStatus | "")[] = ["", "needs_review", "researching", "queued", "approved", "sent", "replied", "no_contact", "insufficient_data", "rejected_draft", "disqualified", "bounced", "unsubscribed", "completed", "failed"];

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return d;
}

function ContactCell({ r }: { r: ProspectRow }) {
  if (r.contact)
    return (
      <div className="min-w-0">
        <div className="truncate">{r.contact.name}</div>
        <div className="truncate text-xs text-muted">
          {r.contact.title}
          {r.contact.source !== "hunter" && <span className="text-faint"> · {r.contact.source}</span>}
        </div>
      </div>
    );
  return <span className="text-faint">—</span>;
}

function ScoreCell({ r, q, rj }: { r: ProspectRow; q: number; rj: number }) {
  if (!r.score) return <span className="text-faint">—</span>;
  return (
    <div className="flex w-full min-w-[120px] flex-col gap-1.5">
      <ScoreText min={r.score.min} max={r.score.max} expected={r.score.expected} />
      <ScoreBar min={r.score.min} max={r.score.max} expected={r.score.expected} qualifyMin={q} rejectMax={rj} muted={r.status === "disqualified"} />
    </div>
  );
}

export default function CampaignDetail() {
  const id = Number(useParams().id);
  const camp = useCampaign(id);
  const pb = usePlaybook(camp.data?.playbook.id ?? NaN);
  const [status, setStatus] = useState<ProspectStatus | "">("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const all = useProspects(id, "", "");
  const busy = !!all.data?.some((p) => p.status === "queued" || p.status === "researching");
  const rows = useProspects(id, status, q, busy ? 3000 : false);
  // keep the unfiltered list (counts, polling) fresh too
  useProspects(id, "", "", busy ? 3000 : false);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { kick } = useWorker();

  useEffect(() => {
    if (busy) void qc.invalidateQueries({ queryKey: qk.campaign(id) });
  }, [all.dataUpdatedAt, busy, id, qc]);

  const toggle = useMutation({
    mutationFn: () => api.patchCampaign(id, { status: camp.data?.status === "running" ? "paused" : "running" }),
    onSuccess: (c) => {
      qc.setQueryData(qk.campaign(id), c);
      invalidateWork(qc);
      if (c.status === "running") kick();
      toast.success(c.status === "paused" ? "Campaign paused" : "Campaign resumed", c.status === "paused" ? "Research and sending stop until you resume." : undefined);
    },
    onError: (e) => toast.error("Couldn't change the campaign", errorMessage(e)),
  });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of all.data ?? []) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return m;
  }, [all.data]);

  const th = pb.data?.icp.thresholds;
  const qmin = th?.qualify_min ?? 60;
  const rmax = th?.reject_max ?? 45;

  if (camp.isError) return <ErrorState error={camp.error} onRetry={() => camp.refetch()} what="this campaign" />;
  const c = camp.data;
  const s = c?.stats;

  const remove = async () => {
    if (!c) return;
    const ok = await confirm({ title: `Delete "${c.name}"?`, body: `This deletes ${c.stats.total} companies, their decision trails and unsent drafts. Sent emails stay sent. This cannot be undone.`, confirm: "Delete campaign", danger: true });
    if (!ok) return;
    try {
      await api.deleteCampaign(id);
      invalidateWork(qc);
      toast.success("Campaign deleted");
      nav("/app/campaigns");
    } catch (e) {
      toast.error("Couldn't delete", errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        back={<Link to="/app/campaigns" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Campaigns</Link>}
        title={c ? c.name : <Skeleton className="h-8 w-72" />}
        subtitle={
          c && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CampaignStatusPill status={c.status} />
              <span>
                <Link to={`/app/playbooks/${c.playbook.id}`} className="hover:underline">{c.playbook.name}</Link> · started {shortDate(c.created_at)} ·{" "}
                {c.followups.length ? `${c.followups.length} follow-up${c.followups.length > 1 ? "s" : ""} (${c.followups.map((f) => `${f.delay_days}d`).join(", ")})` : "no follow-ups"}
                {c.auto_approve && " · auto-approve on"}
                {!c.hunter_live && " · contacts from CSV or by hand"}
              </span>
              {busy && <LiveDot label="Researching" />}
            </span>
          )
        }
        actions={
          c && (
            <>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add companies</Button>
              <Button icon={c.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} loading={toggle.isPending} onClick={() => toggle.mutate()} disabled={c.status === "completed"}>
                {c.status === "running" ? "Pause" : "Resume"}
              </Button>
              <Menu
                label="Campaign actions"
                items={[
                  { label: "Export CSV", icon: <Download className="h-4 w-4" />, onSelect: () => void downloadCampaignCsv(id, `${c.name.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`) },
                  "separator",
                  { label: "Delete campaign", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: remove },
                ]}
                trigger={(p) => (
                  <IconButton label="More campaign actions" {...p} className="border border-control bg-surface">
                    <MoreHorizontal className="h-4 w-4" />
                  </IconButton>
                )}
              />
            </>
          )
        }
      />

      <Panel className="mb-6 overflow-hidden">
        <div className="grid grid-cols-3 gap-px bg-rule sm:grid-cols-6">
          {[
            { label: "Companies", v: s?.total },
            { label: "Qualified", v: s?.qualified },
            { label: "To review", v: s?.needs_review, accent: true },
            { label: "Sent", v: s?.sent },
            { label: "Replied", v: s?.replied },
            { label: "In research", v: s ? s.queued + s.researching : undefined, live: true },
          ].map((k) => (
            <div key={k.label} className="bg-surface px-4 py-3">
              <div className="text-xs text-muted">{k.label}</div>
              <div className={cn("num mt-1 font-display text-[28px] leading-none", k.accent && (k.v ?? 0) > 0 && "text-accent", k.live && (k.v ?? 0) > 0 && "text-live-ink")}>
                {k.v ?? <Skeleton className="h-6 w-8" />}
              </div>
            </div>
          ))}
        </div>
        {s && <CampaignProgress s={s} className="px-4 py-3" />}
      </Panel>

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <Chips
            label="Filter by status"
            value={status}
            onChange={setStatus}
            options={FILTERS.filter((f) => f === "" || counts.get(f)).map((f) => ({ value: f, label: f ? PROSPECT_STATUS_LABEL[f] : "All", count: f ? counts.get(f) ?? 0 : all.data?.length }))}
          />
        </div>
        <div className="relative md:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label="Search companies and contacts" placeholder="Search companies or people" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Panel className="overflow-hidden">
        {rows.isError ? (
          <div className="p-4"><ErrorState error={rows.error} onRetry={() => rows.refetch()} what="companies" /></div>
        ) : rows.isPending ? (
          <SkeletonRows rows={6} />
        ) : rows.data.length === 0 ? (
          <EmptyState
            title={status || q ? "No companies match" : "No companies yet"}
            body={status || q ? "Try another filter or clear the search." : "Add domains and each one is researched, scored and drafted."}
            action={status || q ? <Button onClick={() => { setStatus(""); setSearch(""); }}>Clear filters</Button> : <Button variant="primary" onClick={() => setAdding(true)}>Add companies</Button>}
          />
        ) : (
          <table className="w-full table-fixed text-left">
            <thead className="hidden text-xs text-muted md:table-header-group">
              <tr className="border-b border-line">
                <th className="w-[22%] px-4 py-2.5 font-normal">Company</th>
                <th className="w-[17%] px-3 py-2.5 font-normal">Status</th>
                <th className="w-[17%] px-3 py-2.5 font-normal">Score</th>
                <th className="w-[20%] px-3 py-2.5 font-normal">Contact</th>
                <th className="px-4 py-2.5 font-normal">Next step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.data.map((r) => (
                <tr key={r.id} className="relative align-top hover:bg-raised md:align-middle">
                  <td className="px-4 py-3">
                    <Link to={`/app/prospects/${r.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
                      {r.company_name ?? r.domain}
                    </Link>
                    <div className="truncate font-mono text-xs text-muted">{r.domain}</div>
                    {/* phone: the other fields as a second line */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
                      <StatusPill status={r.status} stage={r.stage} />
                      {r.status === "researching" && r.stage && <span className="text-xs text-live-ink">{STAGE_LABEL[r.stage]}</span>}
                      {r.score && <ScoreText min={r.score.min} max={r.score.max} expected={r.score.expected} />}
                      {r.contact && <span className="text-xs text-muted">{r.contact.name}, {r.contact.title}</span>}
                      {r.next_step && <span className="text-xs text-ink">→ {r.next_step}</span>}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">
                    <div className="flex flex-col items-start gap-1">
                      <StatusPill status={r.status} stage={r.stage} />
                      {r.status === "researching" && r.stage && <span className="truncate text-xs text-live-ink">{STAGE_LABEL[r.stage]}…</span>}
                      {r.status === "failed" && r.error && <span className="line-clamp-2 text-xs text-negative">{r.error}</span>}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell"><ScoreCell r={r} q={qmin} rj={rmax} /></td>
                  <td className="hidden px-3 py-3 text-[13px] md:table-cell"><ContactCell r={r} /></td>
                  <td className="hidden px-4 py-3 text-[13px] md:table-cell">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate", r.status === "needs_review" ? "font-medium text-accent" : "text-ink")}>{r.next_step ?? <span className="text-faint">—</span>}</span>
                      <span className="num shrink-0 text-xs text-faint">{relTime(r.updated_at)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {rows.data && rows.data.length > 0 && <p className="mt-2 text-xs text-muted">Score bars show the range from the minimum to the maximum possible score; the tick is the expected score, the dark line is the qualify threshold ({qmin}).</p>}
      <AddCompaniesDialog open={adding} onClose={() => setAdding(false)} campaignId={id} />
    </div>
  );
}
