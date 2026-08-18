"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { authApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldRow, fieldError } from "@/components/settings/field-row";

/** Self-service password change for the signed-in user. Verifies the current
 * password server-side; the session (JWT) stays valid, so no re-login. */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const baseId = useId();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
  }

  // Reset local state whenever the dialog is dismissed so a stale password
  // never lingers in an unmounted-but-cached field.
  function handleOpenChange(value: boolean) {
    if (!value) reset();
    onOpenChange(value);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!current || !next) return;
    if (next !== confirm) {
      setErrors({ confirm_password: ["Passwords do not match."] });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await authApi.changePassword(current, next);
      toast.success("Your password has been changed.");
      reset();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        // Show the top-level message only when it's not already an inline field
        // error (those get their own row); otherwise it duplicates the toast.
        if (!err.fieldErrors) toast.error(err.message);
      } else {
        toast.error("Could not change your password.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password, then choose a new one (at least 8 characters).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <FieldRow
            label="Current password"
            htmlFor={`${baseId}-current`}
            error={fieldError(errors, "current_password")}
            required
          >
            <Input
              id={`${baseId}-current`}
              type="password"
              autoComplete="current-password"
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </FieldRow>

          <FieldRow
            label="New password"
            htmlFor={`${baseId}-new`}
            error={fieldError(errors, "new_password")}
            required
          >
            <Input
              id={`${baseId}-new`}
              type="password"
              autoComplete="new-password"
              value={next}
              disabled={busy}
              onChange={(e) => setNext(e.target.value)}
            />
          </FieldRow>

          <FieldRow
            label="Confirm new password"
            htmlFor={`${baseId}-confirm`}
            error={fieldError(errors, "confirm_password")}
            required
          >
            <Input
              id={`${baseId}-confirm`}
              type="password"
              autoComplete="new-password"
              value={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FieldRow>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !current || !next || !confirm}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Change password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
