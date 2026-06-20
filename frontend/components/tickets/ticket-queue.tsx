"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ticketsApi } from "@/lib/itsm/api";
import type { Project, TicketListItem } from "@/lib/itsm/types";
import { PriorityTag } from "./priority-tag";
import { StatusBadge } from "./status-badge";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function TicketQueue({ project }: { project: Project }) {
  const { helpdeskKey } = useWorkspace();
  const base = `/agent/w/${helpdeskKey}/p/${project.key}`;
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      ticketsApi
        .list({ project: project.id, search: search || undefined, ordering: "-created_at" })
        .then((r) => !cancelled && setTickets(r))
        .catch(() => !cancelled && setTickets([]))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [project.id, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${project.name}…`}
            aria-label={`Search ${project.name}`}
            className="pl-9"
          />
        </div>
        <Button asChild className="ml-auto">
          <Link href={`${base}/new`}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New ticket
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">ID</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[90px]">Priority</TableHead>
              <TableHead className="w-[160px]">Assignee</TableHead>
              <TableHead className="w-[120px]">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  No tickets yet. Create the first one.
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => (
                <TableRow key={t.id} className="cursor-pointer">
                  <TableCell className="font-mono text-xs">
                    <Link href={`${base}/${t.id}`} className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t.ticket_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`${base}/${t.id}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t.summary}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
                  </TableCell>
                  <TableCell>
                    <PriorityTag priority={t.priority} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.assignee?.full_name ?? t.assigned_group_name ?? "Unassigned"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(t.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
