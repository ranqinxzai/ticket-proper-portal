import { ConsoleAuthProvider } from "@/lib/console/auth";

/** Platform super-admin console — its own auth context, NOT org-scoped.
 * Individual pages opt into `ConsoleGuard`; the login page stays public. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleAuthProvider>{children}</ConsoleAuthProvider>;
}
