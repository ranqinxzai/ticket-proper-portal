import { AgentShell } from "@/components/shell/agent-shell";
import { AgentGuard, ItsmAuthProvider } from "@/lib/itsm/auth";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <ItsmAuthProvider>
      <AgentGuard>
        <AgentShell>{children}</AgentShell>
      </AgentGuard>
    </ItsmAuthProvider>
  );
}
