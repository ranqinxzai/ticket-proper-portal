import type { ApprovalPendingStage, ApprovalRequest } from "@/lib/itsm/types";

/** "Priya Raman, Ann Lee and 3 more" — the people who can still decide a stage,
 *  falling back to the stage's approver description ("anyone with the role …"). */
export function waitingFor(stage: ApprovalPendingStage): string {
  const names = stage.approver_names ?? [];
  if (names.length === 0) return stage.approver_count > 0 ? stage.approver_label : "nobody";
  const more = stage.approver_count - names.length;
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
}

/** "Manager (Level 1) · Finance (Level 2)" for the stages a request is waiting on. */
export function pendingStageText(r: ApprovalRequest): string {
  const stages = r.pending_stages ?? [];
  if (stages.length === 0) {
    return r.current_stage_name ? `${r.current_stage_name} (Level ${r.current_stage_level})` : "—";
  }
  return stages.map((s) => `${s.name} (Level ${s.level})`).join(" · ");
}
