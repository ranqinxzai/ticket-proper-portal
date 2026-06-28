"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { BrandMark } from "@/components/shell/brand-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsoleAuth } from "@/lib/console/auth";
import { consoleTokenStore } from "@/lib/console/client";

export default function ConsoleLoginPage() {
  const router = useRouter();
  const { login } = useConsoleAuth();
  const userId = useId();
  const passId = useId();
  const errId = useId();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Skip the form.
  useEffect(() => {
    if (consoleTokenStore.access) router.replace("/console");
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      router.replace("/console");
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
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8 text-lg" />
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Platform Console
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Super-admin sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage organisations across the platform.
          </p>
        </div>
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
      </div>
    </div>
  );
}
