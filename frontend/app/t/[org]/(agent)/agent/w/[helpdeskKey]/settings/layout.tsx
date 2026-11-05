import { SettingsColumns } from "@/components/settings/settings-columns";
import { SettingsNav } from "@/components/settings/settings-nav";

/** Two-column settings shell: a persistent left-rail category nav + content.
 * The parent workspace layout already handles auth + helpdesk loading. Classic markup
 * is unchanged; the Modern interface adds a back link (SettingsColumns). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsColumns nav={<SettingsNav />}>{children}</SettingsColumns>;
}
