"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CircleHelp,
  ClipboardCheck,
  Home,
  Keyboard,
  Layers,
  LayoutDashboard,
  Loader2,
  Plus,
  Search,
  Settings,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";

import { useUi } from "@/components/theme/density-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { interfaceApi, projectsApi, ticketsApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import { adminHome, agentApprovals, agentHome, helpHome, workspaceBase } from "@/lib/itsm/nav";
import type { Project, TicketListItem } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";

/**
 * ⌘K / Ctrl+K command palette (Modern interface, 2026-11-05, step B2): find a ticket
 * by number or words (the same server search as the link-ticket picker — typo
 * tolerant, best match first), jump to any section, or run an action. Type `>` to
 * list actions only. Arrow keys move, Enter opens, Esc closes.
 */

type Item = {
  id: string;
  group: "Tickets" | "Go to" | "Actions";
  label: string;
  hint?: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void;
};

// Accessible projects (for the project → helpdesk map of ticket links and the
// "New ticket in …" actions), loaded once per page load.
let projectsCache: Project[] | null = null;
let projectsInflight: Promise<Project[]> | null = null;
function loadProjects(): Promise<Project[]> {
  if (projectsCache) return Promise.resolve(projectsCache);
  if (!projectsInflight) {
    projectsInflight = projectsApi
      .list()
      .then((rows) => (projectsCache = rows))
      .finally(() => {
        projectsInflight = null;
      });
  }
  return projectsInflight;
}

const icon = (C: typeof Home) => <C className="h-4 w-4" aria-hidden="true" />;

