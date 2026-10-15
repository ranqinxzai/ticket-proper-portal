import { SettingsNav } from "@/components/settings/settings-nav";

/** Two-column settings shell: a persistent left-rail category nav + content.
 * The parent workspace layout already handles auth + helpdesk loading. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    // Full width (the 1152px `max-w-6xl` cap was lifted 2026-10-14 so wide tables and
    // editors use the window; single-column forms keep their own max-w). `px-1` stays —
    // <main> already provides the gutter. The rail sticks under the header (`top-rail`
    // = --header-h + --main-py, density-aware).
    <div className="grid w-full gap-6 px-1 py-2 compact:gap-4 compact:py-0 lg:grid-cols-[220px_minmax(0,1fr)] compact:lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-rail lg:self-start">
        <SettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
