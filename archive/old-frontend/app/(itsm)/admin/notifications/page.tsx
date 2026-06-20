"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { notifAdminApi } from "@/lib/itsm/admin-api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { NotificationSchemeRow } from "@/lib/itsm/admin-types";
import { useItsmAuth } from "@/lib/itsm/auth";
import { NotificationSchemeEditor } from "@/components/itsm/NotificationSchemeEditor";
import { EmailTemplateEditor } from "@/components/itsm/EmailTemplateEditor";

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ItsmApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function NotificationsAdminPage() {
  const router = useRouter();
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.notifications.schemes", "read");

  const [schemes, setSchemes] = useState<NotificationSchemeRow[]>([]);
  const [schemesLoading, setSchemesLoading] = useState(true);
  const [activeSchemeId, setActiveSchemeId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  const loadSchemes = useCallback(async () => {
    setSchemesLoading(true);
    try {
      const list = await notifAdminApi.schemes();
      setSchemes(list);
      setActiveSchemeId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        const def = list.find((s) => s.is_default) ?? list[0];
        return def ? def.id : null;
      });
    } catch (e) {
      toast.error(errMessage(e, "Failed to load notification schemes"));
      setSchemes([]);
    } finally {
      setSchemesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) loadSchemes();
  }, [allowed, loadSchemes]);

  const activeScheme = useMemo(
    () => schemes.find((s) => s.id === activeSchemeId) ?? null,
    [schemes, activeSchemeId],
  );

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Bell className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Notifications</h1>
      </div>

      <Tabs defaultValue="schemes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="schemes">Schemes</TabsTrigger>
          <TabsTrigger value="templates">Email Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="schemes" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
            <span className="text-sm font-medium">Scheme</span>
            {schemesLoading ? (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </span>
            ) : schemes.length === 0 ? (
              <span className="text-sm text-muted-foreground">No notification schemes found.</span>
            ) : (
              <Select value={activeSchemeId ?? undefined} onValueChange={setActiveSchemeId}>
                <SelectTrigger className="h-9 w-[280px]"><SelectValue placeholder="Select a scheme" /></SelectTrigger>
                <SelectContent>
                  {schemes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.is_default ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {activeScheme && (
            <NotificationSchemeEditor scheme={activeScheme} onRefetch={loadSchemes} />
          )}
        </TabsContent>

        <TabsContent value="templates">
          <EmailTemplateEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
