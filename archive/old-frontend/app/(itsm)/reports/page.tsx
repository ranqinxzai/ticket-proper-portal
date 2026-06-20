"use client";

import Link from "next/link";
import {
  BarChart3,
  Gauge,
  ListChecks,
  PieChart,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

type ReportMeta = { name: string; title: string; description: string; icon: LucideIcon };

const REPORTS: ReportMeta[] = [
  { name: "open-tickets", title: "Open Tickets", description: "Total open tickets, broken down by project.", icon: ListChecks },
  { name: "by-status", title: "By Status", description: "Ticket distribution across statuses.", icon: PieChart },
  { name: "by-priority", title: "By Priority", description: "Ticket counts per priority level.", icon: BarChart3 },
  { name: "by-group", title: "By Group", description: "Tickets per assigned group.", icon: BarChart3 },
  { name: "agent-performance", title: "Agent Performance", description: "Throughput and resolution time per agent.", icon: Users },
  { name: "sla-compliance", title: "SLA Compliance", description: "Met vs breached SLA targets.", icon: Gauge },
  { name: "resolution-trends", title: "Resolution Trends", description: "Tickets resolved per day over time.", icon: TrendingUp },
  { name: "volume-trends", title: "Volume Trends", description: "Tickets created per day over time.", icon: TrendingUp },
];

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Reports</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map(({ name, title, description, icon: Icon }) => (
          <Link
            key={name}
            href={`/reports/${name}`}
            className="rounded-lg border bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
          >
            <Icon className="mb-2 h-5 w-5 text-indigo-500" />
            <div className="font-medium">{title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
