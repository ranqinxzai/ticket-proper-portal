"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A small destructive-action confirm (asset settings). Esc / click-outside cancel. */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Delete",
  busy,
  destructive = true,
  onConfirm,
  onCancel,
  extraAction,
  hideConfirm,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** An alternative action shown before the confirm button (e.g. "Deactivate instead"). */
  extraAction?: ReactNode;
  /** Hide the confirm button (e.g. when the action is known to be refused). */
  hideConfirm?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {extraAction}
          {hideConfirm ? null : (
            <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
