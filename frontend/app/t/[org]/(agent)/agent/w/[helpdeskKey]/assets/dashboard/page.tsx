"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Hourglass,
  Loader2,
  PackageCheck,
  SearchX,
  Settings2,
  ShieldAlert,
  ShieldOff,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { StatusDot } from "@/components/assets/asset-status-badge";
import { apiMessage, assetListHref, daysUntil, fmtDate, fmtMoney, type FilterValues } from "@/components/assets/asset-utils";
import { AlertTile, BarList, DonutChart, KpiCard, NowTag, ReportCard, type ReportRow } from "@/components/reports/report-views";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetPerms } from "@/lib/itsm/asset-perms";
import { assetCategoriesApi, assetsApi } from "@/lib/itsm/assets-api";
import type { AssetGroupBy, AssetStateType, AssetSummary } from "@/lib/itsm/assets-types";
import { ASSET_HELP } from "@/lib/itsm/help/assets";

const VIEW = "View assets";

const STATE_ICON: Record<AssetStateType, React.ReactNode> = {
  available: <PackageCheck className="h-4 w-4" />,
  in_use: <UserRound className="h-4 w-4" />,
  maintenance: <Wrench className="h-4 w-4" />,
  retired: <Archive className="h-4 w-4" />,
  missing: <SearchX className="h-4 w-4" />,
};

