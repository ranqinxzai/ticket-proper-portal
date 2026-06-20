import { ItsmAuthProvider, ItsmGuard } from "@/lib/itsm/auth";
import { HelpdeskProvider } from "@/lib/itsm/helpdesk";
import { ItsmShell } from "@/components/itsm/ItsmShell";

/**
 * Layout for the standalone ITSM route group. Provides its own JWT auth
 * context (independent of the QA cookie-session AuthProvider in the root
 * layout), guards every page behind a token, exposes the selected-helpdesk
 * context (needs a hydrated user, so it sits inside the guard), and renders
 * the app shell.
 */
export default function ItsmGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <ItsmAuthProvider>
      <ItsmGuard>
        <HelpdeskProvider>
          <ItsmShell>{children}</ItsmShell>
        </HelpdeskProvider>
      </ItsmGuard>
    </ItsmAuthProvider>
  );
}