export function CommandPalette({
  open,
  onOpenChange,
  helpdeskKey,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  helpdeskKey: string | null;
  onShowShortcuts: () => void;
}) {
  const router = useRouter();
  const { org, user, hasPerm, isAdmin, isSupervisor, refreshUser } = useItsmAuth();
  const { ui, setUi, uiLocked } = useUi();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<Project[]>(projectsCache ?? []);
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    setTickets([]);
    loadProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, [open]);

  const actionsOnly = q.trimStart().startsWith(">");
  const query = (actionsOnly ? q.trimStart().slice(1) : q).trim();

  // Ticket search (debounced). Same call as TicketSearchCombobox.
  useEffect(() => {
    if (!open || actionsOnly || query.length < 2) {
      setTickets([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const handle = setTimeout(() => {
      ticketsApi
        .list({ search: query, page_size: 25 })
        .then((rows) => alive && setTickets(rows.slice(0, 8)))
        .catch(() => alive && setTickets([]))
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [open, query, actionsOnly]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      onOpenChange(false);
      router.push(href);
    };
    const hkByProject = new Map(projects.map((p) => [p.key, p.helpdesk_key]));
    const out: Item[] = [];

    for (const t of tickets) {
      const hk = hkByProject.get(t.project_key) ?? helpdeskKey;
      if (!hk) continue;
      out.push({
        id: `t:${t.id}`,
        group: "Tickets",
        label: t.summary,
        hint: t.ticket_number,
        icon: icon(Ticket),
        run: go(`${workspaceBase(org, hk)}/p/${t.project_key}/${t.ticket_number}`),
      });
    }

    const nav: Item[] = [];
    const here = helpdeskKey ? projects.filter((p) => p.helpdesk_key === helpdeskKey && p.status === "active") : [];
    if (helpdeskKey) {
      const base = workspaceBase(org, helpdeskKey);
      if (hasPerm("itsm.dashboard", "read")) {
        nav.push({ id: "g:dash", group: "Go to", label: "Dashboard", hint: "G D", icon: icon(LayoutDashboard), run: go(`${base}/dashboard`) });
      }
      nav.push({ id: "g:all", group: "Go to", label: "All Tickets", hint: "G T", icon: icon(Layers), run: go(`${base}/all`) });
      for (const p of here) {
        nav.push({ id: `g:p:${p.key}`, group: "Go to", label: p.name, hint: p.key, icon: icon(Ticket), keywords: "project queue", run: go(`${base}/p/${p.key}`) });
      }
      if (hasPerm("itsm.reports", "read")) {
        nav.push({ id: "g:reports", group: "Go to", label: "Reports", icon: icon(BarChart3), run: go(`${base}/reports`) });
      }
      if (hasPerm("itsm.assets", "read")) {
        nav.push({ id: "g:assets", group: "Go to", label: "Asset List", hint: "G E", icon: icon(Boxes), keywords: "assets", run: go(`${base}/assets/list`) });
      }
      if (isAdmin) {
        nav.push({ id: "g:config", group: "Go to", label: "Configuration", hint: "G S", icon: icon(Settings), keywords: "settings", run: go(`${base}/settings`) });
      }
    }
    nav.push({ id: "g:home", group: "Go to", label: "Home", icon: icon(Home), keywords: "helpdesks workspaces", run: go(agentHome(org)) });
    nav.push({ id: "g:approvals", group: "Go to", label: "Approvals", hint: "G A", icon: icon(ClipboardCheck), run: go(agentApprovals(org)) });
    for (const hd of user?.helpdesks ?? []) {
      if (hd.key === helpdeskKey) continue;
      nav.push({ id: `g:hd:${hd.key}`, group: "Go to", label: hd.name, hint: "Helpdesk", icon: icon(ArrowRight), keywords: "switch helpdesk", run: go(workspaceBase(org, hd.key)) });
    }
    if (isSupervisor || hasPerm("itsm.admin.roles", "read") || hasPerm("itsm.admin.helpdesks", "read")) {
      nav.push({ id: "g:tenant", group: "Go to", label: "Tenant Settings", icon: icon(Settings), keywords: "users roles admin organisation", run: go(adminHome(org)) });
    }
    nav.push({ id: "g:help", group: "Go to", label: "Help Center", icon: icon(CircleHelp), run: go(helpHome(org)) });

    const actions: Item[] = [];
    if (helpdeskKey && hasPerm("itsm.tickets.create", "create")) {
      const base = workspaceBase(org, helpdeskKey);
      for (const p of here) {
        actions.push({ id: `a:new:${p.key}`, group: "Actions", label: `New ticket in ${p.name}`, icon: icon(Plus), keywords: "create raise", run: go(`${base}/p/${p.key}/new`) });
      }
    }
    if (!uiLocked) {
      const next = ui === "modern" ? "classic" : "modern";
      actions.push({
        id: "a:ui",
        group: "Actions",
        label: next === "classic" ? "Switch to the Classic interface" : "Switch to the Modern interface",
        icon: icon(ArrowRight),
        keywords: "interface layout old new",
        run: () => {
          onOpenChange(false);
          setUi(next);
          interfaceApi
            .setPreference(next)
            .then(() => refreshUser())
            .catch(() => toast.error("Couldn't save your interface choice to your account."));
        },
      });
    }
    actions.push({
      id: "a:keys",
      group: "Actions",
      label: "Keyboard shortcuts",
      hint: "?",
      icon: icon(Keyboard),
      run: () => {
        onOpenChange(false);
        onShowShortcuts();
      },
    });

    const match = (it: Item) => {
      if (!query) return true;
      const hay = `${it.label} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return query
        .toLowerCase()
        .split(/\s+/)
        .every((w) => hay.includes(w));
    };
    if (actionsOnly) return actions.filter(match);
    return [...out, ...nav.filter(match), ...actions.filter(match)];
  }, [
    tickets, projects, helpdeskKey, org, user, hasPerm, isAdmin, isSupervisor, ui, uiLocked,
    query, actionsOnly, router, onOpenChange, onShowShortcuts, setUi, refreshUser,
  ]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  };

  const groups = (["Tickets", "Go to", "Actions"] as const)
    .map((g) => ({ g, rows: items.map((it, i) => ({ it, i })).filter(({ it }) => it.group === g) }))
    .filter(({ rows }) => rows.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0 sm:p-0">
        <DialogTitle className="sr-only">Search and go to</DialogTitle>
        <DialogDescription className="sr-only">
          Type a ticket number or words, a page name, or &gt; for actions. Arrow keys move, Enter opens.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-3 py-2.5 pr-10">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            spellCheck={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `cp-opt-${active}` : undefined}
            aria-label="Search tickets, pages and actions"
            placeholder="Search tickets, pages and actions… type > for actions"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        </div>
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5"
        >
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {searching ? "Searching…" : "Nothing matches. Try a ticket number, a word from the title, or a page name."}
            </p>
          ) : (
            groups.map(({ g, rows }) => (
              <div key={g} role="group" aria-labelledby={`cp-group-${g.replace(" ", "-")}`} className="pb-1">
                <div
                  id={`cp-group-${g.replace(" ", "-")}`}
                  role="presentation"
                  className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {g}
                </div>
                {rows.map(({ it, i }) => (
                  <div
                    key={it.id}
                    id={`cp-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => it.run()}
                    className={cn(
                      "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm",
                      i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">{it.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.hint ? (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{it.hint}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {items.length} result{items.length === 1 ? "" : "s"}
        </p>
      </DialogContent>
    </Dialog>
  );
}
