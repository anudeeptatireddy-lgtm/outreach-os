import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { qk, usePlaybook, useQueryClient } from "../../api/hooks";
import { PAGE_KINDS, PROFILE_FIELDS, type Persona, type Playbook, type PlaybookInput, type RubricSignal, type SignalKind, type SizeBand } from "../../api/types";
import { ScoreBar } from "../../components/ScoreBar";
import { Button, IconButton } from "../../components/ui/Button";
import { ErrorState, Notice, Skeleton } from "../../components/ui/Feedback";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import { Panel } from "../../components/ui/Panel";
import { Tabs } from "../../components/ui/Tabs";
import { TagInput } from "../../components/ui/TagInput";
import { cn } from "../../lib/cn";
import { relTime } from "../../lib/format";
import { useToast } from "../../lib/toast";

type Tab = "product" | "research" | "icp" | "personas" | "email";
type Set<T> = (fn: (d: T) => T) => void;

const KINDS: { value: SignalKind; label: string; help: string }[] = [
  { value: "map", label: "Map value to points", help: "Each known value of the field earns a fixed number of points." },
  { value: "best", label: "Best status", help: "The best status among the mentions decides the points." },
  { value: "count", label: "Count tiers", help: "Points by how many items were found (for example named customers)." },
  { value: "keyword", label: "Keyword groups", help: "The best-matching keyword group in an attribute (for example job titles)." },
  { value: "text_keyword", label: "Text keywords", help: "Points when the field's text contains any keyword." },
  { value: "year_recency", label: "Year recency", help: "Points by how recent a dated fact is against the reference year." },
];

