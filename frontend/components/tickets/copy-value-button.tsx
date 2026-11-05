"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { copyText } from "@/lib/clipboard";
import { TICKET_HELP } from "@/lib/itsm/help/ticket";
import { cn } from "@/lib/utils";

/** What a rail row can copy: a plain value, or a person (name / email menu). */
export type CopyPayload =
  | { kind: "text"; text: string }
  | { kind: "person"; name: string; email?: string | null };

// Faint until its row (`group/row`) is hovered or holds focus; stays a tab stop, and
// stays visible while it (or its open menu trigger) has focus.
const REVEAL_CLS =
  "h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100";

/** Copy-to-clipboard for one ticket-rail field. Plain values copy in one click;
 *  people open a small menu (name / email / both). */
export function CopyValueButton({ payload, field }: { payload: CopyPayload; field: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (text: string, what: string) => {
    if (!(await copyText(text, what))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const icon = copied ? (
    <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
  ) : (
    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
  );

  if (payload.kind === "text")
    return (
      <IconButton
        label={`${TICKET_HELP.copyValue} (${field})`}
        side="left"
        className={cn(REVEAL_CLS, copied && "opacity-100")}
        onClick={() => void copy(payload.text, field)}
      >
        {icon}
      </IconButton>
    );

  const { name, email } = payload;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`${TICKET_HELP.copyPerson} (${field})`}
          side="left"
          className={cn(REVEAL_CLS, copied && "opacity-100")}
        >
          {icon}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void copy(name, "Name")}>Copy name</DropdownMenuItem>
        {email ? (
          <>
            <DropdownMenuItem onSelect={() => void copy(email, "Email")}>Copy email</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copy(`${name} <${email}>`, "Name and email")}>
              Copy name &amp; email
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
