/**
 * Hover help for the end-user Service Portal and the sign-in page. The audience is
 * requestors, not agents: plain words, no ITSM jargon. Copy must describe what the
 * system actually does (docs/QA_CHECKLIST.md → "Hover help / tooltips"); the backend
 * file each claim was checked against is noted beside it.
 */
import type { StatusCategory, SurveyScaleType } from "@/lib/itsm/types";

/** Requestor wording per seeded status key (itsm_workflows/seed.py INCIDENT_/REQUEST_STATUSES
 *  + the starter workflow). Reopen is seeded only from resolved/fulfilled, never from closed. */
export const PORTAL_STATUS_HELP: Record<string, string> = {
  new: "We've received your request and it's waiting to be picked up.",
  to_do: "We've received your request and it's waiting to be picked up.",
  assigned: "Someone on the support team has been given your request and will start on it soon.",
  approved: "Your request has been accepted and is waiting for the team to start work.",
  in_progress: "The support team is working on it.",
  pending:
    "On hold — the team has paused work. Check the conversation below; they may need something from you.",
  on_hold:
    "On hold — the team has paused work. Check the conversation below; they may need something from you.",
  resolved: "The team believes this is done. If it isn't, use Reopen.",
  fulfilled: "The team believes this is done. If it isn't, use Reopen.",
  closed: "Finished. Closed requests can't be reopened — raise a new request if you still need help.",
  done: "Finished. If you still need help, raise a new request.",
};

/** Fallback for statuses an admin added or renamed (keyed by status category). */
export const PORTAL_STATUS_CATEGORY_HELP: Record<StatusCategory, string> = {
  todo: "We've received your request. Work hasn't started yet.",
  in_progress: "The support team is working on it.",
  done: "The team has finished work on this. If you still need help, use Reopen if it's shown, or raise a new request.",
};

/** Tooltip for a portal status badge: the status-key wording, else the category fallback. */
export function portalStatusHelp(statusKey: string | null | undefined, category: StatusCategory): string {
  return (statusKey && PORTAL_STATUS_HELP[statusKey]) || PORTAL_STATUS_CATEGORY_HELP[category] || "";
}

/** Plain-words meaning of the seeded ticket types (itsm_projects/standard_projects.py).
 *  Keyed by lower-cased type name; custom types get no tip. */
const TICKET_TYPE_HELP: Record<string, string> = {
  incident: "Incident — something is broken or not working as it should, and the team is working to fix it.",
  "service request":
    "Service request — you're asking for something new, like access, equipment, software or information.",
};

export function portalTicketTypeHelp(name: string | null | undefined): string {
  return name ? (TICKET_TYPE_HELP[name.trim().toLowerCase()] ?? "") : "";
}

/** Watchers — itsm_tickets/portal.py `watchers` (exact email match on an existing user),
 *  `portal_viewable_tickets` (watchers can open the request read-only) and the notification
 *  seed (WatcherAdded tells them they were added; StatusChanged/CommentAdded/Resolved/Closed
 *  keep them updated). Only the requestor can add or remove watchers. */
export const PORTAL_WATCHERS_HELP =
  "Colleagues who get updates on this request (new replies and status changes). Enter their work email — they need an account here. They're emailed when you add them and can open the request in the portal to read it, but only you can reply or change it.";

/** Read-only view for approvers and watchers — portal.py `viewer_role` + `_require_requestor`. */
export const PORTAL_VIEWER_NOTE: Record<"approver" | "watcher", string> = {
  approver:
    "You're viewing this request as an approver. You can read it, but only the person who raised it can reply, reopen it or change its watchers.",
  watcher:
    "You're watching this request. You can read it, but only the person who raised it can reply, reopen it or change its watchers.",
};
export const PORTAL_VIEWER_HELP =
  "Approvers and watchers can see the request details, the public conversation and the attachments. Internal notes from the support team are never shown.";

