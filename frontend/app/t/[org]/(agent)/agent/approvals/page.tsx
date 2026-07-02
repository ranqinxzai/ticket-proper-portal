import { ApprovalInbox } from "@/components/approvals/approval-inbox";
import { PageHeader } from "@/components/shell/page-header";

export default function AgentApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Requests across your workspaces awaiting your sign-off."
      />
      <ApprovalInbox />
    </div>
  );
}
