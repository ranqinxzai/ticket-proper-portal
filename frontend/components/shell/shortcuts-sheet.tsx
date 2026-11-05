"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** The `?` sheet: every keyboard shortcut the Modern interface understands. */
const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Everywhere",
    rows: [
      { keys: ["⌘K", "Ctrl K"], label: "Search tickets or jump anywhere" },
      { keys: ["?"], label: "Show this list" },
      { keys: ["Esc"], label: "Close a menu, dialog or this list" },
    ],
  },
  {
    title: "Go to (press G, then the letter)",
    rows: [
      { keys: ["G", "D"], label: "Dashboard" },
      { keys: ["G", "T"], label: "All Tickets" },
      { keys: ["G", "A"], label: "Approvals" },
      { keys: ["G", "E"], label: "Asset List" },
      { keys: ["G", "S"], label: "Configuration / Tenant Settings" },
    ],
  },
  {
    title: "Ticket queue",
    rows: [
      { keys: ["J", "K"], label: "Next / previous ticket in the list" },
      { keys: ["Enter", "O"], label: "Open the highlighted ticket" },
      { keys: ["/"], label: "Find in this view" },
      { keys: ["F"], label: "Show or hide the filters" },
    ],
  },
  {
    title: "Open ticket (beside the queue)",
    rows: [
      { keys: ["J", "K"], label: "Next / previous ticket in the list" },
      { keys: ["R"], label: "Reply to the requestor" },
      { keys: ["N"], label: "Add an internal note" },
      { keys: ["]"], label: "Show or hide the details panel" },
      { keys: ["["], label: "Maximise: hide or show the queue" },
      { keys: ["Esc"], label: "Close the ticket, back to the queue" },
    ],
  },
];

export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[420px] lg:min-w-0 lg:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>
            Shortcuts work anywhere except while you are typing in a box. Leaving a ticket with an unsent reply
            asks first.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</h3>
              <dl className="divide-y rounded-md border">
                {g.rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <dt>{r.label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {r.keys.map((k) => (
                        <kbd key={k} className="rounded border bg-muted px-1.5 font-mono text-xs leading-5">
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