/** Attachments — portal has upload/download only, no delete (portal.py `attachments`). */
export const PORTAL_ADD_FILE_HELP =
  "Files are shared with the support team. You can't delete a file after uploading it.";

/** Reply — portal.py `comments` forces visibility=public; CommentAdded notifies the
 *  assignee and watchers (the author is not emailed their own reply). */
export const PORTAL_REPLY_HELP =
  "Your reply is added to the conversation for the support team. The person handling your request (once someone is assigned) and any watchers are emailed.";

/** Reopen — seeded portal_allowed only from resolved/fulfilled. ReopenRule.window_days is
 *  never enforced by the engine, so no time limit is promised here. */
export const PORTAL_REOPEN_HELP =
  "Not fixed after all? Sends the request back to the support team to work on again. Only available while it's Resolved or Fulfilled.";

/** The optional reopen reason — portal.py `transition` re-posts it as a PUBLIC comment. */
export const PORTAL_REOPEN_NOTE_HELP = "Visible to the support team and posted in the conversation.";

/** Priority on the request form — portal.py `create`: no P3 is pre-selected; a blank
 *  priority is stored as P3 (`std.get("priority") or "p3"`). Impact/Urgency can't be set
 *  from the portal (`_ALLOWED_MAPS_TO`), so nothing is derived, and there is no
 *  per-project default priority. Required follows the project's layout. */
export const PORTAL_PRIORITY_OPTIONAL_HELP =
  "Not sure? Leave it empty: your request starts at P3 – Medium and the support team adjusts it if needed.";
export const PORTAL_PRIORITY_REQUIRED_HELP =
  "Pick how urgent this is for you. The support team can change it after reviewing your request.";

export const PORTAL_WORKSPACE_HELP =
  "A workspace is the team or department that handles your request, e.g. IT or HR.";

/** Catalog "Needs approval" — itsm_catalog starts an approval on submit; the seeded
 *  ApprovalRequested rule emails the approvers (2026-10-18). */
export const PORTAL_NEEDS_APPROVAL_HELP =
  "Someone must sign off before work starts. They're emailed when it's their turn, and you're told when it's approved or rejected.";

export const PORTAL_CATALOG_HELP =
  "Ready-made requests for common needs. Pick one, add a short description, and it goes straight to the right team.";

/** Per-point meaning of a survey rating. Uses the admin's per-point `scale_labels` when
 *  there is one label per point; otherwise sensible defaults. */
const FIVE_POINT = ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"];

export function surveyPointLabel(
  scale: SurveyScaleType,
  value: number,
  index: number,
  labels: string[],
  pointCount: number,
): string {
  if (labels.length === pointCount && labels[index]) return `${value} – ${labels[index]}`;
  if (scale === "nps") {
    if (value === 0) return "0 – Not at all likely to recommend";
    if (value === 10) return "10 – Extremely likely to recommend";
    return `${value} out of 10`;
  }
  const fallback = FIVE_POINT[value - 1];
  return fallback ? `${value} – ${fallback}` : String(value);
}

/** Sign-in — CaseInsensitiveModelBackend (accounts/backends.py) matches the username,
 *  then the email, case-insensitively. */
export const LOGIN_USERNAME_HELP =
  "Enter your username or the email address on your account. Capital letters don't matter.";

/** Self-service reset — accounts/password_reset.py: 60-minute single-use link, only for
 *  password sign-in accounts; Microsoft sign-in and no-login accounts get no email. */
export const FORGOT_PASSWORD_HELP =
  "We'll email a link to reset your password. It works for 60 minutes and only once. Accounts that sign in with Microsoft change their password through Microsoft instead.";
export const FORGOT_PASSWORD_SENT =
  "If an account matches what you entered, we've emailed it a link to reset the password. The link works for 60 minutes. Nothing arrived? Check your spam folder, or contact your IT administrator.";
export const RESET_PASSWORD_RULES = "At least 8 characters.";
