import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { invalidateWork, usePlaybooks, useQueryClient, useSettings } from "../../api/hooks";
import type { FollowupStep } from "../../api/types";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Notice } from "../../components/ui/Feedback";
import { Field, Input, Select, Switch } from "../../components/ui/Field";
import { useToast } from "../../lib/toast";
import { useWorker } from "../../lib/worker";
import { CompaniesInput, companiesCount, companiesPayload, emptyCompanies, type CompaniesValue } from "./input";

export function FollowupsEditor({ value, onChange }: { value: FollowupStep[]; onChange: (v: FollowupStep[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">Follow-ups</span>
        <span className="text-xs text-muted">{value.length === 0 ? "One email, no follow-ups" : `${value.length} of 3`}</span>
      </div>
      {value.map((f, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 text-muted">Follow-up {i + 1}</span>
          <Input
            type="number"
            min={1}
            max={30}
            aria-label={`Days before follow-up ${i + 1}`}
            value={f.delay_days}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { delay_days: Math.max(1, Number(e.target.value) || 1) } : x)))}
            className="num w-20"
          />
          <span className="whitespace-nowrap text-muted">days later</span>
          <IconButton label={`Remove follow-up ${i + 1}`} size="sm" className="ml-auto" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      ))}
      {value.length < 3 && (
        <button type="button" onClick={() => onChange([...value, { delay_days: value.length ? 5 : 3 }])} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-accent hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add follow-up
        </button>
      )}
    </div>
  );
}

export function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const playbooks = usePlaybooks();
  const settings = useSettings();
  const [name, setName] = useState("");
  const [playbookId, setPlaybookId] = useState<number | "">("");
  const [companies, setCompanies] = useState<CompaniesValue>(emptyCompanies);
  const [autoApprove, setAutoApprove] = useState(false);
  const [hunter, setHunter] = useState(true);
  const [followups, setFollowups] = useState<FollowupStep[]>([{ delay_days: 3 }]);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const { kick } = useWorker();

  useEffect(() => {
    if (playbookId === "" && playbooks.data?.length) setPlaybookId(playbooks.data[0]!.id);
  }, [playbooks.data, playbookId]);

  const create = useMutation({
    mutationFn: () =>
      api.createCampaign({
        name: name.trim(),
        playbook_id: Number(playbookId),
        ...companiesPayload(companies),
        auto_approve: autoApprove,
        followups,
        hunter_live: hunter,
      }),
    onSuccess: (c) => {
      invalidateWork(qc);
      kick();
      toast.success("Campaign created", `${c.stats.total} companies queued for research.`);
      onClose();
      setName("");
      setCompanies(emptyCompanies);
      nav(`/app/campaigns/${c.id}`);
    },
  });
  const err = create.error instanceof ApiError ? create.error : null;
  const fieldErr = (k: string) => err?.errors.find((e) => e.startsWith(k))?.split(": ").slice(1).join(": ");
  const usage = settings.data?.hunter_usage;
  const n = companiesCount(companies);
  const demo = settings.data?.demo_mode;

  return (
    <Dialog
      open={open}
      onClose={() => !create.isPending && onClose()}
      title="New campaign"
      description="Paste company domains. Each one is researched, scored against the playbook and drafted for your review."
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!name.trim() || !playbookId || n === 0} onClick={() => create.mutate()}>
            Create and start research
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {err && !err.errors.length && <Notice tone="negative">{err.detail}</Notice>}
        {err && err.errors.length > 0 && (
          <Notice tone="negative" title={err.detail}>
            <ul className="list-disc pl-4">{err.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fieldErr("name")}>
            {(p) => <Input {...p} data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Fintech Series A, December" />}
          </Field>
          <Field label="Playbook" help="What you sell, who qualifies and who to contact." error={fieldErr("playbook_id")}>
            {(p) => (
              <Select {...p} value={playbookId} onChange={(e) => setPlaybookId(Number(e.target.value))}>
                {playbooks.data?.map((pb) => <option key={pb.id} value={pb.id}>{pb.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <CompaniesInput value={companies} onChange={setCompanies} error={fieldErr("domains")} />
        <div className="grid gap-5 border-t border-rule pt-5 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p id="hunter-l" className="text-[13px] font-medium">Find contacts with Hunter (uses credits)</p>
                <p id="hunter-d" className="mt-0.5 text-xs text-muted">
                  {demo
                    ? "Demo mode uses built-in sample contacts, so no credits are spent."
                    : hunter
                      ? `About one search per qualified company.${usage ? ` ${usage.used_this_month} of ${usage.monthly_budget} used this month.` : ""}`
                      : 'Off: no Hunter search. Contacts come from the CSV columns or are added by hand; otherwise the company ends as "No contact".'}
                </p>
              </div>
              <Switch label="Find contacts with Hunter (uses credits)" describedBy="hunter-d" checked={hunter} onChange={setHunter} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium">Auto-approve passing drafts</p>
                <p id="auto-d" className="mt-0.5 text-xs text-muted">Drafts that pass every validation check skip the review queue and send in the next window.</p>
              </div>
              <Switch label="Auto-approve passing drafts" describedBy="auto-d" checked={autoApprove} onChange={setAutoApprove} />
            </div>
          </div>
          <FollowupsEditor value={followups} onChange={setFollowups} />
        </div>
      </form>
    </Dialog>
  );
}

export function AddCompaniesDialog({ open, onClose, campaignId }: { open: boolean; onClose: () => void; campaignId: number }) {
  const [companies, setCompanies] = useState<CompaniesValue>(emptyCompanies);
  const qc = useQueryClient();
  const toast = useToast();
  const { kick } = useWorker();
  const add = useMutation({
    mutationFn: () => api.addProspects(campaignId, companiesPayload(companies)),
    onSuccess: (r) => {
      invalidateWork(qc);
      kick();
      if (r.added) toast.success(`Added ${r.added} ${r.added === 1 ? "company" : "companies"}`);
      if (!r.rejected.length) {
        setCompanies(emptyCompanies);
        onClose();
      }
    },
  });
  const close = () => {
    add.reset();
    setCompanies(emptyCompanies);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add companies"
      size="lg"
      footer={
        add.data?.rejected.length ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={add.isPending} disabled={companiesCount(companies) === 0} onClick={() => add.mutate()}>
              Add and research
            </Button>
          </>
        )
      }
    >
      {add.error && <Notice tone="negative" className="mb-4">{add.error instanceof ApiError ? add.error.detail : String(add.error)}</Notice>}
      {add.data?.rejected.length ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Added <span className="num font-medium">{add.data.added}</span>. {add.data.rejected.length} skipped:
          </p>
          <ul className="divide-y divide-rule rounded-card border border-line">
            {add.data.rejected.map((r, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-[13px]">{r.input}</span>
                <span className="text-muted">{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <CompaniesInput value={companies} onChange={setCompanies} />
      )}
    </Dialog>
  );
}
