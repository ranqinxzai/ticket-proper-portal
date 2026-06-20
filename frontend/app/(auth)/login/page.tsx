"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { homePathFor } from "@/lib/itsm/auth";
import { authApi } from "@/lib/itsm/api";
import { tokenStore } from "@/lib/itsm/client";
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
  const userId = useId();
  const passId = useId();
  const errId = useId();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Skip the form.
  useEffect(() => {
    if (tokenStore.access) {
      router.replace(nextTarget() || homePathFor(tokenStore.getUser<ItsmUser>()));
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.login(username, password);
      tokenStore.setTokens(res.access, res.refresh);
      tokenStore.setUser(res.user);
      router.replace(nextTarget() || homePathFor(res.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Check your credentials.");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground"
          >
            <LifeBuoy className="h-5 w-5" />
          </span>
          <div>
            <CardTitle>Sign in to ServiceDesk</CardTitle>
            <CardDescription>Agent &amp; service-desk console.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
        </CardContent>
      </Card>
    </div>
  );
}
