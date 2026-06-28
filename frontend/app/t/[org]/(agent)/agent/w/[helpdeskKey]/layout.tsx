import { WorkspaceChrome } from "@/components/agent/workspace/workspace-chrome";
import { WorkspaceProvider } from "@/components/agent/workspace/workspace-provider";

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { org: string; helpdeskKey: string };
}) {
  return (
    <WorkspaceProvider org={params.org} helpdeskKey={params.helpdeskKey}>
      <WorkspaceChrome>{children}</WorkspaceChrome>
    </WorkspaceProvider>
  );
}
