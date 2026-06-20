import { WorkspaceChrome } from "@/components/agent/workspace/workspace-chrome";
import { WorkspaceProvider } from "@/components/agent/workspace/workspace-provider";

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { helpdeskKey: string };
}) {
  return (
    <WorkspaceProvider helpdeskKey={params.helpdeskKey}>
      <WorkspaceChrome>{children}</WorkspaceChrome>
    </WorkspaceProvider>
  );
}
