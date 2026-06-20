import { ApprovalInbox } from "@/components/approvals/approval-inbox";

export default function PortalApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Pending Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests awaiting your sign-off.
        </p>
      </div>
      <ApprovalInbox />
    </div>
  );
}