const linkCls =
  "inline-flex h-[var(--ctl-h)] items-center gap-1 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function AssetDashboardPage() {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const perms = useAssetPerms();
  const router = useRouter();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [categoryCount, setCategoryCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingStarter, setLoadingStarter] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!helpdesk) return;
    let alive = true;
    setFailed(false);
    assetsApi
      .summary({ helpdesk: helpdesk.id })
      .then((s) => alive && setSummary(s))
      .catch(() => alive && setFailed(true));
    assetCategoriesApi
      .list({ helpdesk: helpdesk.id })
      .then((c) => alive && setCategoryCount(c.length))
      .catch(() => alive && setCategoryCount(null));
    return () => {
      alive = false;
    };
  }, [helpdesk, tick]);

  const go = useCallback((filters: FilterValues) => router.push(assetListHref(base, filters)), [router, base]);
  /** A chart row → the list filtered on it ("N more" → the report grouped the same way). */
  const drill = (key: keyof FilterValues, groupBy: AssetGroupBy) => (r: ReportRow) => {
    const k = String(r.key ?? "");
    if (!k) return;
    if (k === "other") router.push(`${base}/assets/report?group_by=${groupBy}`);
    else go({ [key]: k });
  };

  async function loadStarter() {
    if (!helpdesk) return;
    setLoadingStarter(true);
    try {
      const r = await assetCategoriesApi.loadStarter(helpdesk.id);
      toast.success(`IT starter set loaded: ${r.categories} categories, ${r.fields} fields, ${r.links} links added.`);
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(apiMessage(e, "Could not load the starter set."));
    } finally {
      setLoadingStarter(false);
    }
  }

  const configureHref = `${base}/settings/assets/categories`;
  const header = (
    <PageHeader
      title="Asset Dashboard"
      description={
        summary
          ? `${helpdesk?.name ?? "This helpdesk"} · as of ${fmtDate(summary.today)}`
          : `${helpdesk?.name ?? "This helpdesk"}'s assets at a glance.`
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {perms.configRead ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={configureHref}>
                <Settings2 aria-hidden="true" /> Configure
              </Link>
            </Button>
          ) : null}
          <Link href={`${base}/assets/report`} className={linkCls}>
            Asset Report <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href={`${base}/assets/list`} className={linkCls}>
            Asset List <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      }
    />
  );

  if (failed) {
    return (
      <div>
        {header}
        <EmptyState
          icon={Boxes}
          title="Could not load the dashboard"
          description="Check your connection and try again."
          action={<Button variant="outline" onClick={() => setTick((t) => t + 1)}>Try again</Button>}
        />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="space-y-6 compact:space-y-4">
        {header}
        <div className="grid gap-4 compact:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (categoryCount === 0 && summary.total === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={Boxes}
          title="Set up asset categories first"
          description={ASSET_HELP.noCategories}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {perms.configCreate && helpdesk ? (
                <Button onClick={() => void loadStarter()} disabled={loadingStarter}>
                  {loadingStarter ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  Load IT starter set
                </Button>
              ) : null}
              {perms.configRead ? (
                <Button asChild variant="outline">
                  <Link href={configureHref}>
                    <Settings2 aria-hidden="true" /> Configure
                  </Link>
                </Button>
              ) : null}
              {!perms.configRead ? (
                <p className="text-sm text-muted-foreground">Ask an administrator to set up asset categories.</p>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  const stateRows = summary.by_state_type;

  return (
    <div className="space-y-6 compact:space-y-4">
      {header}

      {!summary.has_statuses ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {ASSET_HELP.noStatuses}
        </p>
      ) : null}

      {/* Totals — every tile opens the Asset List with that filter. */}
      <div className="grid gap-4 compact:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Total assets"
          value={summary.total.toLocaleString()}
          icon={<Boxes className="h-4 w-4" />}
          accent="text-primary-ink"
          help={`${ASSET_HELP.total}\n${ASSET_HELP.activeCost}`}
          actionLabel={VIEW}
          onClick={() => go({})}
          sub={`${summary.active.toLocaleString()} active · cost ${fmtMoney(summary.active_cost)}`}
        />
        {stateRows.map((s) => (
          <KpiCard
            key={s.key}
            label={s.label}
            value={s.count.toLocaleString()}
            icon={STATE_ICON[s.key]}
            help={ASSET_HELP.stateTile(s.key)}
            actionLabel={VIEW}
            onClick={() => go({ state_type: s.key })}
            sub={summary.total ? `${Math.round((100 * s.count) / summary.total)}% of all assets` : undefined}
          />
        ))}
      </div>

      {/* Needs attention — live counts over active assets. */}
      <div>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Needs attention
          <InfoTip label="About Needs attention">{ASSET_HELP.attention}</InfoTip>
          <NowTag />
        </h2>
        <div className="grid gap-3 compact:gap-2 sm:grid-cols-3">
          <AlertTile
            label="Warranty ends in 30 days"
            value={summary.warranty_expiring}
            tone="warning"
            icon={<CalendarClock className="h-5 w-5" />}
            help={ASSET_HELP.warrantyExpiring}
            emptyHint="Nothing to show"
            actionLabel={VIEW}
            onClick={() => go({ warranty: "expiring", state_type: "active" })}
          />
          <AlertTile
            label="Out of warranty (active)"
            value={summary.out_of_warranty}
            tone="danger"
            icon={<ShieldOff className="h-5 w-5" />}
            help={ASSET_HELP.outOfWarranty}
            emptyHint="Nothing to show"
            actionLabel={VIEW}
            onClick={() => go({ warranty: "expired", state_type: "active" })}
          />
          <AlertTile
            label="Expires in 30 days"
            value={summary.expiring}
            tone="info"
            icon={<Hourglass className="h-5 w-5" />}
            help={ASSET_HELP.expiring}
            emptyHint="Nothing to show"
            actionLabel={VIEW}
            onClick={() => go({ expiry: "expiring", state_type: "active" })}
          />
        </div>
      </div>

      {/* Distributions — every bar / slice drills into the list. */}
      <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
        <ReportCard title="By category" hint="all statuses" help={ASSET_HELP.byCategory}>
          <BarList rows={summary.by_category} onBar={drill("category", "category")} actionLabel={VIEW} />
        </ReportCard>
        <ReportCard title="By status" hint="all assets" help={ASSET_HELP.byStatus}>
          <DonutChart
            rows={summary.by_status}
            centerLabel="assets"
            onSlice={drill("status", "status")}
            actionLabel={VIEW}
          />
        </ReportCard>
        <ReportCard title="By location" hint="all statuses" help={ASSET_HELP.byLocation}>
          <BarList rows={summary.by_location} onBar={drill("location", "location")} actionLabel={VIEW} />
        </ReportCard>
      </div>

      <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
        <ReportCard title="By department" hint="all statuses" help={ASSET_HELP.byDepartment}>
          <BarList rows={summary.by_department} onBar={drill("department", "department")} actionLabel={VIEW} />
        </ReportCard>

        <ReportCard title="Warranty ending soon" hint="next 30 days" help={ASSET_HELP.warrantyEnding}>
          {summary.warranty_ending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No warranties end in the next 30 days.</p>
          ) : (
            <ul className="space-y-1">
              {summary.warranty_ending.map((a) => {
                const d = daysUntil(a.warranty_expiry_date) ?? 0;
                return (
                  <li key={a.id}>
                    <Link
                      href={`${base}/assets/list/${a.id}`}
                      className="flex items-center gap-3 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" title={a.name}>
                          {a.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className="font-mono">{a.asset_tag}</span> · {a.category}
                          {a.assigned_user ? ` · ${a.assigned_user}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs">
                        <span className="block tabular-nums">{fmtDate(a.warranty_expiry_date)}</span>
                        <span className="block font-medium text-amber-700 dark:text-amber-400">
                          {d <= 0 ? "Ends today" : `${d} day${d === 1 ? "" : "s"}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {summary.warranty_expiring > summary.warranty_ending.length ? (
            <Link
              href={assetListHref(base, { warranty: "expiring", state_type: "active" })}
              className="mt-2 inline-block text-xs font-medium text-primary-ink hover:underline"
            >
              View all {summary.warranty_expiring.toLocaleString()}
            </Link>
          ) : null}
        </ReportCard>

        <ReportCard title="Recently added" hint="newest 5" help={ASSET_HELP.recent}>
          {summary.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No assets yet.</p>
          ) : (
            <ul className="space-y-1">
              {summary.recent.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`${base}/assets/list/${a.id}`}
                    className="flex items-center gap-3 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={a.name}>
                        {a.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono">{a.asset_tag}</span> · {a.category}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusDot color={a.status_color} />
                      {a.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      </div>
    </div>
  );
}
