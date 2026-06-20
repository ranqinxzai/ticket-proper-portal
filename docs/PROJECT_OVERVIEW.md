# Ticketing System — Project Overview

## What is this?

A two-in-one app for the OneMed organisation, deployed at **ticket.onemedai.org**:

1. **QA Tracker** — replaces the Excel workbook the team used for HIS/EHR test cases and bug reports. Modules, severities, priorities, statuses, screenshots, links between bugs and test cases.
2. **Project Management** — a Monday.com-style boards module: dynamic columns (text / status / priority / person / date / file …), groups, item rows, per-item comments + activity log + file vault.

Single tenant, single Postgres, single Redis-less deployment. No multi-hospital scoping.

---

## Tech Stack

| Layer | Technology |
|------|-----------|
| Backend | Django 5, Django REST Framework, PostgreSQL 16 |
| Frontend | Next.js 14 (App Router), React 18, TypeScript 5, Tailwind v3, shadcn/ui |
| Auth | Custom session auth (`apps.accounts.User` with role + JSON `app_access`) |
| Rich text | Tiptap 2 (project_management comments) |
| Forms | Plain controlled inputs (no react-hook-form yet) |
| Tables | TanStack Virtual (board view) |
| Toast | Sonner |
| Infra | Docker Compose, Nginx (TLS termination is upstream) |

---

## Repository Layout

```
ticketingsystem/
├── backend/
│   ├── core/                            ← Django settings, root urls
│   ├── apps/
│   │   ├── core/                        ← shared base mixins + lookups
│   │   ├── accounts/                    ← User model, auth, RBAC (HasAppAccess)
│   │   ├── qa/                          ← Module, Severity, Priority, TestStatus,
│   │   │                                  BugStatus, Bug, TestCase, Attachment
│   │   └── project_management/          ← Project → Board → Group → Item → CellValue
│   │                                      + ItemComment + CommentAttachment + ItemActivity
│   ├── media/                           ← user uploads (git-ignored)
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/
│   ├── app/                             ← Next.js App Router pages
│   │   ├── projects/[id]/boards/[boardId]/page.tsx
│   │   ├── modules/, test-cases/, bugs/, settings/   (QA tracker)
│   │   └── layout.tsx                   ← root + Toaster mount
│   ├── components/
│   │   ├── pm/                          ← BoardView, CellRenderer, AddColumnDialog,
│   │   │                                  CommentIconCell, ItemDrawer, CommentList,
│   │   │                                  CommentComposer, FilesTab, ActivityFeed
│   │   ├── ui/                          ← shadcn primitives (button, sheet, tabs, …)
│   │   └── AttachmentUploader.tsx       ← QA-side screenshot uploader
│   ├── lib/
│   │   ├── api.ts                       ← fetch wrapper (api.get/post/patch/del/upload)
│   │   ├── pm.ts                        ← PM types + API helpers
│   │   └── utils.ts                     ← cn()
│   └── package.json
│
├── docs/                                ← THIS folder (skills + QA + bug log)
├── docker-compose.yml
└── README.md
```

---

## App Hierarchy (Project Management module)

```
Project        (sidebar entry)
  └─ Board     (table / sub-module)
       ├─ Column      (dynamic schema: text / status / priority / person / date / file / …)
       ├─ Group       (coloured row-section)
       └─ Item        (a row)
            ├─ CellValue          (one row per item × column; typed storage)
            │     └─ CellAttachment   (files for long_text / file cells)
            ├─ ItemComment        (rich-text discussion thread)
            │     └─ CommentAttachment
            └─ ItemActivity       (append-only audit feed)
```

---

## Authentication

Custom session auth. `apps.accounts.User` extends Django `AbstractUser` and adds:
- `role` — ADMIN / QA_LEAD / QA / DEV / VIEWER
- `app_access` — JSON list of app codes the user can reach (`["pm", "qa"]`, etc.)

Permission gating happens via `HasAppAccess.for_app("pm")` on every PM ViewSet.

DRF default in dev: `AllowAny`. ViewSets opt in with `permission_classes = [HasAppAccess.for_app("pm")]`.

---

## Running Locally

```bash
# Backend
cd backend
source venv/bin/activate
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000

# Frontend
cd ../frontend
npm install
npm run dev   # http://localhost:3000
```

API base: `http://127.0.0.1:8000/api/v1/`.

---

## Critical Conventions

1. **PM uses `BigAutoField` PKs**, not UUIDs (this differs from OneMed EHR).
2. **No multi-tenant filter** — single workspace, all rows global.
3. **Soft delete preferred** for `ItemComment` (`is_deleted=True`); hard delete for everything else (single-tenant, low compliance footprint).
4. **Activity log is explicit** — every write site calls `apps.project_management.activity.log_activity(...)` directly. **No Django signals.** Easier to audit and grep for.
5. **Rich-text bodies are sanitised on save** with `bleach`. Frontend renders the stored HTML with `dangerouslySetInnerHTML` — safe because the server already stripped scripts.
6. **Primary text cell mirrors `Item.name`** — when the first (`is_primary=True`) text column changes, the parent `Item.name` is rewritten. See [`backend/apps/project_management/views.py:223-247`](../backend/apps/project_management/views.py).
