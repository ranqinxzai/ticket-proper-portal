import { TenantSettingsNav } from "@/components/admin/tenant-settings-nav";
import { SettingsColumns } from "@/components/settings/settings-columns";

/** Two-column Tenant Settings shell: a persistent left-rail nav + content (left
 * headings, right details). The parent agent layout already provides the top bar
 * (app-switcher → Home / switch helpdesk · profile); this only adds the
 * master/detail split beneath it. Mirrors the per-helpdesk settings layout. Classic
 * markup is unchanged; the Modern interface adds a back link (SettingsColumns). */
export default function TenantSettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsColumns nav={<TenantSettingsNav />}>{children}</SettingsColumns>;
}
