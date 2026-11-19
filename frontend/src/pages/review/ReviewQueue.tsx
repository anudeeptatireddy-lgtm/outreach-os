import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Check, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { api, ApiError, errorMessage } from "../../api/client";
import { invalidateWork, qk, useMessages, usePlaybook, useCampaign, useQueryClient, useSettings } from "../../api/hooks";
import type { Message } from "../../api/types";
import { Orb } from "../../components/brand/Orb";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { EmptyState, ErrorState, Kbd, Notice, SkeletonRows } from "../../components/ui/Feedback";
import { Checkbox, Field, Input, Textarea } from "../../components/ui/Field";
import { Pill } from "../../components/ui/Pill";
import { cn } from "../../lib/cn";
import { relTime, wordCount } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { useWorker } from "../../lib/worker";
import { EvidenceChip, HookedText, QuoteBlock } from "../prospect/trail";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

const AutoTextarea = forwardRef<HTMLTextAreaElement, React.ComponentProps<typeof Textarea>>(function AutoTextarea(props, outer) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return (
    <Textarea
      {...props}
      ref={(el) => {
        ref.current = el;
        if (typeof outer === "function") outer(el);
        else if (outer) outer.current = el;
      }}
    />
  );
});

type SaveState = "idle" | "saving" | "saved" | "error";

