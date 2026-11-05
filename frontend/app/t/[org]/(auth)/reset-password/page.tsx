"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Link2Off, Loader2 } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BrandMark } from "@/components/shell/brand-mark";
import { LoginHero } from "@/components/auth/login-hero";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/itsm/api";
import { ItsmApiError, setApiOrg } from "@/lib/itsm/client";
import { RESET_PASSWORD_RULES } from "@/lib/itsm/help/portal";
import { orgForgotPassword, orgLogin } from "@/lib/itsm/nav";

type Phase = "checking" | "invalid" | "form" | "done";

/** Read uid + token from the email link, then strip them from the address bar so the
 *  token doesn't linger in history / screenshots. Read from window (not
 *  useSearchParams) so the page needs no Suspense boundary. */
function takeLinkParams(): { uid: string; token: string } {
  if (typeof window === "undefined") return { uid: "", token: "" };
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  if (uid || token) window.history.replaceState({}, "", window.location.pathname);
  return { uid, token };
}

/** Pull a readable message out of a 400 body ({detail} or {new_password: [...]}). */
function errorText(err: unknown): string {
  if (err instanceof ItsmApiError) {
    const pw = err.fieldErrors?.new_password;
    if (pw?.length) return pw.join(" ");
    return err.message;
  }
  return err instanceof Error ? err.message : "Could not change your password.";
}

export default function ResetPasswordPage() {
  const { org = "" } = useParams<{ org: string }>();
  const pwId = useId();
  const confirmId = useId();
  const errId = useId();
  const [link, setLink] = useState<{ uid: string; token: string }>({ uid: "", token: "" });
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!org) return;
    setApiOrg(org);
    const params = takeLinkParams();
    setLink(params);
    if (!params.uid || !params.token) {
      setPhase("invalid");
      return;
    }
    authApi
      .validatePasswordReset(params.uid, params.token)
      .then((r) => setPhase(r.valid ? "form" : "invalid"))
      .catch(() => setPhase("invalid"));
  }, [org]);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const blockReason = submitting
    ? "Saving…"
    : password.length < 8
      ? "Use at least 8 characters"
      : confirm !== password
        ? "The two passwords don't match"
        : "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blockReason) return;
    setError(null);
    setSubmitting(true);
    try {
      setApiOrg(org);
      await authApi.confirmPasswordReset(link.uid, link.token, password);
      setPhase("done");
    } catch (err) {
      setError(errorText(err));
      // An expired / used link can't be retried — show the "request a new link" state.
      if (err instanceof ItsmApiError && /invalid or has expired/i.test(err.message)) setPhase("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[1fr_clamp(360px,38%,520px)]">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>
      <LoginHero className="hidden lg:block" />
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandMark className="text-lg" />
          {phase === "checking" ? (
            <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking your link…
            </p>
          ) : phase === "invalid" ? (
            <div className="mt-8 space-y-4">
              <Link2Off className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h1 className="text-2xl font-semibold tracking-tight">This link can&apos;t be used</h1>
              <p className="text-sm text-muted-foreground">
                Reset links work for 60 minutes and only once. Request a new one and use the latest
                email.
              </p>
              <Button asChild className="w-full">
                <Link href={orgForgotPassword(org)}>Request a new link</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={orgLogin(org)}>Back to sign in</Link>
              </Button>
            </div>
          ) : phase === "done" ? (
            <div className="mt-8 space-y-4" role="status">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
              <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
              <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
              <Button asChild className="w-full">
                <Link href={orgLogin(org)}>Sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-8">
                <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
                <p className="mt-1 text-sm text-muted-foreground">{RESET_PASSWORD_RULES}</p>
              </div>
              <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor={pwId}>New password</Label>
                  <Input
                    id={pwId}
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={tooShort || error ? true : undefined}
                    aria-describedby={error ? errId : undefined}
                  />
                  {tooShort ? (
                    <p className="text-xs text-destructive">Use at least 8 characters.</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={confirmId}>Confirm new password</Label>
                  <Input
                    id={confirmId}
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    aria-invalid={mismatch ? true : undefined}
                  />
                  {mismatch ? <p className="text-xs text-destructive">The passwords don&apos;t match.</p> : null}
                </div>
                {error ? (
                  <p id={errId} role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <Hint label={blockReason} className="w-full">
                  <Button type="submit" className="w-full" disabled={!!blockReason}>
                    {submitting ? "Saving…" : "Change password"}
                  </Button>
                </Hint>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
