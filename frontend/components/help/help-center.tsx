"use client";

import { Fragment, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, Lightbulb, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useItsmAuth } from "@/lib/itsm/auth";
import { PageHeader } from "@/components/shell/page-header";
import { Input } from "@/components/ui/input";
import {
  HELP_ARTICLES,
  HELP_FAQS,
  HELP_SECTIONS,
  type HelpArticle,
  type HelpAudience,
  type HelpBlock,
  type HelpFaq,
} from "@/lib/itsm/help-content";

/** In-app Help Center for agents and helpdesk admins: how-to guides grouped by
 * section, plus an FAQ. Content is plain data (`lib/itsm/help-content.ts`) so
 * it is searchable; an article is deep-linked by URL hash (`/agent/help#<id>`,
 * read from window — no useSearchParams, so no Suspense boundary needed). */

type AudienceFilter = "all" | HelpAudience;

const AUDIENCE_LABEL: Record<HelpAudience, string> = { agent: "Agents", admin: "Admins" };
const FAQ_ID = "faq";

/** `**UI label**` → bold. The only inline markup the content uses. */
function Rich({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function blockText(b: HelpBlock): string {
  return "text" in b ? b.text : b.items.join(" ");
}

function matches(haystack: string, terms: string[]): boolean {
  const h = haystack.toLowerCase();
  return terms.every((t) => h.includes(t));
}

function articleHaystack(a: HelpArticle): string {
  return [a.title, a.summary, ...(a.keywords ?? []), ...a.blocks.map(blockText)].join(" ");
}

function readHash(): string {
  if (typeof window === "undefined") return "";
  return decodeURIComponent(window.location.hash.replace(/^#/, ""));
}

function AudienceBadge({ audience }: { audience: HelpAudience }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        audience === "admin"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-primary/10 text-primary-ink",
      )}
    >
      {AUDIENCE_LABEL[audience]}
    </span>
  );
}

function Blocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return (
              <h3 key={i} className="pt-2 text-base font-semibold text-foreground">
                {b.text}
              </h3>
            );
          case "p":
            return (
              <p key={i}>
                <Rich text={b.text} />
              </p>
            );
          case "steps":
            return (
              <ol key={i} className="space-y-2">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary-ink">
                      {j + 1}
                    </span>
                    <span>
                      <Rich text={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground/60">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Rich text={item} />
                  </li>
                ))}
              </ul>
            );
          case "tip":
          case "note": {
            const Icon = b.kind === "tip" ? Lightbulb : AlertTriangle;
            return (
              <div
                key={i}
                className={cn(
                  "flex gap-3 rounded-lg border px-4 py-3",
                  b.kind === "tip"
                    ? "border-primary/20 bg-primary/5"
                    : "border-amber-500/30 bg-amber-500/5",
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    b.kind === "tip" ? "text-primary" : "text-amber-600 dark:text-amber-400",
                  )}
                  aria-hidden="true"
                />
                <p className="text-foreground/90">
                  <Rich text={b.text} />
                </p>
              </div>
            );
          }
        }
      })}
    </div>
  );
}

function FaqList({ faqs }: { faqs: HelpFaq[] }) {
  return (
    <div className="divide-y rounded-lg border bg-card">
      {faqs.map((f) => (
        <details key={f.id} id={f.id} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-start gap-3 text-sm font-medium text-foreground">
            <ChevronRight
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            <span className="flex-1">{f.q}</span>
            <AudienceBadge audience={f.audience} />
          </summary>
          <p className="mt-2 pl-7 text-sm leading-relaxed text-muted-foreground">
            <Rich text={f.a} />
          </p>
        </details>
      ))}
    </div>
  );
}