function Editor({ m, onDone, editorRef }: { m: Message; onDone: (id: number) => void; editorRef: React.RefObject<HTMLTextAreaElement> }) {
  const settings = useSettings();
  const camp = useCampaign(m.campaign.id);
  const pb = usePlaybook(camp.data?.playbook.id ?? NaN);
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [validation, setValidation] = useState(m.validation);
  const [save, setSave] = useState<SaveState>("idle");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef({ subject, body });
  latest.current = { subject, body };
  const qc = useQueryClient();
  const toast = useToast();
  const { kick } = useWorker();

  // reset when switching drafts or when the server returns a new version (regenerate)
  useEffect(() => {
    setSubject(m.subject);
    setBody(m.body);
    setValidation(m.validation);
    setSave("idle");
  }, [m.id, m.subject, m.body, m.validation]);

  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const { subject: s, body: b } = latest.current;
    if (s === m.subject && b === m.body) return;
    setSave("saving");
    try {
      const next = await api.patchMessage(m.id, { subject: s, body: b });
      setValidation(next.validation);
      qc.setQueryData<Message[]>(qk.messages("needs_review"), (old) => old?.map((x) => (x.id === next.id ? next : x)));
      setSave("saved");
    } catch (e) {
      setSave("error");
      toast.error("Couldn't save the draft", errorMessage(e));
    }
  }, [m.id, m.subject, m.body, qc, toast]);

  const schedule = () => {
    setSave("idle");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 800);
  };
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const after = (msg: string, sub?: string) => {
    invalidateWork(qc);
    kick();
    toast.success(msg, sub);
    onDone(m.id);
  };

  const approve = useMutation({
    mutationFn: async (force: boolean) => {
      await flush();
      return api.approveMessage(m.id, sendAt ? new Date(sendAt).toISOString() : null, force);
    },
    onSuccess: (r) => {
      setBlocked(null);
      setScheduleOpen(false);
      after(`Approved for ${m.to.name}`, r.scheduled_at ? `Sends ${relTime(r.scheduled_at)}${testMode ? ` to ${owner} (test mode)` : ""}.` : undefined);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && e.errors.length) setBlocked(e.errors);
      else toast.error("Couldn't approve", errorMessage(e));
    },
  });
  const reject = useMutation({
    mutationFn: () => api.rejectMessage(m.id),
    onSuccess: () => after("Draft rejected", `${m.company.name ?? m.company.domain} stays in the campaign; you can regenerate it later.`),
    onError: (e) => toast.error("Couldn't reject", errorMessage(e)),
  });
  const regen = useMutation({
    mutationFn: () => api.regenerateMessage(m.id, instructions.trim() || undefined),
    onSuccess: (next) => {
      setRegenOpen(false);
      setInstructions("");
      qc.setQueryData<Message[]>(qk.messages("needs_review"), (old) => old?.map((x) => (x.id === next.id ? next : x)));
      kick();
      toast.success("New draft written", next.validation.ok ? "It passes every check." : `${next.validation.failures.length} warning(s) to look at.`);
    },
    onError: (e) => toast.error("Couldn't regenerate", errorMessage(e)),
  });

  const s = settings.data;
  const testMode = !!s && (s.demo_mode || s.sending.mode === "test");
  const owner = s?.sending.owner_email || "your inbox";
  const words = wordCount(body);
  const range = pb.data?.email;
  const busy = approve.isPending || reject.isPending || regen.isPending;

  // keyboard actions for this draft
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      if (e.key === "a") {
        e.preventDefault();
        approve.mutate(false);
      } else if (e.key === "r") {
        e.preventDefault();
        reject.mutate();
      } else if (e.key === "e") {
        e.preventDefault();
        editorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [approve, reject, busy, editorRef]);

  return (
    <div className="grid min-h-0 gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-muted">
              To <span className="text-ink">{m.to.name}</span> &lt;{m.to.email}&gt;, {m.to.title}
            </div>
            <div className="mt-0.5 text-[13px] text-muted">
              <Link to={`/app/prospects/${m.prospect_id}`} className="font-medium text-ink hover:underline">{m.company.name ?? m.company.domain}</Link> · {m.campaign.name}
              {m.step > 0 && <> · follow-up {m.step}</>}
            </div>
          </div>
          <Link to={`/app/prospects/${m.prospect_id}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Decision trail <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
        {testMode && (
          <Notice tone={s?.demo_mode ? "info" : "warning"} className="mt-3">
            {s?.demo_mode ? (
              <>Demo mode: approving shows the flow but nothing is sent.</>
            ) : (
              <>
                Test mode: delivered to <span className="font-medium">{owner}</span>. The subject will read{" "}
                <span className="font-mono text-xs">[TEST -&gt; {m.to.name} &lt;{m.to.email}&gt;] {subject}</span>
              </>
            )}
          </Notice>
        )}

        <div className="mt-5 flex flex-col gap-4">
          <Field label="Subject">
            {(p) => <Input {...p} value={subject} onChange={(e) => { setSubject(e.target.value); schedule(); }} onBlur={() => void flush()} className="text-[15px] font-medium" />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={`body-${m.id}`} className="text-[13px] font-medium">Body</label>
              <span className="flex items-center gap-3 text-xs">
                <span className={cn("num font-mono", range && (words < range.min_words || words > range.max_words) ? "text-warning-ink" : "text-faint")}>
                  {words} words{range ? ` · ${range.min_words}–${range.max_words}` : ""}
                </span>
                <span className="w-16 text-right text-faint" aria-live="polite">
                  {save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? <span className="text-negative">Not saved</span> : ""}
                </span>
              </span>
            </div>
            <AutoTextarea
              ref={editorRef}
              id={`body-${m.id}`}
              value={body}
              onChange={(e) => { setBody(e.target.value); schedule(); }}
              onBlur={() => void flush()}
              className="min-h-[220px] resize-none text-[15px] leading-7"
            />
            <div className="whitespace-pre-wrap rounded-b-control border-x border-b border-dashed border-line bg-raised/60 px-3 py-2.5 text-[13px] leading-5 text-faint" aria-label="Footer, added to every email (read only)">
              {m.footer}
            </div>
          </div>
          {validation.ok ? (
            <p className="inline-flex items-center gap-1.5 text-[13px] text-positive"><ShieldCheck className="h-4 w-4" /> Passes every check: claims map to evidence, word count, tone and banned phrases.</p>
          ) : (
            <Notice tone="warning" icon={<ShieldAlert className="h-4 w-4" />} title={`${validation.failures.length} warning${validation.failures.length > 1 ? "s" : ""} from the validator`}>
              <ul className="list-disc pl-4">{validation.failures.map((f) => <li key={f}>{f}</li>)}</ul>
            </Notice>
          )}
        </div>

        <div className="sticky bottom-0 -mx-4 mt-6 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6">
          <Button variant="primary" kbd="A" icon={<Check className="h-4 w-4" />} loading={approve.isPending} disabled={busy} onClick={() => approve.mutate(false)}>
            {sendAt ? "Approve & schedule" : "Approve & send"}
          </Button>
          <Button icon={<CalendarClock className="h-4 w-4" />} disabled={busy} onClick={() => setScheduleOpen(true)} aria-label="Choose a send time">
            {sendAt ? new Date(sendAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Next send window"}
          </Button>
          <Button kbd="R" icon={<X className="h-4 w-4" />} loading={reject.isPending} disabled={busy} onClick={() => reject.mutate()}>Reject</Button>
          <Button variant="ghost" icon={<RefreshCw className="h-4 w-4" />} disabled={busy} onClick={() => setRegenOpen(true)}>Regenerate</Button>
        </div>
      </div>

      <aside className="border-t border-line bg-raised/40 px-4 py-5 xl:border-l xl:border-t-0" aria-label="Evidence for this draft">
        <h3 className="text-[13px] font-medium">What each claim rests on</h3>
        <ul className="mt-3 flex flex-col gap-4">
          {m.hook_map.map((h, i) => (
            <li key={i} className="text-[13px]">
              <div className="flex items-start gap-2">
                <EvidenceChip id={h.evidence_id} />
                <span className="font-medium">{h.claim}</span>
              </div>
              <div className="mt-1.5 pl-1">
                {h.evidence_id.startsWith("S") ? <p className="text-xs text-muted">Playbook value claim {h.evidence_id}</p> : <QuoteBlock quote={h.quote} url={h.source_url} />}
              </div>
            </li>
          ))}
          {m.hook_map.length === 0 && <li className="text-[13px] text-muted">No claims mapped. Edits that remove a claim also remove its mapping.</li>}
        </ul>
        {m.pain_points.length > 0 && (
          <>
            <h3 className="mt-6 text-[13px] font-medium">Pain points used</h3>
            <ul className="mt-2 flex flex-col gap-2.5">
              {m.pain_points.map((p, i) => (
                <li key={i} className="flex gap-2 text-[13px]">
                  <EvidenceChip id={p.evidence_id} />
                  <span>
                    {p.pain}
                    <span className="block text-xs text-muted">{p.role_link}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className="mt-6 text-[13px] font-medium">Preview with highlights</h3>
        <HookedText body={body} hooks={m.hook_map} className="mt-2 text-[13px] leading-6" />
      </aside>

      <Dialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Choose a send time"
        size="sm"
        footer={
          <>
            <Button onClick={() => { setSendAt(""); setScheduleOpen(false); }}>Use next send window</Button>
            <Button variant="primary" disabled={!sendAt} onClick={() => setScheduleOpen(false)}>Set time</Button>
          </>
        }
      >
        <Field label="Send at" help={s ? `Your send window is ${s.sending.send_window.start_hour}:00–${s.sending.send_window.end_hour}:00 ${s.sending.send_window.timezone}${s.sending.send_window.weekdays_only ? ", weekdays" : ""}.` : undefined}>
          {(p) => <Input {...p} data-autofocus type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />}
        </Field>
      </Dialog>

      <Dialog
        open={regenOpen}
        onClose={() => !regen.isPending && setRegenOpen(false)}
        title="Regenerate this draft"
        description="The new draft uses the same evidence and is validated again. Your edits to this draft are replaced."
        footer={
          <>
            <Button onClick={() => setRegenOpen(false)} disabled={regen.isPending}>Cancel</Button>
            <Button variant="primary" loading={regen.isPending} onClick={() => regen.mutate()}>Regenerate</Button>
          </>
        }
      >
        <Field label="Instructions" optional help='For example "shorter, lead with the hiring signal".'>
          {(p) => <Textarea {...p} data-autofocus rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
        </Field>
      </Dialog>

      <Dialog
        open={!!blocked}
        onClose={() => setBlocked(null)}
        title="This draft fails validation"
        description="The validator flags claims that are not backed by the company's pages, and drafts outside the playbook's rules."
        footer={
          <>
            <Button onClick={() => { setBlocked(null); editorRef.current?.focus(); }}>Fix the draft</Button>
            <Button variant="danger" loading={approve.isPending} onClick={() => approve.mutate(true)}>Approve anyway</Button>
          </>
        }
      >
        <ul className="list-disc pl-5 text-sm">{blocked?.map((b) => <li key={b}>{b}</li>)}</ul>
      </Dialog>
    </div>
  );
}

export default function ReviewQueue() {
  const q = useMessages("needs_review");
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDetailOnPhone, setShowDetailOnPhone] = useState(!!params.get("m"));
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { kick } = useWorker();
  const list = useMemo(() => q.data ?? [], [q.data]);
  const wanted = Number(params.get("m"));
  const current = list.find((m) => m.id === wanted) ?? list[0] ?? null;
  const idx = current ? list.indexOf(current) : -1;

  const select = useCallback((id: number) => setParams((p) => { p.set("m", String(id)); return p; }, { replace: true }), [setParams]);

  const onDone = (id: number) => {
    const i = list.findIndex((m) => m.id === id);
    const next = list[i + 1] ?? list[i - 1];
    if (next) select(next.id);
    qc.setQueryData<Message[]>(qk.messages("needs_review"), (old) => old?.filter((x) => x.id !== id));
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !list.length) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const n = list[Math.min(list.length - 1, Math.max(0, idx + (e.key === "j" ? 1 : -1)))];
        if (n) {
          select(n.id);
          document.getElementById(`draft-${n.id}`)?.scrollIntoView({ block: "nearest" });
        }
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [list, idx, select]);

  const bulk = useMutation({
    mutationFn: () => api.bulkApprove([...selected]),
    onSuccess: (r) => {
      setSelected(new Set());
      invalidateWork(qc);
      kick();
      toast.success(`Approved ${r.approved}`, r.skipped ? `${r.skipped} skipped because they fail validation. Open them to fix or approve one by one.` : "They send in the next window.");
    },
    onError: (e) => toast.error("Bulk approve failed", errorMessage(e)),
  });

  const allOn = list.length > 0 && selected.size === list.length;

  return (
    <div className="-mx-4 -mb-16 -mt-6 sm:-mx-6 lg:-mx-8 lg:-mt-8">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 pb-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[34px] leading-[38px] tracking-[-0.015em]">Review</h1>
          <p className="mt-1 text-[14px] text-muted">{q.data ? (list.length ? `${list.length} draft${list.length > 1 ? "s" : ""} waiting. Edit, approve or reject; nothing sends until you approve.` : "Nothing waiting.") : "Drafts waiting for your approval"}</p>
        </div>
        <div className="hidden items-center gap-1.5 text-xs text-muted md:flex">
          <Kbd>j</Kbd><Kbd>k</Kbd> move <Kbd>a</Kbd> approve <Kbd>r</Kbd> reject <Kbd>e</Kbd> edit
        </div>
      </div>

      {q.isError ? (
        <div className="p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} what="the review queue" /></div>
      ) : q.isPending ? (
        <SkeletonRows rows={6} />
      ) : list.length === 0 ? (
        <EmptyState
          className="py-24"
          icon={<Orb variant="small" />}
          title="Inbox zero"
          body="Every draft has been reviewed. New drafts land here as research finishes."
          action={<Link to="/app/campaigns"><Button>Go to campaigns</Button></Link>}
        />
      ) : (
        <div className="grid lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className={cn("border-line lg:sticky lg:top-0 lg:h-[calc(100vh-0px)] lg:overflow-y-auto lg:border-r", showDetailOnPhone && "hidden lg:block")}>
            <div className="flex h-11 items-center gap-3 border-b border-rule px-4">
              <Checkbox label="Select all drafts" checked={allOn} indeterminate={selected.size > 0 && !allOn} onChange={(v) => setSelected(v ? new Set(list.map((m) => m.id)) : new Set())} />
              <span className="text-xs text-muted">{selected.size ? `${selected.size} selected` : "Select to approve in bulk"}</span>
              {selected.size > 0 && (
                <Button size="sm" variant="primary" className="ml-auto" loading={bulk.isPending} onClick={() => bulk.mutate()}>
                  Approve {selected.size}
                </Button>
              )}
            </div>
            <ul role="listbox" aria-label="Drafts needing review" className="divide-y divide-rule">
              {list.map((m) => {
                const on = current?.id === m.id;
                return (
                  <li key={m.id} id={`draft-${m.id}`} role="option" aria-selected={on} className={cn("flex gap-3 px-4 py-3", on ? "bg-active" : "hover:bg-raised")}>
                    <Checkbox
                      className="mt-1"
                      label={`Select draft for ${m.to.name}`}
                      checked={selected.has(m.id)}
                      onChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(m.id); else n.delete(m.id); return n; })}
                    />
                    <button className="min-w-0 flex-1 text-left" onClick={() => { select(m.id); setShowDetailOnPhone(true); }}>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{m.company.name ?? m.company.domain}</span>
                        <span className="ml-auto shrink-0 text-xs text-faint">{relTime(m.created_at)}</span>
                      </div>
                      <div className="truncate text-[13px] text-muted">{m.to.name}, {m.to.title}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px]">{m.subject}</span>
                        {m.validation.ok ? <Pill tone="positive">passes</Pill> : <Pill tone="warning">{m.validation.failures.length} warning{m.validation.failures.length > 1 ? "s" : ""}</Pill>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={cn("min-w-0 bg-surface", !showDetailOnPhone && "hidden lg:block")}>
            <div className="flex items-center gap-2 border-b border-rule px-4 py-2 lg:hidden">
              <button onClick={() => setShowDetailOnPhone(false)} className="inline-flex h-9 items-center gap-1 text-sm text-muted">
                <ArrowLeft className="h-4 w-4" /> All drafts
              </button>
              <span className="ml-auto num text-xs text-faint">{idx + 1} of {list.length}</span>
            </div>
            {current && <Editor key={current.id} m={current} onDone={onDone} editorRef={editorRef} />}
          </div>
        </div>
      )}
    </div>
  );
}
