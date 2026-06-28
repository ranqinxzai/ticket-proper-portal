"use client";

import { useItsmAuth } from "./auth";

/** Whether the current user may author KB content (admin / agent / helpdesk lead).
 *  Article CRUD is module `itsm.knowledge`; category CRUD is `itsm.knowledge.authoring`
 *  — agents (incl. leads, whose global role is agent) hold create/update on both. */
export function useCanAuthorKb(): boolean {
  const { isSupervisor, hasPerm } = useItsmAuth();
  return (
    isSupervisor ||
    hasPerm("itsm.knowledge", "create") ||
    hasPerm("itsm.knowledge", "update") ||
    hasPerm("itsm.knowledge.authoring", "create") ||
    hasPerm("itsm.knowledge.authoring", "update")
  );
}

/** Delete is supervisor-only (only Supervisors hold delete on the KB modules). */
export function useCanDeleteKb(): boolean {
  const { isSupervisor, hasPerm } = useItsmAuth();
  return (
    isSupervisor ||
    hasPerm("itsm.knowledge", "delete") ||
    hasPerm("itsm.knowledge.authoring", "delete")
  );
}
