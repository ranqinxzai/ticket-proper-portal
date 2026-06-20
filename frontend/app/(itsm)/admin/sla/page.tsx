"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, ChevronRight, Loader2, Plus, Timer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { slaAdminApi } from "@/lib/itsm/admin-api";
import type { BusinessCalendar, SlaPolicy } from "@/lib/itsm/admin-types";
import { WEEKDAYS } from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";

export default function SlaAdminPage() {
  const router = useRouter();
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.sla.policies", "read");

  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pols, cals] = await Promise.all([slaAdminApi.policies(), slaAdminApi.calendars()]);
      setPolicies(pols);
      setCalendars(cals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load SLA data");
      setPolicies([]);
      setCalendars([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function createPolicy() {
    if (!newName.trim()) {
      toast.error("Name is required");
      return;
    }
    setCreating(true);
    try {
      const created = await slaAdminApi.createPolicy({ name: newName.trim(), is_active: true });
      toast.success("Policy created");
      setCreateOpen(false);
      setNewName("");
      router.push(`/admin/sla/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : e instanceof Error ? e.message : "Could not create policy");
    } finally {
      setCreating(false);
    }
  }

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/admin" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Timer className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">SLA Policies</h1>
        <Button className="ml-auto gap-1.5" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New policy
        </Button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-destructive">{error}</div>
      ) : (
        <>
          {/* Policies */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Policies</h2>
            {policies.length === 0 ? (
              <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
                No SLA policies yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-white divide-y">
                {policies.map((p) => (
                  <Link
                    key={p.id}
                    href={`/admin/sla/${p.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.is_default && <Badge variant="secondary">Default</Badge>}
                        <Badge variant={p.is_active ? "default" : "outline"}>
                          {p.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.metrics.length} metric{p.metrics.length === 1 ? "" : "s"}
                        {" · "}
                        {calendars.find((c) => c.id === p.calendar)?.name ?? "No calendar"}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Calendars */}
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <CalendarDays className="h-4 w-4" /> Business calendars
            </h2>
            {calendars.length === 0 ? (
              <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
                No business calendars defined.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {calendars.map((c) => (
                  <div key={c.id} className="rounded-lg border bg-white p-4">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      {c.is_default && <Badge variant="secondary">Default</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{c.timezone}</div>
                    <div className="mt-3 text-xs text-muted-foreground">{hoursSummary(c)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {c.holidays.length} holiday{c.holidays.length === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New SLA policy</DialogTitle>
            <DialogDescription>Give the policy a name. You can configure targets next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="sla-name">Name</Label>
            <Input
              id="sla-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Standard support SLA"
              onKeyDown={(e) => { if (e.key === "Enter") createPolicy(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createPolicy} disabled={creating}>
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function hoursSummary(c: BusinessCalendar): string {
  if (c.hours.length === 0) return "No business hours set";
  const days = Array.from(new Set(c.hours.map((h) => h.weekday))).sort((a, b) => a - b);
  const labels = days.map((d) => WEEKDAYS[d] ?? `D${d}`);
  // Show the most common time range if uniform.
  const first = c.hours[0];
  const uniform = c.hours.every((h) => h.start_time === first.start_time && h.end_time === first.end_time);
  const range = uniform ? ` ${hhmm(first.start_time)}–${hhmm(first.end_time)}` : "";
  return `${labels.join(", ")}${range}`;
}

function hhmm(t: string): string {
  return t.slice(0, 5);
}
