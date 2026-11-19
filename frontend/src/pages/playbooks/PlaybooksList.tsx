import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Copy, FileText, MoreHorizontal, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { api, errorMessage } from "../../api/client";
import { qk, usePlaybooks } from "../../api/hooks";
import type { PlaybookSummary } from "../../api/types";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog, useConfirm } from "../../components/ui/Dialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "../../components/ui/Feedback";
import { Field, Input } from "../../components/ui/Field";
import { Menu } from "../../components/ui/Menu";
import { PageHeader, Panel } from "../../components/ui/Panel";
import { Pill } from "../../components/ui/Pill";
import { cn } from "../../lib/cn";
import { plural, relTime } from "../../lib/format";
import { useToast } from "../../lib/toast";

type Mode = "sprinto" | "blank" | "generate";

const OPTIONS: { mode: Mode; title: string; body: string; icon: typeof FileText }[] = [
  { mode: "sprinto", title: "Sprinto template", body: "The full compliance rubric, nine personas and the email rules used in the demo.", icon: BookOpen },
  { mode: "blank", title: "Blank", body: "A minimal two-signal rubric. Fill in your own product, claims and personas.", icon: FileText },
  { mode: "generate", title: "Generate from my website", body: "We read your site and draft the product, claims, rubric and personas for you to edit.", icon: Wand2 },
];

function NewPlaybookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("sprinto");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: async () => {
      if (mode === "generate") return api.generatePlaybook(website.trim());
      return api.createPlaybook({ template: mode, name: name.trim() || undefined });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: qk.playbooks });
      qc.setQueryData(qk.playbook(p.id), p);
      toast.success(mode === "generate" ? "Playbook drafted from your website" : "Playbook created", "Review each tab before using it in a campaign.");
      onClose();
      nav(`/app/playbooks/${p.id}`);
    },
  });
  const close = () => {
    if (create.isPending) return;
    create.reset();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="New playbook"
      description="A playbook is what you sell, the claims an email may make, who qualifies and who to contact."
      footer={
        <>
          <Button onClick={close} disabled={create.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={mode === "generate" && !website.trim()}
            onClick={() => create.mutate()}
            icon={mode === "generate" ? <Sparkles className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          >
            {mode === "generate" ? (create.isPending ? "Reading your site…" : "Generate draft") : "Create playbook"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!(mode === "generate" && !website.trim())) create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <div role="radiogroup" aria-label="Start from" className="grid gap-2">
          {OPTIONS.map((o) => {
            const on = o.mode === mode;
            return (
              <button
                type="button"
                key={o.mode}
                role="radio"
                aria-checked={on}
                disabled={create.isPending}
                onClick={() => setMode(o.mode)}
                className={cn(
                  "flex items-start gap-3 rounded-card border px-3.5 py-3 text-left transition-colors",
                  on ? "border-accent bg-accent-soft/50" : "border-line hover:border-control hover:bg-raised",
                )}
              >
                <o.icon className={cn("mt-0.5 h-4 w-4 shrink-0", on ? "text-accent" : "text-faint")} aria-hidden />
                <span>
                  <span className="block font-medium">{o.title}</span>
                  <span className="block text-sm text-muted">{o.body}</span>
                </span>
              </button>
            );
          })}
        </div>
        {mode === "generate" ? (
          <Field label="Your company website" help="Your own site, not a prospect's. Demo mode returns a sample draft.">
            {(p) => <Input {...p} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourcompany.com" autoComplete="url" disabled={create.isPending} />}
          </Field>
        ) : (
          <Field label="Name" optional>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "sprinto" ? "Sprinto — Q1 fintech push" : "My product"} />}
          </Field>
        )}
        {create.isPending && mode === "generate" && (
          <div className="flex flex-col gap-1.5" role="status">
            <div className="h-1 overflow-hidden rounded-full bg-active">
              <div className="h-full w-full animate-pulse-dot rounded-full bg-live" />
            </div>
            <p className="text-xs text-live-ink">Reading {website.trim()} and drafting claims, rubric and personas…</p>
          </div>
        )}
        {create.isError && <Notice tone="negative" title="Couldn't create the playbook">{errorMessage(create.error)}</Notice>}
      </form>
    </Dialog>
  );
}

function Row({ p }: { p: PlaybookSummary }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const dup = useMutation({
    mutationFn: () => api.duplicatePlaybook(p.id),
    onSuccess: (copy) => {
      void qc.invalidateQueries({ queryKey: qk.playbooks });
      toast.success("Playbook duplicated", copy.name);
    },
    onError: (e) => toast.error("Couldn't duplicate", errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.deletePlaybook(p.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.playbooks });
      toast.success("Playbook deleted", p.name);
    },
    onError: (e) => toast.error("Can't delete this playbook", errorMessage(e)),
  });
  return (
    <li className="group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-raised/60">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/app/playbooks/${p.id}`} className="truncate font-medium text-ink after:absolute after:inset-0 hover:underline">
            {p.name}
          </Link>
          {p.template && <Pill tone="outline">{p.template === "sprinto" ? "Sprinto template" : p.template === "blank" ? "Blank" : p.template}</Pill>}
        </div>
        <div className="mt-0.5 truncate text-sm text-muted">
          {p.product_name || <span className="text-faint">No product name yet</span>}
          <span className="text-faint"> · v{p.version} · updated {relTime(p.updated_at)}</span>
        </div>
      </div>
      <div className="hidden w-36 text-right text-sm sm:block">
        {p.campaign_count ? (
          <span className="num text-ink">{plural(p.campaign_count, "campaign")}</span>
        ) : (
          <span className="text-faint">Not in use</span>
        )}
      </div>
      <div className="relative z-10">
        <Menu
          label={`Actions for ${p.name}`}
          items={[
            { label: "Open editor", icon: <FileText className="h-4 w-4" />, onSelect: () => nav(`/app/playbooks/${p.id}`) },
            { label: "Duplicate", icon: <Copy className="h-4 w-4" />, onSelect: () => dup.mutate(), disabled: dup.isPending },
            "separator",
            {
              label: "Delete",
              danger: true,
              icon: <Trash2 className="h-4 w-4" />,
              disabled: del.isPending,
              onSelect: async () => {
                const ok = await confirm({
                  title: `Delete "${p.name}"?`,
                  body: p.campaign_count
                    ? `${plural(p.campaign_count, "campaign")} use this playbook, so the server will refuse. Move those campaigns first.`
                    : "This removes the playbook for everyone in the workspace. It can't be undone.",
                  confirm: "Delete playbook",
                  danger: true,
                });
                if (ok) del.mutate();
              },
            },
          ]}
          trigger={(t) => (
            <IconButton {...t} label={`Actions for ${p.name}`} size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          )}
        />
      </div>
    </li>
  );
}

export default function PlaybooksList() {
  const q = usePlaybooks();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Playbooks"
        subtitle="What you sell, the claims an email may make, who qualifies and who to contact."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>
            New playbook
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} what="playbooks" />
      ) : (
        <Panel>
          <div className="flex items-center gap-4 border-b border-rule px-4 py-2 text-xs text-faint">
            <span className="flex-1">Playbook</span>
            <span className="hidden w-36 text-right sm:block">Used by</span>
            <span className="w-7" />
          </div>
          {q.isPending ? (
            <ul className="divide-y divide-rule">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-4 px-4 py-4">
                  <div className="flex-1">
                    <Skeleton className="h-4 w-64" />
                    <Skeleton className="mt-2 block h-3 w-40" />
                  </div>
                  <Skeleton className="h-3.5 w-20" />
                </li>
              ))}
            </ul>
          ) : q.data.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title="No playbooks yet"
              body="Start from the Sprinto template, a blank playbook, or let us draft one from your website."
              action={<Button variant="primary" onClick={() => setOpen(true)}>New playbook</Button>}
            />
          ) : (
            <ul className="divide-y divide-rule">
              {q.data.map((p) => (
                <Row key={p.id} p={p} />
              ))}
            </ul>
          )}
        </Panel>
      )}
      <NewPlaybookDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
