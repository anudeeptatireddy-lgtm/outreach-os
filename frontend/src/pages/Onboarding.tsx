import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, FileText, FlaskConical, KeyRound, Wand2 } from "lucide-react";
import { api, errorMessage } from "../api/client";
import { qk, usePlaybooks, useQueryClient, useSettings } from "../api/hooks";
import type { SecretsBody } from "../api/types";
import { Orb, Wordmark } from "../components/brand/Orb";
import { scrambleIn, useGSAP } from "../components/motion/gsap";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Feedback";
import { Field, Input } from "../components/ui/Field";
import { Pill } from "../components/ui/Pill";
import { cn } from "../lib/cn";
import { useSession } from "../lib/session";
import { useToast } from "../lib/toast";

// Sample domains that show every outcome in demo mode (from the backend's demo fixtures).
const DEMO_DOMAINS = ["ledgerloop.io", "payrollpilot.com", "claimsbridge.ai", "fieldnote.dev", "pocketpals.app", "globalbank-cloud.com", "stealthco.xyz", "quietops.io"];

const STEPS = ["Playbook", "Keys", "Sending"] as const;

function Choice({ on, onClick, icon, title, body, children }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-card border bg-surface transition-colors", on ? "border-ink ring-1 ring-ink" : "border-line hover:border-control")}>
      <button type="button" role="radio" aria-checked={on} onClick={onClick} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="mt-0.5 text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="mt-0.5 block text-[13px] text-muted">{body}</span>
        </span>
        <span className={cn("mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border", on ? "border-ink" : "border-control")}>{on && <span className="h-2 w-2 rounded-full bg-ink" />}</span>
      </button>
      {on && children && <div className="border-t border-rule px-4 py-3">{children}</div>}
    </div>
  );
}

function PlaybookStep({ onNext }: { onNext: () => void }) {
  const [mode, setMode] = useState<"sprinto" | "blank" | "generate">("sprinto");
  const [site, setSite] = useState("");
  const pbs = usePlaybooks();
  const qc = useQueryClient();
  const toast = useToast();
  const hasSprinto = pbs.data?.some((p) => p.template === "sprinto");
  const m = useMutation({
    mutationFn: async () => {
      if (mode === "generate") return api.generatePlaybook(site.trim());
      if (mode === "blank") return api.createPlaybook({ template: "blank" });
      if (hasSprinto) return null; // signup already seeded it
      return api.createPlaybook({ template: "sprinto" });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: qk.playbooks });
      if (p) toast.success(mode === "generate" ? "Playbook drafted from your site" : "Playbook created", "You can edit every part of it later.");
      onNext();
    },
  });
  return (
    <>
      <h2 className="font-display text-[30px] leading-9">What are you selling?</h2>
      <p className="mt-1 text-[14px] text-muted">A playbook is your product, the claims an email may make, who qualifies and who to contact.</p>
      <div role="radiogroup" aria-label="Playbook" className="mt-6 flex flex-col gap-2">
        <Choice on={mode === "sprinto"} onClick={() => setMode("sprinto")} icon={<BookOpen className="h-4 w-4" />} title="Sprinto template" body="Compliance automation for SOC 2, ISO 27001 and GDPR: the full rubric, nine personas and the email rules." />
        <Choice on={mode === "generate"} onClick={() => setMode("generate")} icon={<Wand2 className="h-4 w-4" />} title="Generate from my website" body="We read your site and draft a playbook for you to review.">
          <Field label="Your website">{(p) => <Input {...p} value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourcompany.com" />}</Field>
          {m.isPending && <p className="mt-2 font-mono text-xs text-live-ink">reading {site || "your site"} · drafting product, claims, rubric and personas…</p>}
        </Choice>
        <Choice on={mode === "blank"} onClick={() => setMode("blank")} icon={<FileText className="h-4 w-4" />} title="Start blank" body="A minimal rubric to fill in yourself." />
      </div>
      {m.error && <Notice tone="negative" className="mt-4">{errorMessage(m.error)}</Notice>}
      <div className="mt-8 flex justify-end">
        <Button variant="primary" loading={m.isPending} disabled={mode === "generate" && !site.trim()} onClick={() => m.mutate()} icon={<ArrowRight className="h-4 w-4" />}>
          Continue
        </Button>
      </div>
    </>
  );
}

function KeysStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const s = useSettings();
  const [path, setPath] = useState<"keys" | "demo">("keys");
  const [v, setV] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      if (path === "demo") return api.patchSettings({ demo_mode: true });
      const body: SecretsBody = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim()));
      if (Object.keys(body).length) await api.putSecrets(body);
      return api.patchSettings({ demo_mode: false, ...(v.gmail_user ? { sending: { provider: "gmail" as const, from_email: v.gmail_user } } : v.resend_api_key ? { sending: { provider: "resend" as const } } : {}) });
    },
    onSuccess: (n) => {
      qc.setQueryData(qk.settings, n);
      void qc.invalidateQueries({ queryKey: qk.me });
      onNext();
    },
  });
  const ig = s.data?.integrations;
  const input = (key: keyof SecretsBody, label: string, type: "password" | "email" = "password", help?: string) => (
    <Field label={label} help={help}>
      {(p) => <Input {...p} type={type} autoComplete={type === "password" ? "new-password" : "off"} value={v[key] ?? ""} onChange={(e) => setV({ ...v, [key]: e.target.value })} />}
    </Field>
  );
  return (
    <>
      <h2 className="font-display text-[30px] leading-9">Connect your keys</h2>
      <p className="mt-1 text-[14px] text-muted">Keys are encrypted at rest and never shown again. Or try everything first in demo mode.</p>
      <div role="radiogroup" aria-label="Setup" className="mt-6 flex flex-col gap-2">
        <Choice on={path === "keys"} onClick={() => setPath("keys")} icon={<KeyRound className="h-4 w-4" />} title="Use my own keys" body="Gemini reads and drafts, Hunter finds people, Gmail or Resend sends.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">{input("gemini_api_key", "Gemini API key")}{ig?.gemini.configured && <Pill tone="positive" className="w-fit">already set {ig.gemini.source === "env" ? "on the server" : ""}</Pill>}</div>
            <div className="flex flex-col gap-1">{input("hunter_api_key", "Hunter API key")}{ig?.hunter.configured && <Pill tone="positive" className="w-fit">already set</Pill>}</div>
            {input("gmail_user", "Gmail address", "email")}
            {input("gmail_app_password", "Gmail app password", "password", "Create one under Google Account > Security > App passwords.")}
            <div className="sm:col-span-2">{input("resend_api_key", "Or a Resend API key", "password", "Use Resend instead of Gmail if you send from your own domain.")}</div>
          </div>
        </Choice>
        <Choice on={path === "demo"} onClick={() => setPath("demo")} icon={<FlaskConical className="h-4 w-4" />} title="Try demo mode" body="No keys, no network, nothing sent. The pipeline runs on built-in sample companies.">
          <p className="text-[13px] text-muted">Try these domains in your first campaign; together they show every outcome:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{DEMO_DOMAINS.map((d) => <span key={d} className="rounded bg-active px-2 py-0.5 font-mono text-xs">{d}</span>)}</div>
        </Choice>
      </div>
      {m.error && <Notice tone="negative" className="mt-4">{errorMessage(m.error)}</Notice>}
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
        <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()} icon={<ArrowRight className="h-4 w-4" />}>Continue</Button>
      </div>
    </>
  );
}

function SendingStep({ onBack }: { onBack: () => void }) {
  const { session } = useSession();
  const s = useSettings();
  const [owner, setOwner] = useState<string | null>(null);
  const [fromName, setFromName] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const ownerV = owner ?? s.data?.sending.owner_email ?? session.user.email;
  const fromV = fromName ?? s.data?.sending.from_name ?? session.user.name;
  const m = useMutation({
    mutationFn: async () => {
      await api.patchSettings({ sending: { mode: "test", owner_email: ownerV.trim(), from_name: fromV.trim() } });
      return api.patchSettings({ onboarded: true });
    },
    onSuccess: async (n) => {
      qc.setQueryData(qk.settings, n);
      await qc.invalidateQueries({ queryKey: qk.me });
      toast.success("You're set up", "Create a campaign to see your first decision trails.");
      nav("/app", { replace: true });
    },
  });
  return (
    <>
      <h2 className="font-display text-[30px] leading-9">Sending starts in test mode</h2>
      <p className="mt-1 text-[14px] text-muted">Nothing reaches a prospect until you switch to live in Settings.</p>
      <div className="mt-6 rounded-card border border-line bg-surface p-4">
        <p className="text-[13px] font-medium">How test mode works</p>
        <ul className="mt-2 flex flex-col gap-2 text-[13px] text-muted">
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" /> Every approved email is delivered to your own inbox below.</li>
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" /> The real recipient is shown in the subject, so you see exactly what they would get.</li>
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" /> Follow-ups, unsubscribe links and the daily cap behave as they will in live mode.</li>
        </ul>
        <p className="mt-3 rounded-control bg-raised px-3 py-2 font-mono text-xs text-ink">Subject: [TEST -&gt; Elena Varga &lt;elena@kestrelpay.com&gt;] iso 27001 this year</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Your inbox (test recipient)">{(p) => <Input {...p} type="email" value={ownerV} onChange={(e) => setOwner(e.target.value)} />}</Field>
        <Field label="From name">{(p) => <Input {...p} value={fromV} onChange={(e) => setFromName(e.target.value)} />}</Field>
      </div>
      {m.error && <Notice tone="negative" className="mt-4">{errorMessage(m.error)}</Notice>}
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
        <Button variant="primary" loading={m.isPending} disabled={!/.+@.+\..+/.test(ownerV)} onClick={() => m.mutate()}>Finish setup</Button>
      </div>
    </>
  );
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const { session } = useSession();
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const h = root.current?.querySelector<HTMLElement>("[data-scramble]");
    if (h) scrambleIn(h, { chars: "01" });
  }, { scope: root });
  return (
    <div ref={root} className="relative min-h-full overflow-hidden">
      <Orb variant="hero" className="pointer-events-none absolute -right-[22vmin] -top-[26vmin] opacity-70" />
      <div className="relative mx-auto flex min-h-full max-w-[640px] flex-col px-5 py-6">
        <div className="flex items-center justify-between">
          <Wordmark />
          <span className="font-mono text-xs text-muted">{session.workspace.name}</span>
        </div>
        <p className="mt-12 font-mono text-xs text-muted"><span data-scramble>setup your workspace</span> · {step + 1} of 3</p>
        <ol className="mt-3 flex gap-2" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1" aria-current={i === step ? "step" : undefined}>
              <div className={cn("h-1 rounded-full", i < step ? "bg-ink" : i === step ? "bg-accent" : "bg-active")} />
              <span className={cn("mt-1.5 block text-xs", i === step ? "text-ink" : "text-faint")}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 rounded-xl border border-line bg-ground/80 p-5 backdrop-blur-sm sm:p-8">
          {step === 0 && <PlaybookStep onNext={() => setStep(1)} />}
          {step === 1 && <KeysStep onNext={() => setStep(2)} onBack={() => setStep(0)} />}
          {step === 2 && <SendingStep onBack={() => setStep(1)} />}
        </div>
      </div>
    </div>
  );
}