export function HelpCenter() {
  const { isAdmin } = useItsmAuth();
  const [query, setQuery] = useState("");
  // Admin guides are noise for agents who can't open Configuration — start them
  // on their own guides (the toggle still shows everything).
  const [audience, setAudience] = useState<AudienceFilter>(isAdmin ? "all" : "agent");
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const sync = () => setActiveId(readHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const open = (id: string) => {
    setQuery("");
    if (id) window.location.hash = id;
    else history.replaceState(null, "", window.location.pathname);
    setActiveId(id);
    window.scrollTo({ top: 0 });
  };

  const inAudience = <T extends { audience: HelpAudience }>(x: T) =>
    audience === "all" || x.audience === audience;
  const articles = HELP_ARTICLES.filter(inAudience);
  const faqs = HELP_FAQS.filter(inAudience);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = terms.length
    ? {
        articles: articles.filter((a) => matches(articleHaystack(a), terms)),
        faqs: faqs.filter((f) => matches(`${f.q} ${f.a}`, terms)),
      }
    : null;

  const active = HELP_ARTICLES.find((a) => a.id === activeId);
  const showFaq = activeId === FAQ_ID;
  const sections = HELP_SECTIONS.map((s) => ({
    ...s,
    articles: articles.filter((a) => a.section === s.id),
  })).filter((s) => s.articles.length);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Help Center"
        description="How-to guides and answers to common questions for agents and helpdesk admins."
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help — e.g. assign, SLA, canned response, email routing"
            aria-label="Search help"
            className="pl-9 pr-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div role="group" aria-label="Show help for" className="inline-flex rounded-lg bg-muted p-1 text-sm">
          {(["all", "agent", "admin"] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={audience === a}
              onClick={() => setAudience(a)}
              className={cn(
                "rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors",
                audience === a && "bg-background text-foreground shadow-sm",
              )}
            >
              {a === "all" ? "All" : AUDIENCE_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      {/* min-h: even a short article leaves enough scroll for the topic list to
          stick, so its own scroll pane can reach the last entries. */}
      <div className="grid gap-8 lg:min-h-[100dvh] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Help topics" className="hidden lg:block">
          <div className="sticky top-rail max-h-[calc(100dvh-var(--header-h)-2*var(--main-py))] space-y-5 overflow-y-auto pb-4 text-sm">
            <button
              type="button"
              onClick={() => open("")}
              className={cn(
                "block w-full rounded-md px-2 py-1 text-left font-medium hover:bg-accent",
                !activeId && !results ? "text-primary" : "text-foreground",
              )}
            >
              Help home
            </button>
            {sections.map((s) => (
              <div key={s.id}>
                <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.title}
                </p>
                <ul>
                  {s.articles.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => open(a.id)}
                        aria-current={activeId === a.id ? "page" : undefined}
                        className="block w-full rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                      >
                        {a.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <button
              type="button"
              onClick={() => open(FAQ_ID)}
              aria-current={showFaq ? "page" : undefined}
              className="block w-full rounded-md px-2 py-1 text-left font-medium text-foreground hover:bg-accent aria-[current=page]:bg-accent"
            >
              FAQ
            </button>
          </div>
        </nav>

        <div className="min-w-0">
          {results ? (
            <section aria-live="polite" className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {results.articles.length + results.faqs.length} result
                {results.articles.length + results.faqs.length === 1 ? "" : "s"} for “{query.trim()}”
              </p>
              {results.articles.length ? (
                <ul className="space-y-2">
                  {results.articles.map((a) => (
                    <li key={a.id}>
                      <ArticleCard article={a} onOpen={open} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {results.faqs.length ? (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-foreground">From the FAQ</h2>
                  <FaqList faqs={results.faqs} />
                </div>
              ) : null}
              {!results.articles.length && !results.faqs.length ? (
                <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing matched. Try a shorter word, or ask your helpdesk administrator.
                </p>
              ) : null}
            </section>
          ) : active ? (
            <article className="max-w-3xl">
              <button
                type="button"
                onClick={() => open("")}
                className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Help home
              </button>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{HELP_SECTIONS.find((s) => s.id === active.section)?.title}</span>
                <AudienceBadge audience={active.audience} />
              </div>
              <h2 className="mb-2 text-xl font-semibold tracking-tight text-foreground">{active.title}</h2>
              <p className="mb-6 text-sm text-muted-foreground">{active.summary}</p>
              <Blocks blocks={active.blocks} />
              <RelatedNav article={active} onOpen={open} />
            </article>
          ) : showFaq ? (
            <section className="max-w-3xl space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Frequently asked questions</h2>
              <FaqList faqs={faqs} />
            </section>
          ) : (
            <div className="space-y-10">
              {sections.map((s) => (
                <section key={s.id} aria-labelledby={`sec-${s.id}`}>
                  <h2 id={`sec-${s.id}`} className="text-base font-semibold text-foreground">
                    {s.title}
                  </h2>
                  <p className="mb-3 text-sm text-muted-foreground">{s.description}</p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {s.articles.map((a) => (
                      <li key={a.id}>
                        <ArticleCard article={a} onOpen={open} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <section aria-labelledby="sec-faq" className="space-y-3">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="sec-faq" className="text-base font-semibold text-foreground">
                    Frequently asked questions
                  </h2>
                  <button type="button" onClick={() => open(FAQ_ID)} className="text-sm text-primary hover:underline">
                    See all {faqs.length}
                  </button>
                </div>
                <FaqList faqs={faqs.slice(0, 6)} />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleCard({ article, onOpen }: { article: HelpArticle; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(article.id)}
      className="group flex h-full w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{article.title}</span>
          <AudienceBadge audience={article.audience} />
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{article.summary}</span>
      </span>
      <ChevronRight
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

/** Previous / next within the article's own section. */
function RelatedNav({ article, onOpen }: { article: HelpArticle; onOpen: (id: string) => void }) {
  const siblings = HELP_ARTICLES.filter((a) => a.section === article.section);
  const i = siblings.findIndex((a) => a.id === article.id);
  const prev = siblings[i - 1];
  const next = siblings[i + 1];
  if (!prev && !next) return null;
  return (
    <div className="mt-10 grid gap-2 border-t pt-6 sm:grid-cols-2">
      {prev ? (
        <button
          type="button"
          onClick={() => onOpen(prev.id)}
          className="rounded-lg border px-4 py-3 text-left text-sm hover:bg-accent/40"
        >
          <span className="block text-xs text-muted-foreground">Previous</span>
          <span className="font-medium text-foreground">{prev.title}</span>
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => onOpen(next.id)}
          className="rounded-lg border px-4 py-3 text-right text-sm hover:bg-accent/40"
        >
          <span className="block text-xs text-muted-foreground">Next</span>
          <span className="font-medium text-foreground">{next.title}</span>
        </button>
      ) : null}
    </div>
  );
}
