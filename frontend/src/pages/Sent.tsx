import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { MessageSquareReply } from "lucide-react";
import { api, errorMessage } from "../api/client";
import { invalidateWork, useMessages, useQueryClient } from "../api/hooks";
import type { Message, MessageStatus } from "../api/types";
import { Orb } from "../components/brand/Orb";
import { Button } from "../components/ui/Button";
import { useConfirm } from "../components/ui/Dialog";
import { EmptyState, ErrorState, SkeletonRows } from "../components/ui/Feedback";
import { PageHeader, Panel } from "../components/ui/Panel";
import { MessagePill, Pill } from "../components/ui/Pill";
import { Chips } from "../components/ui/Tabs";
import { dateTime, relTime } from "../lib/format";
import { useToast } from "../lib/toast";

type Filter = "all" | "scheduled" | "sent" | "problems";
const OUTBOX: MessageStatus[] = ["approved", "scheduled", "sending", "sent", "failed", "bounced", "cancelled"];
const IN: Record<Filter, MessageStatus[]> = {
  all: OUTBOX,
  scheduled: ["approved", "scheduled", "sending"],
  sent: ["sent"],
  problems: ["failed", "bounced"],
};

function When({ m }: { m: Message }) {
  const t = m.sent_at ?? m.scheduled_at;
  if (!t) return <span className="text-faint">—</span>;
  const future = new Date(t).getTime() > Date.now();
  return (
    <span title={dateTime(t)}>
      <span className="text-xs text-muted">{m.sent_at ? "Sent" : future ? "Sends" : "Due"} </span>
      <span className="num">{relTime(t)}</span>
    </span>
  );
}

function Delivered({ m }: { m: Message }) {
  if (m.mode === "demo") return <Pill tone="live">demo, not sent</Pill>;
  if (!m.delivered_to) return <span className="text-faint">—</span>;
  return (
    <span className="min-w-0">
      <span className="block truncate font-mono text-xs">{m.delivered_to}</span>
      {m.mode === "test" && <span className="text-xs text-warning-ink">test mode</span>}
      {m.mode === "live" && <span className="text-xs text-positive">live</span>}
    </span>
  );
}

export default function Sent() {
  const q = useMessages();
  const [filter, setFilter] = useState<Filter>("all");
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const rows = useMemo(() => (q.data ?? []).filter((m) => IN[filter].includes(m.status)), [q.data, filter]);
  const count = (f: Filter) => (q.data ?? []).filter((m) => IN[f].includes(m.status)).length;

  const replied = useMutation({
    mutationFn: (id: number) => api.markReplied(id),
    onSuccess: () => {
      invalidateWork(qc);
      toast.success("Marked as replied", "Pending follow-ups for this person are cancelled.");
    },
    onError: (e) => toast.error("Couldn't mark as replied", errorMessage(e)),
  });
  const mark = async (m: Message) => {
    const ok = await confirm({ title: `Mark ${m.to.name} as replied?`, body: "This stops the sequence: scheduled follow-ups are cancelled.", confirm: "Mark replied" });
    if (ok) replied.mutate(m.id);
  };

  return (
    <div>
      <PageHeader title="Sent" subtitle="Approved, scheduled and sent emails, with where each one was really delivered." />
      <div className="mb-3">
        <Chips
          label="Filter outbox"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: count("all") },
            { value: "scheduled", label: "Scheduled", count: count("scheduled") },
            { value: "sent", label: "Sent", count: count("sent") },
            { value: "problems", label: "Bounced or failed", count: count("problems") },
          ]}
        />
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} what="sent mail" />
      ) : (
        <Panel className="overflow-hidden">
          {q.isPending ? (
            <SkeletonRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Orb variant="small" />}
              title={filter === "problems" ? "No bounces or failures" : "Nothing here yet"}
              body={filter === "problems" ? "Every email so far was accepted by the receiving server." : "Approved drafts show up here with their send time."}
              action={filter === "all" ? <Link to="/app/review"><Button>Open review</Button></Link> : undefined}
            />
          ) : (
            <table className="w-full table-fixed text-left">
              <thead className="hidden text-xs text-muted md:table-header-group">
                <tr className="border-b border-line">
                  <th className="w-[24%] px-4 py-2.5 font-normal">Recipient</th>
                  <th className="px-3 py-2.5 font-normal">Subject</th>
                  <th className="w-[12%] px-3 py-2.5 font-normal">Status</th>
                  <th className="w-[12%] px-3 py-2.5 text-right font-normal">When</th>
                  <th className="w-[19%] px-3 py-2.5 font-normal">Delivered to</th>
                  <th className="w-[112px] px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((m) => (
                  <tr key={m.id} className="align-top hover:bg-raised md:align-middle">
                    <td className="px-4 py-3">
                      <div className="truncate font-medium">{m.to.name}</div>
                      <div className="truncate text-xs text-muted">
                        <Link to={`/app/prospects/${m.prospect_id}`} className="hover:underline">{m.company.name ?? m.company.domain}</Link> · {m.to.title}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs md:hidden">
                        <MessagePill status={m.status} />
                        <When m={m} />
                        <span className="w-full truncate text-[13px]">{m.step > 0 && `Follow-up ${m.step} · `}{m.subject}</span>
                        {m.status === "sent" && <button className="font-medium text-accent" onClick={() => mark(m)}>Mark replied</button>}
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <div className="flex min-w-0 items-center gap-2">
                        {m.step > 0 && <Pill tone="outline">Follow-up {m.step}</Pill>}
                        <span className="truncate">{m.subject}</span>
                      </div>
                      {m.error && <div className="mt-0.5 truncate text-xs text-negative" title={m.error}>{m.error}</div>}
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell"><MessagePill status={m.status} /></td>
                    <td className="hidden px-3 py-3 text-right text-[13px] md:table-cell"><When m={m} /></td>
                    <td className="hidden px-3 py-3 md:table-cell"><Delivered m={m} /></td>
                    <td className="hidden px-4 py-3 text-right md:table-cell">
                      {m.status === "sent" && (
                        <Button size="sm" variant="ghost" icon={<MessageSquareReply className="h-3.5 w-3.5" />} onClick={() => mark(m)}>Replied</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}
