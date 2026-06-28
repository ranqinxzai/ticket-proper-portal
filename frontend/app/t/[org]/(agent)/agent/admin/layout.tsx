import { TenantSettingsNav } from "@/components/admin/tenant-settings-nav";

/** Two-column Tenant Settings shell: a persistent left-rail nav + content (left
 * headings, right details). The parent agent layout already provides the top bar
 * (app-switcher → Home / switch helpdesk · profile); this only adds the
 * master/detail split beneath it. Mirrors the per-helpdesk settings layout. */
export default function TenantSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-1 py-2 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <TenantSettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
