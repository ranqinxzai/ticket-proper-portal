"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { emailRulesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { EmailRule } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Allow / block list for a channel. Block always wins; if any allow rule exists,
 *  the sender must match one. A bare domain is stored as a `*@domain` glob. */
export function EmailRulesEditor({ channelId, disabled }: { channelId: string; disabled?: boolean }) {
  const [rows, setRows] = useState<EmailRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [ruleType, setRuleType] = useState<"allow" | "block">("block");
  const [pattern, setPattern] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    emailRulesApi
      .list({ channel: channelId })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  useEffect(() => {
    load();
  }, [load]);

  function normalize(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (!v) return v;
    // A bare domain (no @, no glob) → match the whole domain.
    if (!v.includes("@") && !v.includes("*")) return `*@${v}`;
    return v;
  }

  async function add() {
    const p = normalize(pattern);
    if (!p) return;
    setBusy(true);
    try {
      await emailRulesApi.create({ channel: channelId, rule_type: ruleType, pattern: p, is_active: true });
      setPattern("");
      toast.success("Rule added.");
      load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the rule.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: EmailRule) {
    setBusy(true);
    try {
      await emailRulesApi.delete(rule.id);
      setRows((r) => r.filter((x) => x.id !== rule.id));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove the rule.");
    } finally {
      setBusy(false);
    }
  }

  const allow = rows.filter((r) => r.rule_type === "allow");
  const block = rows.filter((r) => r.rule_type === "block");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Whitelist (Allow) or blacklist (Block) senders. Enter a domain (e.g. <code>spam.com</code>),
        an address (<code>a@b.com</code>), or a glob (<code>*@partner.com</code>). Block rules always
        win; if any Allow rule exists, only matching senders create tickets.
      </p>

      {!disabled ? (
        <div className="flex items-end gap-2">
          <Select value={ruleType} onValueChange={(v) => setRuleType(v as "allow" | "block")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="block">Block</SelectItem>
              <SelectItem value="allow">Allow</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="domain.com or *@domain.com"
            value={pattern}
            disabled={busy}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" onClick={add} disabled={busy || !pattern.trim()} className="gap-1">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add
          </Button>
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <RuleColumn title="Allow list" rules={allow} disabled={disabled} onRemove={remove} />
          <RuleColumn title="Block list" rules={block} disabled={disabled} onRemove={remove} />
        </div>
      )}
    </div>
  );
}

function RuleColumn({
  title,
  rules,
  disabled,
  onRemove,
}: {
  title: string;
  rules: EmailRule[];
  disabled?: boolean;
  onRemove: (r: EmailRule) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No rules.
        </p>
      ) : (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
            >
              <code className="truncate">{r.pattern}</code>
              {!disabled ? (
                <Button size="sm" variant="ghost" onClick={() => onRemove(r)} aria-label="Remove rule">
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
