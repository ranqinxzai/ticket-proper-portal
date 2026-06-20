import { Settings } from "lucide-react";

const ITEMS = [
  "Ticket Categories (hierarchical)",
  "Statuses (grouped by type, with color)",
  "Fields & Layout (form builder)",
  "Calendar (timezone, business hours, holidays)",
  "Conditional Fields (rule engine)",
  "Status Transition Rules",
];

export default function WorkspaceSettings() {
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Settings className="h-4 w-4" aria-hidden="true" />
        Workspace Settings
      </h2>
      <div className="rounded-lg border border-dashed p-6">
        <p className="text-sm text-muted-foreground">
          Workspace-scoped configuration arrives in the next phase (P2). It will include:
        </p>
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {ITEMS.map((i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
              {i}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
