import { redirect } from "next/navigation";

/** Bare site root. Path-based multi-tenancy means the root has no org context.
 * The pilot's primary org is `onemed`, so send root visitors (and old bookmarks
 * of the bare domain) straight to its login. Platform admins use `/console`.
 * If you later host many orgs, replace this with an org-picker page. */
const DEFAULT_ORG = process.env.NEXT_PUBLIC_DEFAULT_ORG || "onemed";

export default function RootRedirect() {
  redirect(`/t/${DEFAULT_ORG}/login`);
}
