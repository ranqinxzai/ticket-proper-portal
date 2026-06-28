import { SettingsNav } from "@/components/settings/settings-nav";

/** Two-column settings shell: a persistent left-rail category nav + content.
 * The parent workspace layout already handles auth + helpdesk loading. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-1 py-2 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <SettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