function Section({ title, description, children, aside }: { title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-rule py-7 last:border-b-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="text-[15px] font-medium">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function NumberInput({ value, onChange, label, step = 1, min, max, className }: { value: number; onChange: (v: number) => void; label: string; step?: number; min?: number; max?: number; className?: string }) {
  return (
    <Input
      type="number"
      aria-label={label}
      step={step}
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className={cn("num w-24", className)}
    />
  );
}

function RowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-accent hover:underline">
      <Plus className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

function ProductTab({ d, set }: { d: PlaybookInput; set: Set<PlaybookInput> }) {
  const p = d.product;
  const up = (k: keyof PlaybookInput["product"], v: string) => set((x) => ({ ...x, product: { ...x.product, [k]: v } }));
  const claims = d.value_claims;
  const renumber = (cs: { id: string; text: string }[]) => cs.map((c, i) => ({ ...c, id: `S${i + 1}` }));
  return (
    <>
      <Section title="Product" description="What you sell. The problem space steers which pain points are considered.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name">{(f) => <Input {...f} value={p.name} onChange={(e) => up("name", e.target.value)} />}</Field>
          <Field label="Website">{(f) => <Input {...f} value={p.website} onChange={(e) => up("website", e.target.value)} placeholder="https://" />}</Field>
          <Field label="One-liner" className="sm:col-span-2">{(f) => <Input {...f} value={p.one_liner} onChange={(e) => up("one_liner", e.target.value)} />}</Field>
          <Field label="Problem space" help='One or two words, like "compliance".'>{(f) => <Input {...f} value={p.problem_space} onChange={(e) => up("problem_space", e.target.value)} />}</Field>
        </div>
      </Section>
      <Section
        title="Value claims"
        description="Emails can only make these product claims; the validator rejects anything else. Keep each one short and literally true."
      >
        <ol className="flex flex-col gap-2">
          {claims.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 w-7 shrink-0 font-mono text-xs text-muted">{c.id}</span>
              <Textarea aria-label={`Value claim ${c.id}`} rows={2} value={c.text} onChange={(e) => set((x) => ({ ...x, value_claims: x.value_claims.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))} />
              <IconButton label={`Remove claim ${c.id}`} disabled={claims.length <= 1} onClick={() => set((x) => ({ ...x, value_claims: renumber(x.value_claims.filter((_, j) => j !== i)) }))}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ol>
        {claims.length < 5 ? (
          <div className="mt-3"><RowButton onClick={() => set((x) => ({ ...x, value_claims: renumber([...x.value_claims, { id: "", text: "" }]) }))}>Add claim</RowButton></div>
        ) : (
          <p className="mt-3 text-xs text-muted">Five claims is the limit.</p>
        )}
      </Section>
    </>
  );
}

function ResearchTab({ d, set }: { d: PlaybookInput; set: Set<PlaybookInput> }) {
  return (
    <Section title="Research focus" description="What extraction looks for on each company's pages. It fills the focus_mentions field the rubric reads.">
      <div className="flex flex-col gap-4">
        <Field label="Focus label" help='Shown in the decision trail, like "Compliance frameworks".'>
          {(f) => <Input {...f} value={d.research.focus_label} onChange={(e) => set((x) => ({ ...x, research: { ...x.research, focus_label: e.target.value } }))} />}
        </Field>
        <Field label="Instructions for extraction" help="Name what counts, the statuses to capture and that every fact must be quoted.">
          {(f) => <Textarea {...f} rows={6} value={d.research.focus_description} onChange={(e) => set((x) => ({ ...x, research: { ...x.research, focus_description: e.target.value } }))} />}
        </Field>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// ICP rubric

function PointsMap({ value, onChange, keyLabel = "Value" }: { value: Record<string, number>; onChange: (v: Record<string, number>) => void; keyLabel?: string }) {
  const rows = Object.entries(value);
  const write = (r: [string, number][]) => onChange(Object.fromEntries(r));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_96px_36px] gap-2 text-xs text-muted"><span>{keyLabel}</span><span className="text-right">Points</span><span /></div>
      {rows.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px_36px] items-center gap-2">
          <Input aria-label={`${keyLabel} ${i + 1}`} value={k} onChange={(e) => write(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} className="font-mono text-[13px]" />
          <NumberInput label={`Points for ${k}`} value={v} onChange={(n) => write(rows.map((r, j) => (j === i ? [r[0], n] : r)))} className="w-full text-right" />
          <IconButton label={`Remove ${k}`} onClick={() => write(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></IconButton>
        </div>
      ))}
      <RowButton onClick={() => write([...rows, [`value_${rows.length + 1}`, 0]])}>Add row</RowButton>
    </div>
  );
}

function KindChips({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {PAGE_KINDS.map((k) => {
        const on = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
            className={cn("h-7 rounded-full border px-2.5 font-mono text-xs transition-colors", on ? "border-ink bg-ink text-ground" : "border-line text-muted hover:text-ink")}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

function SignalCard({ s, i, n, update, remove, move }: { s: RubricSignal; i: number; n: number; update: (s: RubricSignal) => void; remove: () => void; move: (dir: -1 | 1) => void }) {
  const kind = KINDS.find((k) => k.value === s.kind);
  return (
    <Panel as="article" className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_72px]">
          <Field label="Label">{(f) => <Input {...f} value={s.label} onChange={(e) => update({ ...s, label: e.target.value })} />}</Field>
          <Field label="Id">{(f) => <Input {...f} value={s.id} onChange={(e) => update({ ...s, id: e.target.value.replace(/\s+/g, "_") })} className="font-mono text-[13px]" />}</Field>
          <Field label="Group">{(f) => <Input {...f} value={s.group} onChange={(e) => update({ ...s, group: e.target.value })} />}</Field>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[13px] font-medium">Weight</span>
          <NumberInput label={`Weight of ${s.label}`} value={s.weight} min={0} max={100} onChange={(w) => update({ ...s, weight: w })} className="w-20 text-right text-[15px] font-medium" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Reads field">
          {(f) => (
            <Select {...f} value={s.field} onChange={(e) => update({ ...s, field: e.target.value })}>
              {PROFILE_FIELDS.map((x) => <option key={x} value={x}>{x}</option>)}
              {!PROFILE_FIELDS.includes(s.field as (typeof PROFILE_FIELDS)[number]) && <option value={s.field}>{s.field}</option>}
            </Select>
          )}
        </Field>
        <Field label="Scoring" help={kind?.help}>
          {(f) => (
            <Select {...f} value={s.kind} onChange={(e) => update({ ...s, kind: e.target.value as SignalKind })}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <div className="mt-4 rounded-card bg-raised/70 p-3">
        {(s.kind === "map" || s.kind === "best" || s.kind === "year_recency") && (
          <PointsMap keyLabel={s.kind === "best" ? "Status" : s.kind === "year_recency" ? "Years ago" : "Value"} value={s.points ?? {}} onChange={(points) => update({ ...s, points })} />
        )}
        {s.kind === "count" && (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[120px_96px_36px] gap-2 text-xs text-muted"><span>At least</span><span className="text-right">Points</span><span /></div>
            {(s.tiers ?? []).map(([min, pts], j) => (
              <div key={j} className="grid grid-cols-[120px_96px_36px] items-center gap-2">
                <NumberInput label={`Tier ${j + 1} minimum`} value={min} min={0} onChange={(v) => update({ ...s, tiers: (s.tiers ?? []).map((t, k) => (k === j ? [v, t[1]] : t)) })} className="w-full" />
                <NumberInput label={`Tier ${j + 1} points`} value={pts} onChange={(v) => update({ ...s, tiers: (s.tiers ?? []).map((t, k) => (k === j ? [t[0], v] : t)) })} className="w-full text-right" />
                <IconButton label={`Remove tier ${j + 1}`} onClick={() => update({ ...s, tiers: (s.tiers ?? []).filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            ))}
            <RowButton onClick={() => update({ ...s, tiers: [...(s.tiers ?? []), [1, 0]] })}>Add tier</RowButton>
          </div>
        )}
        {s.kind === "keyword" && (
          <div className="flex flex-col gap-3">
            <Field label="Attribute" help='Which part of each item is matched, like "role".'>
              {(f) => <Input {...f} value={s.attribute ?? ""} onChange={(e) => update({ ...s, attribute: e.target.value || null })} className="w-48 font-mono text-[13px]" />}
            </Field>
            {(s.keyword_groups ?? []).map((g, j) => (
              <div key={j} className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)_36px] sm:items-start">
                <NumberInput label={`Group ${j + 1} points`} value={g.points} onChange={(v) => update({ ...s, keyword_groups: (s.keyword_groups ?? []).map((x, k) => (k === j ? { ...x, points: v } : x)) })} className="w-full" />
                <TagInput label={`Group ${j + 1} keywords`} value={g.keywords} onChange={(kw) => update({ ...s, keyword_groups: (s.keyword_groups ?? []).map((x, k) => (k === j ? { ...x, keywords: kw } : x)) })} />
                <IconButton label={`Remove group ${j + 1}`} onClick={() => update({ ...s, keyword_groups: (s.keyword_groups ?? []).filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            ))}
            <RowButton onClick={() => update({ ...s, keyword_groups: [...(s.keyword_groups ?? []), { points: 0, keywords: [] }] })}>Add keyword group</RowButton>
          </div>
        )}
        {s.kind === "text_keyword" && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Field label="Keywords">{(f) => <TagInput label="Keywords" id={f.id} value={s.keywords ?? []} onChange={(keywords) => update({ ...s, keywords })} />}</Field>
            <Field label="Points on match">{(f) => <Input {...f} type="number" value={s.points?.match ?? s.weight} onChange={(e) => update({ ...s, points: { match: Number(e.target.value) } })} className="num" />}</Field>
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Observed on</p>
          <KindChips label="Page kinds where absence counts as known" value={s.observed_on ?? []} onChange={(v) => update({ ...s, observed_on: v })} />
          <p className="mt-1 text-xs text-muted">If one of these pages was read and nothing matched, the signal is known at 0 instead of unknown.</p>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Research targets</p>
          <KindChips label="Page kinds the research loop may fetch" value={s.target_kinds ?? []} onChange={(v) => update({ ...s, target_kinds: v })} />
          <p className="mt-1 text-xs text-muted">Pages the research loop may fetch to resolve this signal.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1 border-t border-rule pt-3">
        <IconButton label="Move signal up" size="sm" disabled={i === 0} onClick={() => move(-1)}><ArrowUp className="h-4 w-4" /></IconButton>
        <IconButton label="Move signal down" size="sm" disabled={i === n - 1} onClick={() => move(1)}><ArrowDown className="h-4 w-4" /></IconButton>
        <Button size="sm" variant="ghost" className="ml-auto text-negative" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>Remove signal</Button>
      </div>
    </Panel>
  );
}

function WeightMeter({ sum }: { sum: number }) {
  const ok = sum === 100;
  return (
    <div className={cn("rounded-card border p-3", ok ? "border-line bg-surface" : "border-warning-line bg-warning-bg")} role="status" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">Weights</span>
        <span className={cn("num font-display text-[28px] leading-none", ok ? "text-ink" : "text-warning-ink")}>{sum}<span className="text-[16px] text-muted"> / 100</span></span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-active">
        <div className={cn("h-1.5 rounded-full", ok ? "bg-positive" : sum > 100 ? "bg-negative" : "bg-warning")} style={{ width: `${Math.min(100, sum)}%` }} />
      </div>
      <p className={cn("mt-2 text-xs", ok ? "text-muted" : "text-warning-ink")}>{ok ? "Weights sum to 100." : sum > 100 ? `${sum - 100} over. Saving is blocked until the weights sum to 100.` : `${100 - sum} short. Saving is blocked until the weights sum to 100.`}</p>
    </div>
  );
}

function IcpTab({ d, set }: { d: PlaybookInput; set: Set<PlaybookInput> }) {
  const icp = d.icp;
  const th = icp.thresholds;
  const sum = icp.signals.reduce((a, s) => a + (Number(s.weight) || 0), 0);
  const setIcp = (fn: (r: PlaybookInput["icp"]) => PlaybookInput["icp"]) => set((x) => ({ ...x, icp: fn(x.icp) }));
  const setTh = (k: keyof typeof th, v: number) => setIcp((r) => ({ ...r, thresholds: { ...r.thresholds, [k]: v } }));
  return (
    <>
      <Section title="Rubric" description="Every decision names the rubric version it was made under.">
        <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field label="Version">{(f) => <Input {...f} value={icp.version} onChange={(e) => setIcp((r) => ({ ...r, version: e.target.value }))} className="font-mono text-[13px]" />}</Field>
          <Field label="Description">{(f) => <Input {...f} value={icp.description} onChange={(e) => setIcp((r) => ({ ...r, description: e.target.value }))} />}</Field>
        </div>
      </Section>
      <Section
        title="Thresholds"
        description="Qualified when the minimum score reaches qualify_min, or, after research with at least two known signals, when the expected score reaches qualify_expected. Disqualified when even the maximum is below reject_max."
      >
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Qualify at">{(f) => <NumberInput {...f} label="qualify_min" value={th.qualify_min} onChange={(v) => setTh("qualify_min", v)} className="w-full" />}</Field>
          <Field label="Reject below">{(f) => <NumberInput {...f} label="reject_max" value={th.reject_max} onChange={(v) => setTh("reject_max", v)} className="w-full" />}</Field>
          <Field label="Expected at">{(f) => <NumberInput {...f} label="qualify_expected" value={th.qualify_expected} onChange={(v) => setTh("qualify_expected", v)} className="w-full" />}</Field>
          <Field label="Unknown credit" help="0 to 1">{(f) => <NumberInput {...f} label="unknown_credit" step={0.05} min={0} max={1} value={th.unknown_credit} onChange={(v) => setTh("unknown_credit", v)} className="w-full" />}</Field>
          <Field label="Reference year">{(f) => <NumberInput {...f} label="reference_year" value={th.reference_year} onChange={(v) => setTh("reference_year", v)} className="w-full" />}</Field>
        </div>
        <div className="mt-5 max-w-xl">
          <ScoreBar size="lg" showLabels min={th.reject_max} max={th.qualify_min} qualifyMin={th.qualify_min} rejectMax={th.reject_max} muted />
          <p className="mt-2 text-xs text-muted">The shaded band between {th.reject_max} and {th.qualify_min} is the gray zone where the research loop fetches more pages.</p>
        </div>
      </Section>
      <Section title="Signals" description="Weighted facts read from the company profile. Unknown signals count 0 in the minimum and their full weight in the maximum." aside={<div className="mt-4 lg:sticky lg:top-6"><WeightMeter sum={sum} /></div>}>
        <div className="flex flex-col gap-3">
          {icp.signals.map((s, i) => (
            <SignalCard
              key={i}
              s={s}
              i={i}
              n={icp.signals.length}
              update={(ns) => setIcp((r) => ({ ...r, signals: r.signals.map((x, j) => (j === i ? ns : x)) }))}
              remove={() => setIcp((r) => ({ ...r, signals: r.signals.filter((_, j) => j !== i) }))}
              move={(dir) => setIcp((r) => {
                const a = [...r.signals];
                const [x] = a.splice(i, 1);
                a.splice(i + dir, 0, x!);
                return { ...r, signals: a };
              })}
            />
          ))}
          <RowButton onClick={() => setIcp((r) => ({ ...r, signals: [...r.signals, { id: `signal_${r.signals.length + 1}`, label: "New signal", group: "A", weight: 0, kind: "map", field: "is_b2b", points: { true: 0 }, target_kinds: [] }] }))}>
            Add signal
          </RowButton>
        </div>
      </Section>
      <Section title="Gates" description="A failed gate disqualifies regardless of score. An unknown value is never a fail.">
        <div className="flex flex-col gap-3">
          {icp.gates.map((g, i) => (
            <div key={i} className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[140px_minmax(0,1fr)_150px_minmax(0,1fr)_36px] sm:items-end">
              <Field label="Id">{(f) => <Input {...f} value={g.id} onChange={(e) => setIcp((r) => ({ ...r, gates: r.gates.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) }))} className="font-mono text-[13px]" />}</Field>
              <Field label="Label">{(f) => <Input {...f} value={g.label} onChange={(e) => setIcp((r) => ({ ...r, gates: r.gates.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />}</Field>
              <Field label="Field">
                {(f) => (
                  <Select {...f} value={g.field} onChange={(e) => setIcp((r) => ({ ...r, gates: r.gates.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) }))}>
                    {PROFILE_FIELDS.map((x) => <option key={x}>{x}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Fails on">
                {(f) => (
                  <TagInput
                    label="Fail values"
                    id={f.id}
                    value={g.fail_values.map(String)}
                    onChange={(v) => setIcp((r) => ({ ...r, gates: r.gates.map((x, j) => (j === i ? { ...x, fail_values: v.map((s) => (s === "true" ? true : s === "false" ? false : s)) } : x)) }))}
                  />
                )}
              </Field>
              <IconButton label={`Remove gate ${g.id}`} onClick={() => setIcp((r) => ({ ...r, gates: r.gates.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" /></IconButton>
            </div>
          ))}
          <RowButton onClick={() => setIcp((r) => ({ ...r, gates: [...r.gates, { id: `G${r.gates.length + 1}`, label: "", field: "is_b2b", fail_values: [false] }] }))}>Add gate</RowButton>
        </div>
      </Section>
      <Section title="Penalties" description="Points taken off both bounds when every required framework is certified and none of the excluded ones is.">
        <div className="flex flex-col gap-3">
          {icp.penalties.map((p, i) => {
            const up = (patch: Partial<typeof p>) => setIcp((r) => ({ ...r, penalties: r.penalties.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
            return (
              <div key={i} className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-2">
                <Field label="Label">{(f) => <Input {...f} value={p.label} onChange={(e) => up({ label: e.target.value })} />}</Field>
                <div className="grid grid-cols-[minmax(0,1fr)_96px_36px] items-end gap-2">
                  <Field label="Id">{(f) => <Input {...f} value={p.id} onChange={(e) => up({ id: e.target.value })} className="font-mono text-[13px]" />}</Field>
                  <Field label="Points">{(f) => <NumberInput {...f} label="Penalty points" value={p.points} onChange={(v) => up({ points: v })} className="w-full" />}</Field>
                  <IconButton label={`Remove penalty ${p.id}`} onClick={() => setIcp((r) => ({ ...r, penalties: r.penalties.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" /></IconButton>
                </div>
                <Field label="Requires certified">{(f) => <TagInput id={f.id} label="Requires" value={p.requires} onChange={(v) => up({ requires: v })} placeholder="soc2typeii" />}</Field>
                <Field label="Unless certified" optional>{(f) => <TagInput id={f.id} label="Excludes" value={p.excludes ?? []} onChange={(v) => up({ excludes: v })} placeholder="iso27001" />}</Field>
              </div>
            );
          })}
          <RowButton onClick={() => setIcp((r) => ({ ...r, penalties: [...r.penalties, { id: `P${r.penalties.length + 1}`, label: "", points: 10, requires: [] }] }))}>Add penalty</RowButton>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// personas

function PersonasTab({ d, set }: { d: PlaybookInput; set: Set<PlaybookInput> }) {
  const ps = d.personas;
  const setP = (fn: (p: PlaybookInput["personas"]) => PlaybookInput["personas"]) => set((x) => ({ ...x, personas: fn(x.personas) }));
  const upPersona = (i: number, patch: Partial<Persona>) => setP((p) => ({ ...p, personas: p.personas.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const labelOf = (id: string) => ps.personas.find((p) => p.id === id)?.label ?? id;
  return (
    <>
      <Section title="Personas" description="Who to contact. A Hunter title matching a persona's patterns is ranked by the size band order below; the persona's two pains seed the email.">
        <div className="flex flex-col gap-3">
          {ps.personas.map((p, i) => (
            <Panel as="article" key={i} className="p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_36px] sm:items-end">
                <Field label="Label">{(f) => <Input {...f} value={p.label} onChange={(e) => upPersona(i, { label: e.target.value })} />}</Field>
                <Field label="Id">
                  {(f) => (
                    <Input
                      {...f}
                      value={p.id}
                      className="font-mono text-[13px]"
                      onChange={(e) => {
                        const id = e.target.value.replace(/\s+/g, "_");
                        const old = p.id;
                        setP((x) => ({
                          ...x,
                          personas: x.personas.map((y, j) => (j === i ? { ...y, id } : y)),
                          band_order: { small: x.band_order.small.map((b) => (b === old ? id : b)), mid: x.band_order.mid.map((b) => (b === old ? id : b)), large: x.band_order.large.map((b) => (b === old ? id : b)) },
                        }));
                      }}
                    />
                  )}
                </Field>
                <IconButton
                  label={`Remove persona ${p.label}`}
                  onClick={() => setP((x) => ({
                    ...x,
                    personas: x.personas.filter((_, j) => j !== i),
                    band_order: { small: x.band_order.small.filter((b) => b !== p.id), mid: x.band_order.mid.filter((b) => b !== p.id), large: x.band_order.large.filter((b) => b !== p.id) },
                  }))}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
              <Field label="Title patterns" className="mt-3" help="Matched case-insensitively against the person's job title.">
                {(f) => <TagInput id={f.id} describedBy={f["aria-describedby"]} label="Title patterns" value={p.title_patterns} onChange={(v) => upPersona(i, { title_patterns: v })} />}
              </Field>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[0, 1].map((k) => (
                  <Field key={k} label={`Pain ${k + 1}`}>
                    {(f) => <Textarea {...f} rows={2} value={p.pains[k] ?? ""} onChange={(e) => upPersona(i, { pains: (k === 0 ? [e.target.value, p.pains[1]] : [p.pains[0], e.target.value]) as [string, string] })} />}
                  </Field>
                ))}
              </div>
              <Field label="Why this role cares" className="mt-3" help='Completes "… because ___", like "a security lead owns posture and evidence".'>
                {(f) => <Input {...f} value={p.role_link} onChange={(e) => upPersona(i, { role_link: e.target.value })} />}
              </Field>
            </Panel>
          ))}
          <RowButton onClick={() => setP((x) => ({ ...x, personas: [...x.personas, { id: `persona_${x.personas.length + 1}`, label: "New persona", title_patterns: [], pains: ["", ""], role_link: "" }] }))}>Add persona</RowButton>
        </div>
      </Section>
      <Section title="Order by company size" description="Best first. Small is 1-50 people, mid 51-200, large 201 and up; an unknown size uses mid.">
        <div className="grid gap-3 md:grid-cols-3">
          {(["small", "mid", "large"] as SizeBand[]).map((band) => {
            const list = ps.band_order[band];
            const missing = ps.personas.filter((p) => !list.includes(p.id));
            const setBand = (v: string[]) => setP((x) => ({ ...x, band_order: { ...x.band_order, [band]: v } }));
            return (
              <Panel key={band} className="p-3">
                <h3 className="mb-2 text-[13px] font-medium capitalize">{band}</h3>
                <ol className="flex flex-col gap-1">
                  {list.map((id, i) => (
                    <li key={id} className="flex items-center gap-1 rounded-control bg-raised px-2 py-1 text-[13px]">
                      <span className="num w-5 font-mono text-[11px] text-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{labelOf(id)}</span>
                      <IconButton size="sm" label={`Move ${labelOf(id)} up in ${band}`} disabled={i === 0} onClick={() => { const a = [...list]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; setBand(a); }}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton size="sm" label={`Move ${labelOf(id)} down in ${band}`} disabled={i === list.length - 1} onClick={() => { const a = [...list]; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!]; setBand(a); }}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      <IconButton size="sm" label={`Remove ${labelOf(id)} from ${band}`} onClick={() => setBand(list.filter((x) => x !== id))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </li>
                  ))}
                </ol>
                {missing.length > 0 && (
                  <Select aria-label={`Add persona to ${band}`} className="mt-2" value="" onChange={(e) => e.target.value && setBand([...list, e.target.value])}>
                    <option value="">Add persona…</option>
                    {missing.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </Select>
                )}
              </Panel>
            );
          })}
        </div>
      </Section>
      <Section title="Never contact" description="A title containing any of these words is excluded outright, whatever else it says.">
        <TagInput label="Excluded title keywords" value={ps.exclude_title_keywords} onChange={(v) => setP((x) => ({ ...x, exclude_title_keywords: v }))} />
      </Section>
    </>
  );
}

function EmailTab({ d, set }: { d: PlaybookInput; set: Set<PlaybookInput> }) {
  const e = d.email;
  const up = (patch: Partial<PlaybookInput["email"]>) => set((x) => ({ ...x, email: { ...x.email, ...patch } }));
  return (
    <>
      <Section title="Length and tone" description="The validator rejects drafts outside the word range and any banned phrase.">
        <div className="grid gap-4 sm:grid-cols-[120px_120px_minmax(0,1fr)]">
          <Field label="Min words">{(f) => <NumberInput {...f} label="Min words" value={e.min_words} onChange={(v) => up({ min_words: v })} className="w-full" />}</Field>
          <Field label="Max words">{(f) => <NumberInput {...f} label="Max words" value={e.max_words} onChange={(v) => up({ max_words: v })} className="w-full" />}</Field>
          <div />
          <Field label="Tone" className="sm:col-span-3">{(f) => <Textarea {...f} rows={3} value={e.tone} onChange={(ev) => up({ tone: ev.target.value })} />}</Field>
          <Field label="Extra banned phrases" className="sm:col-span-3" help="Added to the built-in list (hope this finds you, reaching out, quick question…).">
            {(f) => <TagInput id={f.id} describedBy={f["aria-describedby"]} label="Extra banned phrases" value={e.extra_banned_phrases} onChange={(v) => up({ extra_banned_phrases: v })} />}
          </Field>
        </div>
      </Section>
      <Section title="Sender" description="Used in the footer of every email, with your workspace's postal address.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name">{(f) => <Input {...f} value={e.sender_name} onChange={(ev) => up({ sender_name: ev.target.value })} />}</Field>
          <Field label="Sender title">{(f) => <Input {...f} value={e.sender_title} onChange={(ev) => up({ sender_title: ev.target.value })} />}</Field>
        </div>
      </Section>
      <Section title="Follow-up angles" description="One per follow-up step, in order. Each follow-up adds one new, useful thing; never just a bump.">
        <ol className="flex flex-col gap-2">
          {e.followup_angles.map((a, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 w-20 shrink-0 text-xs text-muted">Follow-up {i + 1}</span>
              <Textarea aria-label={`Follow-up ${i + 1} angle`} rows={2} value={a} onChange={(ev) => up({ followup_angles: e.followup_angles.map((x, j) => (j === i ? ev.target.value : x)) })} />
              <IconButton label={`Remove follow-up ${i + 1} angle`} onClick={() => up({ followup_angles: e.followup_angles.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></IconButton>
            </li>
          ))}
        </ol>
        {e.followup_angles.length < 3 && <div className="mt-3"><RowButton onClick={() => up({ followup_angles: [...e.followup_angles, ""] })}>Add angle</RowButton></div>}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function toInput(p: Playbook): PlaybookInput {
  const { id: _i, version: _v, updated_at: _u, ...rest } = p;
  void _i;
  void _v;
  void _u;
  return structuredClone(rest);
}

const TAB_OF: Record<string, Tab> = { name: "product", product: "product", value_claims: "product", research: "research", icp: "icp", personas: "personas", email: "email" };

export default function PlaybookEditor() {
  const id = Number(useParams().id);
  const q = usePlaybook(id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "product";
  const setTab = (t: Tab) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });
  const [draft, setDraft] = useState<PlaybookInput | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (q.data && !draft) setDraft(toInput(q.data));
  }, [q.data, draft]);

  const dirty = useMemo(() => !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(toInput(q.data)), [draft, q.data]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api.putPlaybook(id, draft!),
    onSuccess: (p) => {
      qc.setQueryData(qk.playbook(id), p);
      void qc.invalidateQueries({ queryKey: qk.playbooks });
      setDraft(toInput(p));
      toast.success(`Saved as version ${p.version}`, "New research uses it; past decisions keep the version they were made under.");
    },
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} what="this playbook" />;
  if (!q.data || !draft)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-96" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );

  const set: Set<PlaybookInput> = (fn) => setDraft((d) => (d ? fn(d) : d));
  const sum = draft.icp.signals.reduce((a, s) => a + (Number(s.weight) || 0), 0);
  const blockedReason = sum !== 100 ? `Signal weights sum to ${sum}; they must sum to 100.` : null;
  const err = save.error instanceof ApiError ? save.error : null;
  const errTabs = new Map<Tab, number>();
  for (const e of err?.errors ?? []) {
    const t = TAB_OF[e.split(/[.:[ ]/)[0] ?? ""];
    if (t) errTabs.set(t, (errTabs.get(t) ?? 0) + 1);
  }
  const tabLabel = (t: Tab, label: string) => (errTabs.get(t) ? <span className="inline-flex items-center gap-1.5">{label}<span className="h-1.5 w-1.5 rounded-full bg-negative" aria-label="has errors" /></span> : label);

  return (
    <div className="pb-24">
      <Link to="/app/playbooks" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Playbooks</Link>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="pb-name" className="sr-only">Playbook name</label>
          <input
            id="pb-name"
            value={draft.name}
            onChange={(e) => set((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-control bg-transparent font-display text-[34px] leading-[40px] tracking-[-0.015em] outline-none hover:bg-active/50 focus:bg-surface focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1 text-[13px] text-muted">
            <span className="font-mono text-xs">v{q.data.version}</span> · saved {relTime(q.data.updated_at)}
            {q.data.template && <> · from the {q.data.template} template</>}
          </p>
        </div>
      </div>

      <Tabs<Tab>
        className="mt-6"
        label="Playbook sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "product", label: tabLabel("product", "Product & claims") },
          { value: "research", label: tabLabel("research", "Research focus") },
          { value: "icp", label: tabLabel("icp", "ICP rubric") },
          { value: "personas", label: tabLabel("personas", "Personas") },
          { value: "email", label: tabLabel("email", "Email rules") },
        ]}
      />

      {err && (
        <Notice tone="negative" className="mt-5" title={err.detail}>
          {err.errors.length > 0 && <ul className="list-disc pl-4">{err.errors.map((e) => <li key={e} className="font-mono text-xs">{e}</li>)}</ul>}
        </Notice>
      )}

      <div role="tabpanel">
        {tab === "product" && <ProductTab d={draft} set={set} />}
        {tab === "research" && <ResearchTab d={draft} set={set} />}
        {tab === "icp" && <IcpTab d={draft} set={set} />}
        {tab === "personas" && <PersonasTab d={draft} set={set} />}
        {tab === "email" && <EmailTab d={draft} set={set} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 lg:left-[240px]">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <span className="min-w-0 flex-1 text-[13px]">
            {blockedReason ? <span className="text-warning-ink">{blockedReason}</span> : dirty ? <span className="text-ink">Unsaved changes</span> : <span className="text-muted">All changes saved</span>}
          </span>
          <Button disabled={!dirty || save.isPending} onClick={() => { setDraft(toInput(q.data!)); save.reset(); }}>Discard</Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty || !!blockedReason} onClick={() => save.mutate()} title={blockedReason ?? undefined}>
            Save playbook
          </Button>
        </div>
      </div>
    </div>
  );
}
