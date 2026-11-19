import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Check, CircleAlert, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage } from "../../api/client";
import { qk, useQueryClient, useSettings, useSuppressions } from "../../api/hooks";
import type { IntegrationName, SecretsBody, SendingSettings, Settings as S, TestResult } from "../../api/types";
import { Button, IconButton } from "../../components/ui/Button";
import { CopyButton } from "../../components/ui/CopyButton";
import { useConfirm } from "../../components/ui/Dialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Select, Switch } from "../../components/ui/Field";
import { PageHeader, Panel } from "../../components/ui/Panel";
import { Pill } from "../../components/ui/Pill";
import { cn } from "../../lib/cn";
import { LIVE_MISSING_LABEL, humanize, num, shortDate } from "../../lib/format";
import { useToast } from "../../lib/toast";

type Area = "workspace" | "sending" | "integrations" | "models" | "suppression" | "demo";
const AREAS: { id: Area; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "sending", label: "Sending" },
  { id: "integrations", label: "Integrations" },
  { id: "models", label: "Models" },
  { id: "suppression", label: "Suppression list" },
  { id: "demo", label: "Demo mode" },
];

function errFor(e: unknown, key: string) {
  return e instanceof ApiError ? e.errors.find((x) => x.startsWith(key))?.split(": ").slice(1).join(": ") : undefined;
}

function ServerErrors({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Notice tone="negative" className="mb-4" title={error instanceof ApiError ? error.detail : errorMessage(error)}>
      {error instanceof ApiError && error.errors.length > 0 && <ul className="list-disc pl-4">{error.errors.map((x) => <li key={x}>{x}</li>)}</ul>}
    </Notice>
  );
}

function Block({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {description && <p className="mt-1 max-w-[68ch] text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-raised/50 px-5 py-3">{footer}</div>}
    </Panel>
  );
}

function usePatch() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: api.patchSettings,
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      void qc.invalidateQueries({ queryKey: qk.me });
      toast.success("Settings saved");
    },
  });
}

// ---------------------------------------------------------------------------------------------

function Workspace({ s }: { s: S }) {
  const [name, setName] = useState(s.workspace_name);
  const m = usePatch();
  return (
    <Block
      title="Workspace"
      description="The name shown in the sidebar and to anyone you invite."
      footer={<Button variant="primary" loading={m.isPending} disabled={name === s.workspace_name || !name.trim()} onClick={() => m.mutate({ workspace_name: name.trim() })}>Save</Button>}
    >
      <ServerErrors error={m.error} />
      <Field label="Workspace name" error={errFor(m.error, "workspace_name")} className="max-w-md">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </Block>
  );
}

