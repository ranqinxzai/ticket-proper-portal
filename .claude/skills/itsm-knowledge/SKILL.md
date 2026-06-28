# itsm-knowledge

## Purpose
Knowledge Base / Solutions. Agents author `Article`s (draft → published) organised into
`KBCategory`s; end users browse the **published, portal-visible** ones in the Service Portal.
`ArticleTicketLink` records when an article resolves/references a ticket (deflection tracking).
**Status: BUILT** — backend authoring CRUD + portal browse were already complete; the **agent
authoring UI** was added 2026-06-24 (the "Knowledge Base Mgmt" surface).

## Backend app path
`backend/apps/itsm_knowledge/` — `models.py`, `views.py`, `serializers.py`, `urls.py`, `seed.py`.

## Models (`models.py`)
- **`KBCategory`** — `name`, `slug` (SlugField, **unique**, **not auto-generated**), `description`,
  `parent` (self-FK, one level used in the UI), `helpdesk` (FK, **null = org-wide**), `sort_order`.
- **`Article`** — `category` (FK, nullable), `helpdesk` (FK, null = org-wide), `title`, `slug`
  (SlugField, **unique, not auto-generated**), `body_html`, `body_text` (derived), `summary` (≤500),
  `status` (draft/published/archived), `visibility` (portal = end-users+agents / internal = agents
  only), `tags` (JSON list), `author`, `published_at`, `view_count`, `helpful/not_helpful_count`.
- **`ArticleTicketLink`** — `article`+`ticket`+`link_type` (resolved_by/referenced/suggested),
  unique together.

## Endpoints (`urls.py`, under `/api/v1/itsm/`)
- **`/kb-articles/`** (`ArticleAdminViewSet`, module **`itsm.knowledge`**) — full CRUD + `list`
  (author sees drafts + internal), filter `category/helpdesk/status/visibility`, search
  `title/body_text/summary`. Actions **`{id}/publish/`** (status→published, stamps `published_at`) and
  **`{id}/unpublish/`** (→ draft). `perform_create/update` run `sanitize_html` (bleach) + extract
  `body_text`. **`ArticleListSerializer` includes `helpdesk`** (added 2026-06-24) so the UI can filter
  org-wide (`helpdesk == null`) client-side. **No inline-image endpoint exists** for KB.
- **`/kb-categories/`** (`KBCategoryViewSet`, module **`itsm.knowledge.authoring`**) — full CRUD,
  filter `helpdesk/parent`.
- **`/kb-article-links/`** (`ArticleTicketLinkViewSet`, module `itsm.knowledge`).
- **`/kb/`** (`KBBrowseViewSet`, read-only, module `itsm.knowledge`) — the **portal** reading surface:
  only `status=published, visibility=portal`; `retrieve` bumps `view_count`; `/kb/categories/`.

## RBAC
- **`itsm.knowledge`** — article CRUD + browse. Agent: read + **create/update** (no delete).
  Supervisor: full incl. **delete**. Requestor: read only (portal browse).
- **`itsm.knowledge.authoring`** — category CRUD. Agent create/update, Supervisor delete.
- **"lead"** is a per-helpdesk membership role; a lead's *global* role is `agent`, so leads already
  have authoring. `publish`/`unpublish` are POST → "create" on `itsm.knowledge` → agents allowed.

## Frontend
- **Portal browse (end users)** — `app/t/[org]/(portal)/portal/kb/` + `[articleId]/` (read-only,
  `kbApi.browse/get/categories`).
- **Agent authoring UI (added 2026-06-24)** — gated by `useCanAuthorKb` (`lib/itsm/kb-perms.ts`).
  The index `agent/kb/page.tsx` shows a tile per `user.helpdesks` + an **Organisation-wide** tile
  (sentinel `KB_ORG_KEY = "_org"` → `helpdesk = null`).
  - **Home entry (2026-06-25):** the agent Home no longer renders a KB tile *grid*; it shows a single
    **"Knowledge Base"** card → `agentKb(org)` (the index above). One option on Home, the helpdesk/org
    split appears only after you click in.
  - **KB chrome (2026-06-25):** `/agent/kb/*` is wrapped by `AgentShell`'s minimal bar, which now
    carries the shared **`components/shell/app-switcher.tsx`** (Home + switch helpdesk) — so there's a
    way back Home / to a workspace from inside KB (previously only the browser back button).
  - Routes `app/t/[org]/(agent)/agent/kb/`: `layout.tsx` (one-shot authoring gate → redirect to agent
    Home if not allowed), `page.tsx` (workspace index), `[helpdeskKey]/page.tsx` (Articles | Categories
    tabs; `_org` ⇒ org-wide), `[helpdeskKey]/articles/new` + `…/[articleId]/edit`.
  - Components `components/kb/`: `article-editor.tsx` (title→auto-slug, summary, category, tags,
    visibility, body via the shared **`RichTextEditor`** — **no `onImageUpload`** in v1; Save draft /
    Publish / Unpublish / Delete[supervisor]), `article-list.tsx` (status/visibility filters + search,
    badges), `category-manager.tsx` (one-level tree CRUD via `dialog`, delete supervisor-only).
  - `kbApi` (`lib/itsm/api.ts`) authoring methods: `listArticles/getArticle/createArticle/
    updateArticle/deleteArticle/publish/unpublish`, `listCategories/createCategory/updateCategory/
    deleteCategory`. Types `ArticleInput`/`KBCategoryInput` + extended `KBCategory`/`Article`/
    `ArticleListItem` (`helpdesk`). Slug helpers in `lib/itsm/slug.ts` (`slugify`, `withSlugSuffix`).

## Gotchas
- **`slug` is required + globally unique and NOT auto-generated.** The UI derives it from the
  title/name (`slugify`) and **retries once with a random suffix** (`withSlugSuffix`) on a 400/`slug`
  uniqueness collision — don't drop this or two same-titled articles fail to save.
- **Org-wide filtering is client-side.** The list filterset can't express `helpdesk__isnull`, so the UI
  fetches all and filters `helpdesk == null` for the `_org` scope (relies on the `helpdesk` field now in
  `ArticleListSerializer`).
- **No KB inline-image upload** (only ticket-comment attachments exist). The editor is image-free in
  v1; adding it needs a new `itsm.knowledge.authoring`-gated media endpoint.

## Key files
Backend: `backend/apps/itsm_knowledge/{models,views,serializers,urls}.py`.
Frontend: `components/kb/{article-editor,article-list,category-manager}.tsx`,
`app/t/[org]/(agent)/agent/kb/**`, `lib/itsm/kb-perms.ts`, `lib/itsm/slug.ts`, `kbApi` in
`lib/itsm/api.ts`. Reuses `components/ui/rich-text-editor.tsx`.
