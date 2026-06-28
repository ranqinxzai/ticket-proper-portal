import { PortalShell } from "@/components/shell/portal-shell";
import { ItsmAuthProvider, PortalGuard } from "@/lib/itsm/auth";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ItsmAuthProvider>
      <PortalGuard>
        <PortalShell>{children}</PortalShell>
      </PortalGuard>
    </ItsmAuthProvider>
  );
}
