"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MailCheck } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BrandMark } from "@/components/shell/brand-mark";
import { LoginHero } from "@/components/auth/login-hero";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/itsm/api";
import { setApiOrg } from "@/lib/itsm/client";
import {
  FORGOT_PASSWORD_HELP,
  FORGOT_PASSWORD_SENT,
  LOGIN_USERNAME_HELP,
} from "@/lib/itsm/help/portal";
import { orgLogin } from "@/lib/itsm/nav";

/** "Forgot password?" — asks for a reset email. The answer is the same whether or not
 *  an account matched (the backend never says), so the confirmation is generic. */
export default function ForgotPasswordPage() {
  const { org = "" } = useParams<{ org: string }>();
  const loginId = useId();
  const errId = useId();
  const [login, setLogin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The (auth) group isn't wrapped by ItsmAuthProvider — point the client at this org.
  useEffect(() => {
    if (org) setApiOrg(org);
  }, [org]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      setApiOrg(org);
      await authApi.requestPasswordReset(login.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
          {sent ? (
            <div className="mt-8 space-y-4" role="status">
              <MailCheck className="h-10 w-10 text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
              <p className="text-sm text-muted-foreground">{FORGOT_PASSWORD_SENT}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={orgLogin(org)}>Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-8">
                <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
                  Reset your password
                  <InfoTip label="How does resetting work?">{FORGOT_PASSWORD_HELP}</InfoTip>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter your username or email and we&apos;ll send you a link to choose a new password.
                </p>
              </div>
              <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={loginId}>Username or email</Label>
                    <InfoTip label="What can I enter?">{LOGIN_USERNAME_HELP}</InfoTip>
                  </div>
                  <Input
                    id={loginId}
                    name="username"
                    autoComplete="username"
                    autoFocus
                    required
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errId : undefined}
                  />
                </div>
                {error ? (
                  <p id={errId} role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <Hint
                  label={submitting ? "Sending…" : !login.trim() ? "Enter your username or email first" : ""}
                  className="w-full"
                >
                  <Button type="submit" className="w-full" disabled={submitting || !login.trim()}>
                    {submitting ? "Sending…" : "Email me a reset link"}
                  </Button>
                </Hint>
              </form>
              <Link
                href={orgLogin(org)}
                className="mt-6 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
