import { AgentShell } from "@/components/shell/agent-shell";
import { HeaderSlotProvider } from "@/components/shell/header-slot";
import { ShortcutsHost } from "@/components/shell/shortcuts-host";
import { InterfaceSync } from "@/components/theme/interface-sync";
import { AgentGuard, ItsmAuthProvider } from "@/lib/itsm/auth";

/** Agent app. Interface: Classic / Modern (2026-11-05) — `InterfaceSync` applies the
 *  user's saved choice / the org policy, `HeaderSlotProvider` lets a page's title move
 *  into the Modern top bar, and `ShortcutsHost` adds ⌘K + keyboard shortcuts (Modern
 *  only). In Classic all three render nothing visible. */
export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <ItsmAuthProvider>
      <AgentGuard>
        <InterfaceSync />
        <HeaderSlotProvider>
          <ShortcutsHost>
            <AgentShell>{children}</AgentShell>
          </ShortcutsHost>
        </HeaderSlotProvider>
      </AgentGuard>
    </ItsmAuthProvider>
  );
}
