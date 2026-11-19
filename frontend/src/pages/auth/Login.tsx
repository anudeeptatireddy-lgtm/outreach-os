import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, MOCK, errorMessage } from "../../api/client";
import { qk } from "../../api/hooks";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Feedback";
import { Field, Input } from "../../components/ui/Field";
import { useMe } from "../../lib/session";
import { AuthLayout } from "./AuthLayout";
import { safeNext } from "../../lib/safeNext";

export default function Login() {
  const me = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();
  const m = useMutation({
    mutationFn: () => api.login({ email: email.trim(), password }),
    onSuccess: (s) => {
      qc.setQueryData(qk.me, s);
      nav(s.workspace.onboarded ? next : "/onboarding", { replace: true });
    },
  });
  if (me.data) return <Navigate to="/app" replace />;
  const err = m.error;
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to review drafts and see every decision trail."
      footer={<>New here? <Link to="/signup" className="font-medium text-accent hover:underline">Create a workspace</Link></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {err && <Notice tone="negative">{err instanceof ApiError && err.status === 401 ? "That email and password don't match." : errorMessage(err)}</Notice>}
        {MOCK && <Notice tone="info">Mock mode: any email and a password of 8 or more characters.</Notice>}
        <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" loading={m.isPending} className="mt-2 w-full">Sign in</Button>
      </form>
    </AuthLayout>
  );
}
