import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, CircleDashed, ExternalLink, Minus, MoreHorizontal, RotateCw, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { api, ApiError, errorMessage } from "../../api/client";
import { invalidateWork, useCampaign, usePlaybook, useProspect, useQueryClient } from "../../api/hooks";
import type { ProspectDetail, ProspectTrail, Qualification, SignalScore } from "../../api/types";
import { ScoreBar } from "../../components/ScoreBar";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog, useConfirm } from "../../components/ui/Dialog";
import { ErrorState, Notice, Skeleton } from "../../components/ui/Feedback";
import { Field, Input } from "../../components/ui/Field";
import { Menu } from "../../components/ui/Menu";
import { Panel } from "../../components/ui/Panel";
import { LiveDot, MessagePill, Pill, StatusPill } from "../../components/ui/Pill";
import { cn } from "../../lib/cn";
import { STAGES, STAGE_LABEL, dateTime, hostOf, num, pathOf, relTime } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { useWorker } from "../../lib/worker";
import { EvidenceChip, HookLegend, HookedText, NotReached, QuoteBlock, SectionHeading, SourceLink } from "./trail";

// ---------------------------------------------------------------------------------------------
// header pieces

function StageStepper({ p }: { p: ProspectDetail }) {
  const at = p.stage ? STAGES.indexOf(p.stage as (typeof STAGES)[number]) : p.status === "queued" ? -1 : STAGES.length;
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Pipeline progress">
      {STAGES.map((s, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full px-2 font-mono text-[11px]",
                done && "bg-active text-muted",
                now && "bg-live-bg text-live-ink",
                !done && !now && "text-faint",
              )}
              aria-current={now ? "step" : undefined}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : now ? <LiveDot /> : <CircleDashed className="h-3 w-3" aria-hidden />}
              {STAGE_LABEL[s]}
            </span>
            {i < STAGES.length - 1 && <span className="h-px w-3 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function ContactDialog({ p, open, onClose }: { p: ProspectDetail; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ first_name: "", last_name: "", email: "", title: "" });
  const qc = useQueryClient();
  const toast = useToast();
  const { kick } = useWorker();
  const m = useMutation({
    mutationFn: () => api.setContact(p.id, { first_name: f.first_name.trim(), last_name: f.last_name.trim() || undefined, email: f.email.trim(), title: f.title.trim() }),
    onSuccess: () => {
      invalidateWork(qc);
      kick();
      toast.success("Contact set", "A new draft is being written for them.");
      onClose();
    },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const fe = (k: string) => err?.errors.find((e) => e.startsWith(k))?.split(": ").slice(1).join(": ");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Set the contact by hand"
      description={`The Hunter search is skipped and pain points and the draft are written for this person at ${p.company_name ?? p.domain}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!f.first_name || !f.email || !f.title} onClick={() => m.mutate()}>Save and draft</Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {err && !err.errors.length && <Notice tone="negative" className="sm:col-span-2">{err.detail}</Notice>}
        <Field label="First name" error={fe("first_name")}>{(pp) => <Input {...pp} data-autofocus value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} autoComplete="off" />}</Field>
        <Field label="Last name" optional>{(pp) => <Input {...pp} value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} autoComplete="off" />}</Field>
        <Field label="Email" error={fe("email")}>{(pp) => <Input {...pp} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={`name@${p.domain}`} autoComplete="off" />}</Field>
        <Field label="Title" error={fe("title")} help="The title decides which persona's pains are used.">{(pp) => <Input {...pp} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Head of Security" />}</Field>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. why this company

function SignalRow({ s }: { s: SignalScore }) {
  const known = s.status === "known";
  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_110px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.label}</span>
          <span className="font-mono text-[11px] text-faint">{s.group} · weight {s.weight}</span>
          {!known && <Pill tone="outline">unknown</Pill>}
        </div>
        <p className={cn("mt-0.5 text-[13px]", known ? "text-muted" : "text-faint")}>{s.basis}</p>
        {s.evidence.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-2.5">
            {s.evidence.map((e, i) => <QuoteBlock key={i} quote={e.quote} url={e.source_url} />)}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2 sm:flex-col sm:items-end">
        <span className={cn("num font-display text-[26px] leading-none", known ? (s.points_min > 0 ? "text-ink" : "text-faint") : "text-faint")}>
          {known ? `+${s.points_min}` : `+0–${s.points_max}`}
        </span>
        <div className="mt-1 h-1 w-full min-w-[80px] max-w-[110px] rounded-full bg-active" aria-hidden>
          {known ? (
            <div className="h-1 rounded-full bg-positive" style={{ width: `${(s.points_min / Math.max(1, s.weight)) * 100}%` }} />
          ) : (
            <div className="h-1 rounded-full border border-dashed border-faint/70" style={{ width: "100%" }} />
          )}
        </div>
      </div>
    </li>
  );
}

function verdictTone(v: Qualification["verdict"]) {
  return v === "qualified" ? "positive" : v === "disqualified" ? "neutral" : "warning";
}

function WhyCompany({ trail, p }: { trail: ProspectTrail; p: ProspectDetail }) {
  const q = trail.qualify;
  if (!q) {
    const scraped = trail.scrape;
    return (
      <NotReached>
        {p.status === "failed"
          ? `Research failed before scoring: ${p.error ?? "unknown error"}.`
          : scraped && scraped.usable === 0
            ? `No usable pages: ${scraped.pages.length} fetched, none had enough text to score.`
            : p.status === "queued" || p.status === "researching"
              ? "Scoring runs after the website is read and facts are extracted."
              : "Not scored yet."}
      </NotReached>
    );
  }
  const sc = q.score;
  const th = q.thresholds;
  const known = sc.signals.filter((s) => s.status === "known").length;
  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={verdictTone(q.verdict)} dot>
            {q.verdict === "qualified" ? "Qualified" : q.verdict === "disqualified" ? "Disqualified" : "Insufficient data"}
          </Pill>
          {q.initial_verdict === "loop" && <Pill tone="outline">after research loop</Pill>}
          <span className="font-mono text-[11px] text-faint">rubric {q.rubric_version}</span>
        </div>
        <p className="mt-3 text-[15px] leading-6">{p.summary ?? q.reason}</p>
        <p className="mt-1 font-mono text-xs text-muted">{q.reason}</p>
        <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-muted">Score</div>
            <div className="num font-display text-[44px] leading-none">
              {sc.score_min === sc.score_max ? sc.score_min : `${sc.score_min}–${sc.score_max}`}
            </div>
          </div>
          {sc.score_expected != null && sc.score_min !== sc.score_max && (
            <div>
              <div className="text-xs text-muted">Expected</div>
              <div className="num font-display text-[28px] leading-none text-muted">{num(sc.score_expected, sc.score_expected % 1 ? 1 : 0)}</div>
            </div>
          )}
          <div className="text-xs text-muted">
            {known} of {sc.signals.length} signals known
            {sc.unknown_signals.length > 0 && <> · unknown: {sc.unknown_signals.join(", ")}</>}
          </div>
        </div>
        <ScoreBar className="mt-5" size="lg" showLabels min={sc.score_min} max={sc.score_max} expected={sc.score_expected} qualifyMin={th.qualify_min ?? 60} rejectMax={th.reject_max ?? 45} />
        {q.manual_override && (
          <Notice tone="warning" className="mt-5" title="Manual override">{q.manual_override}</Notice>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
          <h3 className="text-[15px] font-medium">Rubric signals</h3>
          <span className="text-xs text-muted">points from quotes on their own pages</span>
        </div>
        <ul className="divide-y divide-rule">{sc.signals.map((s) => <SignalRow key={s.id} s={s} />)}</ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="border-b border-rule px-4 py-2.5 text-[15px] font-medium">Gates</h3>
          <ul className="divide-y divide-rule">
            {sc.gates.map((g) => (
              <li key={g.id} className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", g.status === "pass" ? "bg-positive-bg text-positive" : g.status === "fail" ? "bg-negative-bg text-negative" : "bg-active text-faint")}>
                  {g.status === "pass" ? <Check className="h-3 w-3" /> : g.status === "fail" ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                </span>
                <div className="min-w-0 text-[13px]">
                  <div className="font-medium text-ink">{g.label}</div>
                  <div className="text-muted">{g.status === "unknown" ? "Unknown (not a fail): " : g.status === "fail" ? "Failed: " : ""}{g.basis}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h3 className="border-b border-rule px-4 py-2.5 text-[15px] font-medium">Penalties</h3>
          {sc.penalties.length ? (
            <ul className="divide-y divide-rule">
              {sc.penalties.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <span>{x.label}</span>
                  <span className="num font-medium text-negative">−{x.points}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-[13px] text-muted">None applied. Penalties lower the score when a company already holds the certifications the product helps with.</p>
          )}
        </Panel>
      </div>

      {q.research && q.research.steps.length > 0 && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
            <h3 className="text-[15px] font-medium">Research loop</h3>
            <span className="font-mono text-[11px] text-muted">
              {q.research.iterations} steps · {q.research.fetches} fetched · stop: {q.research.stop_reason}
            </span>
          </div>
          <ol className="relative px-4 py-3">
            {q.research.steps.map((s) => (
              <li key={s.iteration} className="relative flex gap-3 pb-4 last:pb-0">
                <span className="relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-surface font-mono text-[11px] text-muted">{s.iteration}</span>
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{s.tool}</span>
                    {s.url && <SourceLink url={s.url} />}
                    <Pill tone={s.outcome === "fetched" ? "positive" : "warning"}>{s.outcome}</Pill>
                  </div>
                  {s.reason && <p className="mt-1 text-muted">Why: {s.reason}</p>}
                  <p className="num mt-1 font-mono text-[11px] text-faint">
                    score now {s.score_min}–{s.score_max}
                    {s.resolved_signals.length > 0 && <> · resolved {s.resolved_signals.join(", ")}</>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. why this person

function WhyPerson({ trail, p, onSetContact }: { trail: ProspectTrail; p: ProspectDetail; onSetContact: () => void }) {
  const poc = trail.poc;
  if (!poc) {
    const qualified = trail.qualify?.verdict === "qualified";
    return (
      <NotReached>
        {p.status === "no_contact" ? (
          <span className="flex flex-wrap items-center gap-3">
            <span>No suitable named person was found for this company{trail.qualify ? "" : ""}. Add one and a draft is written for them.</span>
            <Button size="sm" variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={onSetContact}>Add a contact</Button>
          </span>
        ) : trail.qualify && !qualified ? (
          "Not reached: the company did not qualify, so no contact search was run."
        ) : (
          "Not reached yet: the contact search runs after the company qualifies."
        )}
      </NotReached>
    );
  }
  const c = poc.contact;
  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-[20px] text-accent-ink">
            {c.first_name[0]}
            {c.last_name?.[0]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[26px] leading-7">{c.first_name} {c.last_name}</div>
            <div className="mt-0.5 text-[14px] text-muted">{c.position}</div>
            <div className="mt-1 font-mono text-xs text-muted">{c.email}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="outline">source: {c.source}</Pill>
            {c.confidence != null && <Pill tone={c.confidence >= 80 ? "positive" : "warning"}>confidence {c.confidence}</Pill>}
            <Pill tone="neutral">{poc.band} band</Pill>
          </div>
        </div>
        <p className="mt-4 text-[14px] leading-6">{poc.reason}</p>
        <p className="mt-1 text-xs text-muted">Size band {poc.band}: {poc.band_basis}. {poc.candidates_seen ? `${poc.candidates_seen} people seen.` : ""}</p>
        {poc.risks.length > 0 && (
          <Notice tone="warning" className="mt-4" title="Risks">
            <ul className="list-disc pl-4">{poc.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          </Notice>
        )}
      </Panel>
      {poc.top_candidates.length > 0 && (
        <Panel className="overflow-hidden">
          <h3 className="border-b border-rule px-4 py-2.5 text-[15px] font-medium">Ranked candidates</h3>
          <ol className="divide-y divide-rule">
            {poc.top_candidates.map((x, i) => (
              <li key={i} className={cn("grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-3 px-4 py-3 text-[13px]", !x.eligible && "opacity-70")}>
                <span className="num font-mono text-xs text-faint">{i + 1}</span>
                <div className="min-w-0">
                  <div className="font-medium">
                    {x.first_name || x.last_name ? `${x.first_name ?? ""} ${x.last_name ?? ""}` : <span className="text-faint">Unnamed</span>}
                    <span className="font-normal text-muted"> · {x.position ?? "no title"}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{x.notes.join(" · ")}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {x.eligible ? <span className="num font-medium">{x.score}</span> : <Pill tone="neutral">excluded</Pill>}
                  {x.eligible && <div className="h-1 w-16 rounded-full bg-active"><div className="h-1 rounded-full bg-accent" style={{ width: `${Math.min(100, x.score)}%` }} /></div>}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. why this email

function WhyEmail({ trail, p }: { trail: ProspectTrail; p: ProspectDetail }) {
  const d = trail.draft;
  const msg = p.messages.find((m) => m.step === 0);
  if (!d && !msg) return <NotReached>{trail.poc ? "Not reached yet: the draft is written after pain points are picked." : "Not reached: a draft needs a qualified company and a contact."}</NotReached>;
  const hooks = msg?.hook_map.length ? msg.hook_map : d?.hook_map ?? [];
  const v = d?.validation;
  const learned = p.learned_from ?? [];
  return (
    <div className="flex flex-col gap-4">
      {learned.length > 0 && (
        <Panel className="px-4 py-3">
          <p className="text-[13px] font-medium">Guided by {learned.length} email{learned.length > 1 ? "s" : ""} that got a good reply</p>
          <p className="mt-0.5 text-xs text-muted">The writer reused their approach (angle, structure, call to action). Every fact here still comes from this company's own pages.</p>
          <ul className="mt-2 flex flex-col gap-1 text-[13px]">
            {learned.map((w) => <li key={w.id} className="truncate">“{w.subject}” <span className="text-muted">· {w.persona || "contact"}{w.company ? ` at ${w.company}` : ""}</span></li>)}
          </ul>
        </Panel>
      )}
      {d && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
            <h3 className="text-[15px] font-medium">Pain points</h3>
            <span className="font-mono text-[11px] text-muted">source: {d.pain_points_source}</span>
          </div>
          <ul className="divide-y divide-rule">
            {d.pain_points.map((x, i) => {
              const ev = d.evidence_pack.find((e) => e.id === x.evidence_id);
              return (
                <li key={i} className="flex gap-3 px-4 py-3">
                  <EvidenceChip id={x.evidence_id} className="mt-0.5" />
                  <div className="min-w-0 text-[14px]">
                    <p>{x.pain}</p>
                    <p className="mt-0.5 text-[13px] text-muted">Why this person: {x.role_link}</p>
                    {ev && <p className="mt-1 text-xs text-faint">Rests on “{ev.quote}”</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      {msg && (
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
            <h3 className="text-[15px] font-medium">The email</h3>
            <MessagePill status={msg.status} />
            {msg.status === "needs_review" && <Link to={`/app/review?m=${msg.id}`} className="ml-auto text-sm font-medium text-accent hover:underline">Review and approve</Link>}
          </div>
          <div className="px-4 py-4 sm:px-6">
            <div className="text-[13px] text-muted">To {msg.to.name} &lt;{msg.to.email}&gt;</div>
            <div className="mt-1 text-[16px] font-medium">{msg.subject}</div>
            <HookedText body={msg.body} hooks={hooks} className="mt-4" />
            <div className="mt-4 whitespace-pre-wrap border-t border-dashed border-line pt-3 text-[13px] leading-5 text-faint">{msg.footer}</div>
          </div>
          <div className="border-t border-rule px-4 py-2.5"><HookLegend /></div>
        </Panel>
      )}
      {hooks.length > 0 && (
        <Panel>
          <h3 className="border-b border-rule px-4 py-2.5 text-[15px] font-medium">Every claim and what it rests on</h3>
          <ul className="divide-y divide-rule">
            {hooks.map((h, i) => (
              <li key={i} className="grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="flex gap-2"><EvidenceChip id={h.evidence_id} /><span className="font-medium">“{h.claim}”</span></div>
                {h.evidence_id.startsWith("S") ? (
                  <span className="text-muted">Playbook value claim {h.evidence_id}: {h.quote}</span>
                ) : (
                  <QuoteBlock quote={h.quote} url={h.source_url} />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {v && (
        <Notice tone={v.ok ? "positive" : "warning"} icon={v.ok ? <ShieldCheck className="h-4 w-4" /> : undefined} title={v.ok ? `Validator passed after ${v.attempts} attempt${v.attempts > 1 ? "s" : ""}` : `Validator refused the draft after ${v.attempts} attempts`}>
          {v.ok ? "Every factual claim maps to a quote above or to a playbook value claim; word count, tone and banned phrases checked." : <ul className="list-disc pl-4">{v.failures.map((f) => <li key={f}>{f}</li>)}</ul>}
        </Notice>
      )}
      {d && d.evidence_pack.length > 0 && (
        <Panel>
          <h3 className="border-b border-rule px-4 py-2.5 text-[15px] font-medium">Evidence pack</h3>
          <ul className="divide-y divide-rule">
            {d.evidence_pack.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-3 text-[13px]">
                <EvidenceChip id={e.id} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">{e.fact}</div>
                  <div className="mt-0.5 text-muted">“{e.quote}” <SourceLink url={e.source_url} /></div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {p.messages.filter((m) => m.step > 0).map((m) => (
        <Panel key={m.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">Follow-up {m.step}</span>
            <MessagePill status={m.status} />
            <span className="text-muted">{m.sent_at ? `sent ${dateTime(m.sent_at)}` : m.scheduled_at ? `scheduled ${dateTime(m.scheduled_at)}` : ""}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted">{m.body}</p>
        </Panel>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// supporting detail

function Pages({ trail }: { trail: ProspectTrail }) {
  const s = trail.scrape;
  if (!s) return null;
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <h3 className="text-[15px] font-medium">Pages read</h3>
        <span className="text-xs text-muted">{s.usable} usable of {s.pages.length} · kinds: {s.kinds_found.join(", ") || "none"}</span>
      </div>
      <ul className="divide-y divide-rule">
        {s.pages.map((pg, i) => {
          const ok = pg.status === "ok" && pg.reason !== "too_short";
          return (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-positive" : "bg-warning")} aria-hidden />
              <a href={pg.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate font-mono text-xs hover:underline">{pathOf(pg.url)}</a>
              <span className="w-20 shrink-0 text-xs text-muted">{pg.kind ?? "—"}</span>
              <span className={cn("w-28 shrink-0 text-right text-xs", ok ? "num text-faint" : "text-warning-ink")}>{ok ? `${num(pg.chars)} chars` : pg.reason ?? pg.status}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Dropped({ trail }: { trail: ProspectTrail }) {
  const e = trail.extract;
  if (!e) return null;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <h3 className="text-[15px] font-medium">Evidence check</h3>
        <span className="num text-xs text-muted">{e.evidence_kept} kept of {e.evidence_total}</span>
      </div>
      {e.evidence_dropped.length ? (
        <ul className="divide-y divide-rule">
          {e.evidence_dropped.map((d, i) => (
            <li key={i} className="px-4 py-2.5 text-[13px]">
              <span className="text-muted line-through decoration-faint/60">“{d.quote}”</span>
              <span className="ml-2 text-xs text-warning-ink">dropped from {d.field}: {d.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[13px] text-muted">Every extracted fact was found verbatim on the page it cites.</p>
      )}
      {e.injection_suspected_pages.length > 0 && (
        <Notice tone="negative" className="m-4" title="Prompt injection suspected">{e.injection_suspected_pages.join(", ")}</Notice>
      )}
    </Panel>
  );
}

function Timeline({ p }: { p: ProspectDetail }) {
  if (!p.events.length) return null;
  const dot = { info: "bg-faint", success: "bg-positive", warning: "bg-warning", error: "bg-negative" } as const;
  return (
    <Panel>
      <h3 className="border-b border-rule px-4 py-2.5 text-[15px] font-medium">Timeline</h3>
      <ol className="px-4 py-3">
        {[...p.events].sort((a, b) => b.at.localeCompare(a.at)).map((e) => (
          <li key={e.id} className="flex gap-3 py-1.5 text-[13px]">
            <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", dot[e.level])} aria-hidden />
            <span className="min-w-0 flex-1">{e.message}</span>
            <time className="num shrink-0 text-xs text-faint" dateTime={e.at} title={dateTime(e.at)}>{relTime(e.at)}</time>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Section({ n, title, aside, children, id }: { n: number; title: string; aside?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20">
      <SectionHeading n={n} title={title} aside={aside} id={id} />
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export default function ProspectPage() {
  const id = Number(useParams().id);
  const first = useProspect(id);
  const live = first.data?.status === "queued" || first.data?.status === "researching";
  const q = useProspect(id, live ? 3000 : false);
  const camp = useCampaign(q.data?.campaign_id ?? NaN);
  usePlaybook(camp.data?.playbook.id ?? NaN);
  const [contactOpen, setContactOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { kick } = useWorker();

  const act = useMutation({
    mutationFn: async (kind: "rerun" | "override") => (kind === "rerun" ? api.rerunProspect(id) : api.overrideProspect(id)),
    onSuccess: (_r, kind) => {
      invalidateWork(qc);
      kick();
      toast.success(kind === "rerun" ? "Rerun queued" : "Overridden to qualified", kind === "rerun" ? "Cached pages make this quick." : "Logged as a manual override; finding a contact next.");
    },
    onError: (e) => toast.error("That didn't work", errorMessage(e)),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} what="this company" />;
  const p = q.data;
  if (!p)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-6 h-48 w-full" />
      </div>
    );

  const override = async () => {
    const ok = await confirm({
      title: "Continue as qualified?",
      body: "The evidence did not settle the score. Overriding continues to the contact search and draft, and the decision trail records it as your manual override.",
      confirm: "Override and continue",
    });
    if (ok) act.mutate("override");
  };
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${p.company_name ?? p.domain}?`, body: "Its decision trail and any unsent drafts are deleted. This cannot be undone.", confirm: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.deleteProspect(id);
      invalidateWork(qc);
      toast.success("Company deleted");
      nav(`/app/campaigns/${p.campaign_id}`);
    } catch (e) {
      toast.error("Couldn't delete", errorMessage(e));
    }
  };

  const busy = p.status === "queued" || p.status === "researching";

  return (
    <div className="mx-auto max-w-[980px]">
      <header className="mb-8">
        <Link to={`/app/campaigns/${p.campaign_id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> {camp.data?.name ?? "Campaign"}
        </Link>
        <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[40px] leading-[44px] tracking-[-0.015em]">{p.company_name ?? p.domain}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <StatusPill status={p.status} stage={p.stage} />
              <a href={`https://${p.domain}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-[13px] text-muted hover:text-ink">
                {hostOf(`https://${p.domain}`)} <ExternalLink className="h-3 w-3" />
              </a>
              {p.next_step && <span className="text-muted">Next: <span className="text-ink">{p.next_step}</span></span>}
              <span className="text-faint">updated {relTime(p.updated_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {p.status === "insufficient_data" && <Button variant="primary" onClick={override} loading={act.isPending && act.variables === "override"}>Override to qualified</Button>}
            {p.status === "no_contact" && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setContactOpen(true)}>Add a contact</Button>}
            {p.status === "needs_review" && (
              <Link to={`/app/review?m=${p.messages.find((m) => m.status === "needs_review")?.id ?? ""}`}><Button variant="primary">Review draft</Button></Link>
            )}
            <Button icon={<RotateCw className="h-4 w-4" />} onClick={() => act.mutate("rerun")} loading={act.isPending && act.variables === "rerun"} disabled={busy}>Rerun</Button>
            <Menu
              label="Company actions"
              items={[
                { label: "Set contact by hand", icon: <UserPlus className="h-4 w-4" />, onSelect: () => setContactOpen(true) },
                "separator",
                { label: "Delete company", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: remove },
              ]}
              trigger={(pp) => <IconButton label="More actions" {...pp} className="border border-control bg-surface"><MoreHorizontal className="h-4 w-4" /></IconButton>}
            />
          </div>
        </div>
        {p.summary && !busy && <p className="mt-4 max-w-[70ch] text-[15px] leading-6 text-muted">{p.summary}</p>}
        {busy && (
          <div className="mt-5 rounded-card border border-live/30 bg-live-bg/40 px-4 py-3">
            <StageStepper p={p} />
          </div>
        )}
        {p.status === "failed" && p.error && (
          <Notice tone="negative" className="mt-5" icon={<AlertTriangle className="h-4 w-4" />} title="Research failed" action={<Button size="sm" onClick={() => act.mutate("rerun")}>Rerun</Button>}>
            {p.error}
          </Notice>
        )}
        <nav aria-label="Decision trail sections" className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-b border-line pb-2 text-sm">
          <a href="#why-company" className="text-muted hover:text-ink">1. Why this company</a>
          <a href="#why-person" className="text-muted hover:text-ink">2. Why this person</a>
          <a href="#why-email" className="text-muted hover:text-ink">3. Why this email</a>
          <a href="#detail" className="text-muted hover:text-ink">Pages and timeline</a>
        </nav>
      </header>

      <div className="flex flex-col gap-12">
        <Section n={1} title="Why this company" id="why-company">
          <WhyCompany trail={p.trail} p={p} />
        </Section>
        <Section n={2} title="Why this person" id="why-person">
          <WhyPerson trail={p.trail} p={p} onSetContact={() => setContactOpen(true)} />
        </Section>
        <Section n={3} title="Why this email" id="why-email">
          <WhyEmail trail={p.trail} p={p} />
        </Section>
        <section id="detail" aria-label="Pages and timeline" className="grid scroll-mt-20 items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Pages trail={p.trail} />
            <Dropped trail={p.trail} />
          </div>
          <Timeline p={p} />
        </section>
      </div>
      <ContactDialog p={p} open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
