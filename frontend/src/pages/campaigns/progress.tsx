import type { CampaignStats } from "../../api/types";

/** One stacked bar over a campaign's companies: sent, waiting on you, dropped, in flight. */
export function CampaignProgress({ s, className }: { s: CampaignStats; className?: string }) {
  const total = Math.max(1, s.total);
  const segs = [
    { n: s.sent, cls: "bg-positive", label: "sent" },
    { n: s.needs_review + s.approved, cls: "bg-accent", label: "waiting on you or scheduled" },
    { n: s.no_contact + s.insufficient_data, cls: "bg-warning", label: "need attention" },
    { n: s.disqualified + s.failed, cls: "bg-faint/50", label: "dropped" },
    { n: s.queued + s.researching, cls: "bg-live", label: "in research" },
  ];
  const label = segs.filter((x) => x.n).map((x) => `${x.n} ${x.label}`).join(", ") || "No companies yet";
  return (
    <div className={className} role="img" aria-label={label} title={label}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-active">
        {segs.map((x) => x.n > 0 && <div key={x.label} className={x.cls} style={{ width: `${(x.n / total) * 100}%` }} />)}
      </div>
    </div>
  );
}
