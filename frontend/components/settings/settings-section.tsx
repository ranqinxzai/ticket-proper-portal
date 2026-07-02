import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell/page-header";

/** Standard page header for a settings sub-page: title, optional description,
 * and an optional right-aligned action slot (e.g. a "New" button). Delegates to
 * the shared PageHeader so every settings page opens with the same look. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} actions={action} />
      <div className="space-y-6">{children}</div>
    </div>
  );
}
