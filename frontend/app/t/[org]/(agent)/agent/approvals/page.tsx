import { ApprovalInbox } from "@/components/approvals/approval-inbox";

export default function AgentApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests across your workspaces awaiting your sign-off.
        </p>
      </div>
      <ApprovalInbox />
    </div>
  );
}
