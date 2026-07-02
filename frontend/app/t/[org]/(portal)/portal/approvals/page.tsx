import { ApprovalInbox } from "@/components/approvals/approval-inbox";
import { PageHeader } from "@/components/shell/page-header";

export default function PortalApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Pending Approvals"
        description="Requests awaiting your sign-off."
      />
      <ApprovalInbox />
    </div>
  );
}
