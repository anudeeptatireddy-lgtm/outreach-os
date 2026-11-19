import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useCampaigns } from "../../api/hooks";
import type { Campaign } from "../../api/types";
import { Orb } from "../../components/brand/Orb";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/Feedback";
import { PageHeader, Panel } from "../../components/ui/Panel";
import { Pill, type Tone } from "../../components/ui/Pill";
import { num, plural, shortDate } from "../../lib/format";
import { NewCampaignDialog } from "./NewCampaignDialog";
import { CampaignProgress } from "./progress";

export const CAMPAIGN_TONE: Record<Campaign["status"], Tone> = { running: "live", paused: "warning", completed: "neutral" };
const LABEL: Record<Campaign["status"], string> = { running: "Running", paused: "Paused", completed: "Completed" };

export function CampaignStatusPill({ status }: { status: Campaign["status"] }) {
  return <Pill tone={CAMPAIGN_TONE[status]} dot pulse={status === "running"}>{LABEL[status]}</Pill>;
}

export default function CampaignsList() {
  const q = useCampaigns();
  const [open, setOpen] = useState(false);
  const newBtn = <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New campaign</Button>;
  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle={q.data ? `${plural(q.data.length, "campaign")} · ${num(q.data.reduce((a, c) => a + c.stats.total, 0))} companies` : "Lists of companies researched with one playbook"}
        actions={newBtn}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} what="campaigns" />
      ) : (
        <Panel className="overflow-hidden">
          {q.isPending ? (
            <SkeletonRows rows={3} />
          ) : q.data.length === 0 ? (
            <EmptyState
              icon={<Orb variant="small" />}
              title="No campaigns yet"
              body="A campaign is a list of company domains and a playbook. Paste a few domains to see the decision trail for each."
              action={newBtn}
            />
          ) : (
            <table className="w-full text-left">
              <thead className="hidden text-xs text-muted md:table-header-group">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-normal">Campaign</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  <th className="w-[22%] px-3 py-2.5 font-normal">Progress</th>
                  <th className="px-3 py-2.5 text-right font-normal">Companies</th>
                  <th className="px-3 py-2.5 text-right font-normal">To review</th>
                  <th className="px-3 py-2.5 text-right font-normal">Sent</th>
                  <th className="px-4 py-2.5 text-right font-normal">Replied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {q.data.map((c) => (
                  <tr key={c.id} className="group relative hover:bg-raised">
                    <td className="px-4 py-3">
                      <Link to={`/app/campaigns/${c.id}`} className="font-medium after:absolute after:inset-0 hover:underline">{c.name}</Link>
                      <div className="mt-0.5 text-xs text-muted">
                        {c.playbook.name} · started {shortDate(c.created_at)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
                        <CampaignStatusPill status={c.status} />
                        <span className="num text-xs text-muted">{c.stats.total} companies · {c.stats.needs_review} to review · {c.stats.sent} sent · {c.stats.replied} replied</span>
                        <CampaignProgress s={c.stats} className="w-full" />
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell"><CampaignStatusPill status={c.status} /></td>
                    <td className="hidden px-3 py-3 md:table-cell"><CampaignProgress s={c.stats} /></td>
                    <td className="num hidden px-3 py-3 text-right md:table-cell">{c.stats.total}</td>
                    <td className="num hidden px-3 py-3 text-right md:table-cell">{c.stats.needs_review > 0 ? <span className="font-medium text-accent">{c.stats.needs_review}</span> : <span className="text-faint">0</span>}</td>
                    <td className="num hidden px-3 py-3 text-right md:table-cell">{c.stats.sent}</td>
                    <td className="num hidden px-4 py-3 text-right md:table-cell">{c.stats.replied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
      <NewCampaignDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