function Sending({ s }: { s: S }) {
  const [v, setV] = useState<SendingSettings>(s.sending);
  useEffect(() => setV(s.sending), [s.sending]);
  const m = usePatch();
  const up = <K extends keyof SendingSettings>(k: K, val: SendingSettings[K]) => setV((x) => ({ ...x, [k]: val }));
  const win = (patch: Partial<SendingSettings["send_window"]>) => setV((x) => ({ ...x, send_window: { ...x.send_window, ...patch } }));
  const dirty = JSON.stringify(v) !== JSON.stringify(s.sending);
  const lr = s.live_ready;
  const hours = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-6">
      <Block title="Mode" description="Start in test mode. Switch to live only when you are ready to email real people.">
        <div className="grid gap-3 md:grid-cols-2">
          {(["test", "live"] as const).map((mode) => {
            const on = v.mode === mode;
            const disabled = mode === "live" && !lr.ok;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => up("mode", mode)}
                className={cn("rounded-card border p-4 text-left transition-colors disabled:cursor-not-allowed", on ? "border-ink bg-surface ring-1 ring-ink" : "border-line hover:border-control", disabled && "opacity-60")}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("grid h-4 w-4 place-items-center rounded-full border", on ? "border-ink" : "border-control")}>{on && <span className="h-2 w-2 rounded-full bg-ink" />}</span>
                  <span className="font-medium">{mode === "test" ? "Test" : "Live"}</span>
                  {mode === "test" ? <Pill tone="warning">safe</Pill> : lr.ok ? <Pill tone="positive">ready</Pill> : <Pill tone="neutral">blocked</Pill>}
                </div>
                <p className="mt-2 text-[13px] leading-5 text-muted">
                  {mode === "test"
                    ? <>Every email goes to <span className="text-ink">{v.owner_email || "the owner email"}</span>. The subject starts with [TEST -&gt; Name &lt;email&gt;] so you can see who it was meant for.</>
                    : "Emails go to the real contact, inside your send window and daily cap, with an unsubscribe link and your postal address."}
                </p>
              </button>
            );
          })}
        </div>
        {!lr.ok && (
          <div className="mt-4 rounded-card border border-line bg-raised/60 p-4">
            <p className="text-[13px] font-medium">Before live mode</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {lr.missing.map((k) => (
                <li key={k} className="flex items-start gap-2 text-[13px]">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  {LIVE_MISSING_LABEL[k] ?? humanize(k)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Block>

      <Block
        title="Sender and limits"
        footer={
          <>
            {dirty && <span className="mr-auto text-[13px] text-muted">Unsaved changes</span>}
            <Button disabled={!dirty} onClick={() => setV(s.sending)}>Discard</Button>
            <Button variant="primary" loading={m.isPending} disabled={!dirty} onClick={() => m.mutate({ sending: v })}>Save sending</Button>
          </>
        }
      >
        <ServerErrors error={m.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" help="Gmail with an app password, or Resend with a verified domain.">
            {(p) => (
              <Select {...p} value={v.provider ?? ""} onChange={(e) => up("provider", (e.target.value || null) as SendingSettings["provider"])}>
                <option value="">Not set</option>
                <option value="gmail">Gmail</option>
                <option value="resend">Resend</option>
              </Select>
            )}
          </Field>
          <Field label="Owner email" help="Receives every email in test mode." error={errFor(m.error, "sending.owner_email")}>
            {(p) => <Input {...p} type="email" value={v.owner_email} onChange={(e) => up("owner_email", e.target.value)} />}
          </Field>
          <Field label="From name">{(p) => <Input {...p} value={v.from_name} onChange={(e) => up("from_name", e.target.value)} />}</Field>
          <Field label="From email" help={v.provider === "resend" ? "An address on your verified Resend domain." : "Your Gmail address."} error={errFor(m.error, "sending.from_email")}>
            {(p) => <Input {...p} type="email" value={v.from_email} onChange={(e) => up("from_email", e.target.value)} />}
          </Field>
          <Field label="Reply-to" optional>{(p) => <Input {...p} type="email" value={v.reply_to} onChange={(e) => up("reply_to", e.target.value)} />}</Field>
          <Field label="Daily cap" help="Most emails sent per day across campaigns." error={errFor(m.error, "sending.daily_cap")}>
            {(p) => <Input {...p} type="number" min={1} max={500} value={v.daily_cap} onChange={(e) => up("daily_cap", Number(e.target.value))} className="num w-32" />}
          </Field>
          <Field label="Physical mailing address" help="Required by CAN-SPAM; printed in every footer." className="sm:col-span-2" error={errFor(m.error, "sending.physical_address")}>
            {(p) => <Input {...p} value={v.physical_address} onChange={(e) => up("physical_address", e.target.value)} placeholder="Street, city, postcode, country" />}
          </Field>
        </div>
        <fieldset className="mt-6">
          <legend className="text-[13px] font-medium">Send window</legend>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <Field label="From">{(p) => <Select {...p} value={v.send_window.start_hour} onChange={(e) => win({ start_hour: Number(e.target.value) })} className="w-28">{hours.slice(0, 24).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select>}</Field>
            <Field label="Until">{(p) => <Select {...p} value={v.send_window.end_hour} onChange={(e) => win({ end_hour: Number(e.target.value) })} className="w-28">{hours.slice(1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select>}</Field>
            <Field label="Time zone" className="min-w-[220px] flex-1">{(p) => <Input {...p} value={v.send_window.timezone} onChange={(e) => win({ timezone: e.target.value })} placeholder="America/New_York" />}</Field>
            <label className="flex h-9 items-center gap-2 text-[13px]">
              <Switch label="Weekdays only" checked={v.send_window.weekdays_only} onChange={(b) => win({ weekdays_only: b })} />
              Weekdays only
            </label>
          </div>
          {errFor(m.error, "sending.send_window") && <p className="mt-1 text-xs text-negative">{errFor(m.error, "sending.send_window")}</p>}
        </fieldset>
      </Block>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

const INTEGRATIONS: { name: IntegrationName; title: string; what: string; fields: { key: keyof SecretsBody; label: string; secret: boolean; placeholder?: string }[] }[] = [
  { name: "gemini", title: "Gemini", what: "Reads pages, extracts quoted facts and drafts emails.", fields: [{ key: "gemini_api_key", label: "API key", secret: true }] },
  { name: "hunter", title: "Hunter", what: "Finds the named people at each qualified company.", fields: [{ key: "hunter_api_key", label: "API key", secret: true }] },
  { name: "gmail", title: "Gmail", what: "Sends from your Gmail account with an app password (not your login password).", fields: [{ key: "gmail_user", label: "Gmail address", secret: false, placeholder: "you@gmail.com" }, { key: "gmail_app_password", label: "App password", secret: true }] },
  { name: "resend", title: "Resend", what: "Sends from a verified domain and reports bounces and complaints.", fields: [{ key: "resend_api_key", label: "API key", secret: true }, { key: "resend_webhook_secret", label: "Webhook signing secret", secret: true }] },
];

function IntegrationCard({ s, def }: { s: S; def: (typeof INTEGRATIONS)[number] }) {
  const i = s.integrations[def.name];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [test, setTest] = useState<TestResult | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const save = useMutation({
    mutationFn: (body: SecretsBody) => api.putSecrets(body),
    onSuccess: (n, body) => {
      qc.setQueryData(qk.settings, n);
      setVals({});
      setTest(null);
      const cleared = Object.values(body).every((x) => x === "");
      toast.success(cleared ? `${def.title} disconnected` : `${def.title} saved`, cleared ? undefined : "Stored encrypted; it is never shown again.");
    },
  });
  const run = useMutation({ mutationFn: () => api.testIntegration(def.name), onSuccess: setTest, onError: (e) => setTest({ ok: false, detail: errorMessage(e) }) });
  const filled = Object.fromEntries(Object.entries(vals).filter(([, x]) => x.trim()));
  const usage = s.hunter_usage;
  return (
    <Panel as="article" className="flex flex-col">
      <div className="flex flex-wrap items-start gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{def.title}</h3>
          <p className="mt-0.5 text-[13px] text-muted">{def.what}</p>
        </div>
        {i.configured ? (
          <Pill tone="positive" dot>Connected{i.source === "env" ? " via env" : ""}</Pill>
        ) : (
          <Pill tone="neutral">Not connected</Pill>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        {i.configured && i.hint && <p className="text-[13px] text-muted">Using <span className="font-mono text-xs text-ink">{i.hint}</span>{i.source === "env" && " from the server environment. A key saved here takes precedence."}</p>}
        {def.name === "hunter" && (
          <div>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-muted">Searches this month</span>
              <span className="num"><span className="font-medium">{num(usage.used_this_month)}</span> <span className="text-muted">of {num(usage.monthly_budget)}</span></span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-active">
              <div className={cn("h-1.5 rounded-full", usage.used_this_month / usage.monthly_budget > 0.85 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, (usage.used_this_month / Math.max(1, usage.monthly_budget)) * 100)}%` }} />
            </div>
          </div>
        )}
        {def.fields.map((f) => (
          <Field key={f.key} label={i.configured ? `Replace ${f.label.toLowerCase()}` : f.label} error={errFor(save.error, f.key)}>
            {(p) => (
              <Input
                {...p}
                type={f.secret ? "password" : "email"}
                autoComplete={f.secret ? "new-password" : "off"}
                value={vals[f.key] ?? ""}
                placeholder={f.placeholder ?? (i.configured ? "Leave empty to keep the current value" : "")}
                onChange={(e) => setVals((x) => ({ ...x, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        {def.name === "resend" && (
          <div>
            <p className="text-[13px] font-medium">Webhook URL</p>
            <p className="mt-0.5 text-xs text-muted">Paste into Resend &gt; Webhooks so bounces and complaints are recorded.</p>
            <div className="mt-1.5 flex">
              <Input readOnly value={s.webhook_url} aria-label="Resend webhook URL" className="rounded-r-none font-mono text-xs" onFocus={(e) => e.target.select()} />
              <CopyButton value={s.webhook_url} className="-ml-px rounded-l-none" />
            </div>
          </div>
        )}
        {test && (
          <p role="status" className={cn("flex items-start gap-1.5 text-[13px]", test.ok ? "text-positive" : "text-negative")}>
            {test.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />} {test.detail}
          </p>
        )}
        {save.error && !(save.error instanceof ApiError && save.error.errors.length) ? <p className="text-xs text-negative">{errorMessage(save.error)}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-raised/50 px-5 py-3">
        <Button size="sm" loading={run.isPending} disabled={!i.configured} onClick={() => run.mutate()}>
          {def.name === "gmail" || def.name === "resend" ? "Send test email" : "Test"}
        </Button>
        {i.configured && i.source === "workspace" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await confirm({ title: `Disconnect ${def.title}?`, body: "The stored credentials are deleted.", confirm: "Disconnect", danger: true }))
                save.mutate(Object.fromEntries(def.fields.map((f) => [f.key, ""])));
            }}
          >
            Disconnect
          </Button>
        )}
        <Button size="sm" variant="primary" className="ml-auto" loading={save.isPending} disabled={!Object.keys(filled).length} onClick={() => save.mutate(filled)}>Save</Button>
      </div>
    </Panel>
  );
}

function Models({ s }: { s: S }) {
  const [v, setV] = useState(s.models);
  const m = usePatch();
  const dirty = v.smart !== s.models.smart || v.fast !== s.models.fast;
  return (
    <Block
      title="Models"
      description="The smart model drafts emails and runs the research loop; the fast model extracts facts and picks pain points."
      footer={<Button variant="primary" disabled={!dirty} loading={m.isPending} onClick={() => m.mutate({ models: v })}>Save models</Button>}
    >
      <ServerErrors error={m.error} />
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Smart model">{(p) => <Input {...p} value={v.smart} onChange={(e) => setV({ ...v, smart: e.target.value })} className="font-mono text-[13px]" />}</Field>
        <Field label="Fast model">{(p) => <Input {...p} value={v.fast} onChange={(e) => setV({ ...v, fast: e.target.value })} className="font-mono text-[13px]" />}</Field>
      </div>
    </Block>
  );
}

function Suppression() {
  const q = useSuppressions();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const add = useMutation({
    mutationFn: () => api.addSuppression({ value: value.trim(), reason: reason.trim() || undefined }),
    onSuccess: (x) => {
      void qc.invalidateQueries({ queryKey: qk.suppressions });
      setValue("");
      setReason("");
      toast.success(`${x.value} suppressed`, "It is never emailed, in any campaign.");
    },
  });
  const remove = async (id: number, v: string) => {
    if (!(await confirm({ title: `Remove ${v} from the suppression list?`, body: "Future campaigns may email it again.", confirm: "Remove", danger: true }))) return;
    try {
      await api.deleteSuppression(id);
      void qc.invalidateQueries({ queryKey: qk.suppressions });
    } catch (e) {
      toast.error("Couldn't remove", errorMessage(e));
    }
  };
  return (
    <Block title="Suppression list" description="Addresses and domains that are never emailed. Unsubscribes, bounces and complaints are added automatically.">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (value.trim()) add.mutate(); }}>
        <Field label="Email or domain" className="flex-1" error={add.error ? errorMessage(add.error) : undefined}>
          {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@company.com or company.com" />}
        </Field>
        <Field label="Reason" optional className="flex-1">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Existing customer" />}</Field>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!value.trim()}>Add</Button>
      </form>
      <div className="mt-5 overflow-hidden rounded-card border border-line">
        {q.isError ? (
          <div className="p-3"><ErrorState error={q.error} onRetry={() => q.refetch()} what="the suppression list" /></div>
        ) : q.isPending ? (
          <div className="p-4"><Skeleton className="h-4 w-1/2" /></div>
        ) : q.data.length === 0 ? (
          <EmptyState title="Nobody is suppressed" body="Unsubscribes and bounces will appear here." className="py-8" />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line"><th className="px-3 py-2 font-normal">Value</th><th className="hidden px-3 py-2 font-normal sm:table-cell">Reason</th><th className="px-3 py-2 text-right font-normal">Added</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {q.data.map((x) => (
                <tr key={x.id}>
                  <td className="px-3 py-2"><span className="font-mono text-xs">{x.value}</span> <Pill tone="outline" className="ml-1">{x.kind}</Pill><div className="text-xs text-muted sm:hidden">{x.reason}</div></td>
                  <td className="hidden px-3 py-2 text-muted sm:table-cell">{x.reason}</td>
                  <td className="num px-3 py-2 text-right text-muted">{shortDate(x.created_at)}</td>
                  <td className="px-1 py-1"><IconButton size="sm" label={`Remove ${x.value}`} onClick={() => remove(x.id, x.value)}><Trash2 className="h-4 w-4" /></IconButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Block>
  );
}

function Demo({ s }: { s: S }) {
  const m = usePatch();
  return (
    <Block title="Demo mode" description="Run the whole pipeline on built-in sample data: no API keys, no network calls, nothing really sent. Useful to show the product or to try a playbook.">
      <div className="flex items-center justify-between gap-4 rounded-card border border-line p-4">
        <div>
          <p className="font-medium">{s.demo_mode ? "Demo mode is on" : "Demo mode is off"}</p>
          <p id="demo-d" className="mt-0.5 text-[13px] text-muted">{s.demo_mode ? "Research uses sample pages and contacts; approvals show the flow without sending." : "The pipeline uses your keys and real websites."}</p>
        </div>
        <Switch label="Demo mode" describedBy="demo-d" checked={s.demo_mode} disabled={m.isPending} onChange={(v) => m.mutate({ demo_mode: v })} />
      </div>
      <ServerErrors error={m.error} />
    </Block>
  );
}

export default function Settings() {
  const q = useSettings();
  const [params, setParams] = useSearchParams();
  const area = (params.get("tab") as Area) || "workspace";
  const setArea = (a: Area) => setParams((p) => { p.set("tab", a); return p; }, { replace: true });
  return (
    <div>
      <PageHeader title="Settings" subtitle={q.data ? `${q.data.workspace_name} · ${q.data.demo_mode ? "demo mode" : `${q.data.sending.mode} mode`}` : undefined} />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings areas" className="-mx-1 flex gap-1 overflow-x-auto lg:mx-0 lg:flex-col">
          {AREAS.map((a) => (
            <button
              key={a.id}
              onClick={() => setArea(a.id)}
              aria-current={area === a.id ? "page" : undefined}
              className={cn("h-9 shrink-0 rounded-control px-3 text-left text-[14px]", area === a.id ? "bg-active font-medium text-ink" : "text-muted hover:bg-active/60 hover:text-ink")}
            >
              {a.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} what="settings" />
          ) : !q.data ? (
            <Panel className="p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-4 h-9 w-full max-w-md" /></Panel>
          ) : (
            <>
              <h2 className="sr-only">{AREAS.find((a) => a.id === area)?.label}</h2>
              {area === "workspace" && <Workspace s={q.data} />}
              {area === "sending" && <Sending s={q.data} />}
              {area === "integrations" && (
                <div className="grid gap-4 xl:grid-cols-2">{INTEGRATIONS.map((d) => <IntegrationCard key={d.name} s={q.data} def={d} />)}</div>
              )}
              {area === "models" && <Models s={q.data} />}
              {area === "suppression" && <Suppression />}
              {area === "demo" && <Demo s={q.data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
