"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONSOLE_HELP } from "@/lib/itsm/help/admin";

/** A strong random password (no ambiguous chars). Generated client-side. */
export function genPassword(len = 16): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*-_";
  const buf = new Uint32Array(len);
  (globalThis.crypto ?? window.crypto).getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

/**
 * Password input — HIDDEN by default with a show/hide eye toggle, plus Generate
 * and Copy. The value is the password being SET (existing passwords are hashed
 * and can never be displayed); Generate reveals so it can be captured/copied.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  labelClassName = "text-xs",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  labelClassName?: string;
}) {
  const [show, setShow] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Password copied to clipboard.");
    } catch {
      toast.error("Could not copy.");
    }
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="font-mono"
        />
        <IconButton
          size="sm"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          label={show ? CONSOLE_HELP.hidePassword : CONSOLE_HELP.showPassword}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
        </IconButton>
        <Hint label={disabled ? "" : CONSOLE_HELP.generate}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(genPassword());
              setShow(true);
            }}
            disabled={disabled}
          >
            Generate
          </Button>
        </Hint>
        <IconButton
          size="sm"
          onClick={copy}
          disabled={disabled || !value}
          disabledReason={!value && !disabled ? CONSOLE_HELP.copyEmpty : undefined}
          label={CONSOLE_HELP.copyPassword}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
