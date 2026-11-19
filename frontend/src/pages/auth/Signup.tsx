import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, MOCK, errorMessage } from "../../api/client";
import { qk } from "../../api/hooks";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Feedback";
import { Field, Input } from "../../components/ui/Field";
import { useMe } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";

export default function Signup() {
  const me = useMe();
  const [f, setF] = useState({ name: "", email: "", password: "", workspace_name: "" });
  const qc = useQueryClient();
  const nav = useNavigate();
  const m = useMutation({
    mutationFn: () => api.signup({ ...f, email: f.email.trim(), name: f.name.trim(), workspace_name: f.workspace_name.trim() }),
    onSuccess: (s) => {
      qc.clear();
      qc.setQueryData(qk.me, s);
      nav("/onboarding", { replace: true });
    },
  });
  if (me.data && !m.isSuccess) return <Navigate to="/app" replace />;
  const err = m.error instanceof ApiError ? m.error : null;
  const fe = (k: string) => err?.errors.find((e) => e.startsWith(k))?.split(": ").slice(1).join(": ");
  const short = f.password.length > 0 && f.password.length < 8;
  return (
    <AuthLayout
      title="Start your workspace"
      subtitle="It comes with the Sprinto playbook and test mode on, so nothing reaches a prospect until you say so."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && (!err || !err.errors.length) && <Notice tone="negative">{errorMessage(m.error)}</Notice>}
        {MOCK && <Notice tone="info">Mock mode: signing up starts an empty workspace in memory.</Notice>}
        <Field label="Your name" error={fe("name")}>{(p) => <Input {...p} autoComplete="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Work email" error={fe("email")}>{(p) => <Input {...p} type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Password" help="At least 8 characters." error={fe("password") ?? (short ? `${8 - f.password.length} more character${8 - f.password.length > 1 ? "s" : ""}` : undefined)}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
        </Field>
        <Field label="Workspace name" help="Usually your company or team." error={fe("workspace_name")}>
          {(p) => <Input {...p} autoComplete="organization" required value={f.workspace_name} onChange={(e) => setF({ ...f, workspace_name: e.target.value })} />}
        </Field>
        <Button type="submit" variant="primary" loading={m.isPending} disabled={f.password.length < 8} className="mt-2 w-full">Create workspace</Button>
      </form>
    </AuthLayout>
  );
}
