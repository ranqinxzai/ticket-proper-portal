"use client";

import { useEffect, useId, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { helpdesksApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FieldRow, fieldError } from "./field-row";

/** Helpdesk-level "From" identity for outbound notification emails. The value
 * is used only when the ticket's project has no outbound mailbox — when a
 * mailbox (SMTP channel) exists, its own From wins. The slim `auth/me` helpdesk
 * payload omits these fields, so we fetch the full record on mount. */
export function EmailNotificationForm({
  helpdeskId,
  canEdit,
}: {
  helpdeskId: string;
  canEdit: boolean;
}) {
  const baseId = useId();
  const [loading, setLoading] = useState(true);
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [saved, setSaved] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    helpdesksApi
      .get(helpdeskId)
      .then((hd) => {
        if (!active) return;
        const name = hd.notification_from_name ?? "";
        const email = hd.notification_from_email ?? "";
        setFromName(name);
        setFromEmail(email);
        setSaved({ name, email });
      })
      .catch(() => {
        if (active) toast.error("Could not load the email notification settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [helpdeskId]);

  const dirty = fromName !== saved.name || fromEmail !== saved.email;

  async function save() {
    setBusy(true);
    setErrors({});
    const name = fromName.trim();
    const email = fromEmail.trim();
    try {
      await helpdesksApi.update(helpdeskId, {
        notification_from_name: name,
        notification_from_email: email,
      });
      setFromName(name);
      setFromEmail(email);
      setSaved({ name, email });
      toast.success("Email notification settings saved.");
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not save the settings.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void save();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <FieldRow
        label="From name"
        htmlFor={`${baseId}-name`}
        error={fieldError(errors, "notification_from_name")}
        hint="Display name shown as the sender, e.g. “IT Support”."
      >
        <Input
          id={`${baseId}-name`}
          value={fromName}
          disabled={!canEdit || busy}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="IT Support"
        />
      </FieldRow>

      <FieldRow
        label="From email"
        htmlFor={`${baseId}-email`}
        error={fieldError(errors, "notification_from_email")}
        hint="Address notification emails are sent from. Leave blank to use the system default."
      >
        <Input
          id={`${baseId}-email`}
          type="email"
          value={fromEmail}
          disabled={!canEdit || busy}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="support@company.com"
        />
      </FieldRow>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          When a project has its own outbound mailbox configured (Settings → Mailboxes), that
          mailbox’s address is used as the sender instead — this applies to projects without a
          mailbox.
        </span>
      </div>

      {canEdit ? (
        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  );
}
