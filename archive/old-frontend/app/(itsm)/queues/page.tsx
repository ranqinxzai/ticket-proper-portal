"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Loader2, ChevronLeft, ChevronRight, X, Eye } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ticketsApi, projectsApi, groupsApi } from "@/lib/itsm/api";
import type { Group, Priority, Project, TicketListItem } from "@/lib/itsm/types";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useSelectedHelpdesk } from "@/lib/itsm/helpdesk";
import {
  PriorityIcon, StatusBadge, RagPill, ragFromDue, UserPill, relTime, PRIORITIES, priorityLabel,
} from "@/components/itsm/ticket-bits";

const PAGE_SIZE = 25;
const ALL = "__all__";

const CATEGORY_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export default function QueuesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, hasPerm } = useItsmAuth();
  const { selected: helpdesk } = useSelectedHelpdesk();
  const canBulk = hasPerm("itsm.tickets.bulk", "update") || hasPerm("itsm.tickets", "update");

  // Filters
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [project, setProject] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);

  // Data
  const [rows, setRows] = useState<TicketListItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Lookups — projects are scoped to the selected helpdesk, so re-fetch on switch
  // (and reset the project filter so a stale cross-helpdesk project isn't applied).
  useEffect(() => {
    projectsApi.list(helpdesk?.key).then(setProjects).catch(() => setProjects([]));
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
    setProject(ALL);
  }, [helpdesk?.key]);

  // Keep the input in sync when the header search navigates to /queues?search=…
  const urlSearch = searchParams.get("search") ?? "";
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, project, category, priority, mineOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ticketsApi.list({
        helpdesk: helpdesk?.key,
        search: debouncedSearch || undefined,
        project: project === ALL ? undefined : project,
        status__category: category === ALL ? undefined : category,
        priority: priority === ALL ? undefined : priority,
        assignee: mineOnly && user ? String(user.id) : undefined,
        ordering: "-updated_at",
        page,
      });
      setRows(res.results);
      setCount(res.count);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [helpdesk?.key, debouncedSearch, project, category, priority, mineOnly, page, user]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(op: string, value: unknown, label: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await ticketsApi.bulk({ ids, op, value });
      toast.success(`${label} applied to ${ids.length} ticket(s)`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Bulk ${op} failed`);
    }
  }

  const hasActiveFilters =
    debouncedSearch || project !== ALL || category !== ALL || priority !== ALL || mineOnly;

  function clearFilters() {
    setSearch("");
    setProject(ALL);
    setCategory(ALL);
    setPriority(ALL);
    setMineOnly(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Ticket Queue</h1>
        <div className="text-sm text-muted-foreground">{count} ticket{count === 1 ? "" : "s"}</div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number or summary…"
            className="h-9 pl-8"
          />
        </div>

        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any priority</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{priorityLabel(p)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 px-1 text-sm">
          <Switch checked={mineOnly} onCheckedChange={setMineOnly} />
          Assigned to me
        </label>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="gap-1" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
              </TableHead>
              <TableHead className="w-28">Number</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-12">Pri</TableHead>
              <TableHead className="w-40">Assignee</TableHead>
              <TableHead className="hidden w-36 md:table-cell">Group</TableHead>
              <TableHead className="w-32">SLA</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="hidden w-28 lg:table-cell">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading tickets…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-destructive">{error}</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                  No tickets match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const rag = ragFromDue(t.due_date);
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    data-state={selected.has(t.id) ? "selected" : undefined}
                    onClick={() => router.push(`/tickets/${t.ticket_number}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(t.id)}
                        onCheckedChange={() => toggleOne(t.id)}
                        aria-label={`Select ${t.ticket_number}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-indigo-600">{t.ticket_number}</TableCell>
                    <TableCell className="max-w-[320px] truncate font-medium">{t.summary}</TableCell>
                    <TableCell><PriorityIcon priority={t.priority} /></TableCell>
                    <TableCell className="truncate text-sm"><UserPill user={t.assignee} /></TableCell>
                    <TableCell className="hidden truncate text-sm text-muted-foreground md:table-cell">
                      {t.assigned_group_name || "—"}
                    </TableCell>
                    <TableCell>
                      {t.due_date ? <RagPill rag={rag.rag} label={rag.label} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><StatusBadge name={t.status_name} color={t.status_color} /></TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{relTime(t.updated_at)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && canBulk && (
        <div className="sticky bottom-3 z-20 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border bg-slate-900 px-3 py-2 text-sm text-white shadow-lg">
          <span className="font-medium">{selected.size} selected</span>
          <span className="mx-1 h-4 w-px bg-white/20" />

          <BulkAssign groups={groups} onAssign={(gid) => runBulk("assign_group", gid, "Group")} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="h-8">Set priority</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Priority</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRIORITIES.map((p) => (
                <DropdownMenuItem key={p} onClick={() => runBulk("priority", p, "Priority")}>
                  <PriorityIcon priority={p as Priority} withLabel />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" variant="secondary" className="h-8 gap-1" onClick={() => runBulk("watch", true, "Watch")}>
            <Eye className="h-3.5 w-3.5" /> Watch
          </Button>

          <button onClick={() => setSelected(new Set())} className="ml-auto rounded p-1 hover:bg-white/10" aria-label="Clear selection">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function BulkAssign({ groups, onAssign }: { groups: Group[]; onAssign: (groupId: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="secondary" className="h-8">Assign group</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Assign to group</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.length === 0 && <DropdownMenuItem disabled>No groups</DropdownMenuItem>}
        {groups.map((g) => (
          <DropdownMenuItem key={g.id} onClick={() => onAssign(g.id)}>{g.name}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
