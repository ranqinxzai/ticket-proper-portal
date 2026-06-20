"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ItsmAuthProvider, useItsmAuth } from "@/lib/itsm/auth";

function LoginForm() {
  const { login, user } = useItsmAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in → go straight to the queue.
  useEffect(() => {
    if (user) router.replace("/queues");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      router.replace("/queues");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Brand panel */}
      <div className="hidden lg:flex relative flex-col justify-between p-10 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white">
        <div className="flex items-center gap-2">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-2">
            <Ticket className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">ITSM Platform</span>
        </div>
        <div className="space-y-4 max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Service management, done right.
          </h1>
          <p className="text-slate-300 leading-relaxed">
            Triage incidents, track SLAs in real time, and move every ticket through a workflow your team trusts.
          </p>
        </div>
        <div className="text-xs text-slate-400">© {new Date().getFullYear()} ITSM Platform</div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-md border-none shadow-lg">
          <CardHeader className="space-y-2">
            <div className="flex lg:hidden items-center gap-2 mb-4">
              <div className="bg-slate-900 text-white rounded-lg p-2">
                <Ticket className="h-5 w-5" />
              </div>
              <span className="text-lg font-semibold">ITSM Platform</span>
            </div>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>Use your ITSM agent account to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ItsmLoginPage() {
  return (
    <ItsmAuthProvider>
      <LoginForm />
    </ItsmAuthProvider>
  );
}
