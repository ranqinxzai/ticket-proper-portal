"use client";

import { useEffect, useId, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BrandMark } from "@/components/shell/brand-mark";
import { LoginHero } from "@/components/auth/login-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { homePathFor } from "@/lib/itsm/nav";
import { authApi } from "@/lib/itsm/api";
import { setApiOrg, tokenStore } from "@/lib/itsm/client";
import type { ItsmUser } from "@/lib/itsm/types";

/** Read the post-login `?next=` target without useSearchParams (avoids the
 * Next 14 static-bailout that would require a Suspense boundary). */
function nextTarget(): string | null {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next");
  // Only allow same-origin relative paths.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export default function LoginPage() {
  const router = useRouter();
  const { org = "" } = useParams<{ org: string }>();
  const userId = useId();
  const passId = useId();
  const errId = useId();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The (auth) group isn't wrapped by ItsmAuthProvider — point the client at
  // this org so the login call targets `/t/<org>/itsm/auth/login/`.
  useEffect(() => {
    if (org) setApiOrg(org);
  }, [org]);

  // Already signed in? Skip the form.
  useEffect(() => {
    if (tokenStore.access) {
      router.replace(nextTarget() || homePathFor(tokenStore.getUser<ItsmUser>(), org));
    }
  }, [router, org]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.login(username, password);
      tokenStore.setTokens(res.access, res.refresh);
      tokenStore.setUser(res.user);
      router.replace(nextTarget() || homePathFor(res.user, org));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Check your credentials.");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[1fr_clamp(360px,38%,520px)]">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      {/* Left: branded helpdesk hero (desktop only). */}
      <LoginHero className="hidden lg:block" />

      {/* Right: sign-in form (~38% on desktop, full width on mobile). */}
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandMark className="text-lg" />
          <div className="mt-8">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to One Helpdesk</h1>
            <p className="mt-1 text-sm text-muted-foreground">Agent &amp; service-desk console.</p>
          </div>
          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor={userId}>Username</Label>
              <Input
                id={userId}
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errId : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={passId}>Password</Label>
              <Input
                id={passId}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errId : undefined}
              />
            </div>
            {error ? (
              <p id={errId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
