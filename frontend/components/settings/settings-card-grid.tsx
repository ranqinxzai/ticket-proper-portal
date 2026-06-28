"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SettingCardDef = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  badge?: string | number | null;
};

function SettingCard({ card }: { card: SettingCardDef }) {
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{card.title}</h3>
          {card.badge !== undefined && card.badge !== null ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {card.badge}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{card.description}</p>
      </div>
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

/** A labeled category with its cards in a responsive grid. */
export function SettingsCategory({
  title,
  cards,
}: {
  title: string;
  cards: SettingCardDef[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <SettingCard key={c.href} card={c} />
        ))}
      </div>
    </section>
  );
}
