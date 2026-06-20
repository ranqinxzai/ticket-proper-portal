"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { catalogApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { CatalogItem } from "@/lib/itsm/types";

export default function CatalogItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const router = useRouter();
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    catalogApi
      .get(itemId)
      .then((i) => {
        setItem(i);
        setSummary(i.name);
      })
      .catch(() => toast.error("Could not load this catalog item."))
      .finally(() => setLoading(false));
  }, [itemId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ticket = await catalogApi.raise(itemId, { summary: summary.trim() || undefined });
      toast.success(`Request ${ticket.ticket_number} submitted.`);
      router.push(`/portal/requests/${ticket.id}`);
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not submit your request.");
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!item) return <p className="text-sm text-muted-foreground">Item not found.</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/portal/catalog"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to catalog
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{item.short_description}</p>
        {item.requires_approval ? (
          <p className="mt-2 inline-flex items-center gap-1 rounded bg-warning/15 px-2 py-1 text-xs text-warning">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            This request needs approval ({item.approval_workflow_name}).
          </p>
        ) : null}
      </div>

      {item.description_html ? (
        <div
          className="prose prose-sm max-w-none rounded-lg border bg-card p-4 dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: item.description_html }}
        />
      ) : null}

      <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="summary">What do you need?</Label>
          <Input
            id="summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            required
            placeholder="Briefly describe your request"
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </Button>
      </form>
    </div>
  );
}
