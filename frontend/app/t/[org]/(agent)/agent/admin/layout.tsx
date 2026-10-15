import { TenantSettingsNav } from "@/components/admin/tenant-settings-nav";

/** Two-column Tenant Settings shell: a persistent left-rail nav + content (left
 * headings, right details). The parent agent layout already provides the top bar
 * (app-switcher → Home / switch helpdesk · profile); this only adds the
 * master/detail split beneath it. Mirrors the per-helpdesk settings layout. */
export default function TenantSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    // Full width (the 1152px `max-w-6xl` cap was lifted 2026-10-14 so wide tables and
    // editors use the window; single-column forms keep their own max-w). `px-1` stays —
    // <main> already provides the gutter. The rail sticks under the header (`top-rail`
    // = --header-h + --main-py, density-aware).
    <div className="grid w-full gap-6 px-1 py-2 compact:gap-4 compact:py-0 lg:grid-cols-[220px_minmax(0,1fr)] compact:lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-rail lg:self-start">
        <TenantSettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
