# HIS QA Tracker — local dev

Simple local setup for tracking **test cases and bugs** across your HIS/EHR modules. Replaces the Excel workflow.

- Django 5 + DRF (backend) · Postgres · local disk for screenshots
- Next.js 14 + Tailwind (frontend)

## One-time setup

### 1. Create the Postgres DB

```bash
psql -U postgres -c "CREATE DATABASE ticketing_system;"
```

(Credentials come from `backend/.env`.)

### 2. Backend

```bash
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser

# Seed default lookups (severity, priority, test/bug statuses)
python manage.py seed_lookups

# Import your existing Excel workbook (creates modules + bugs + test cases)
python manage.py import_excel "..\HIS_Complete_Test_Cases (3).xlsx"

python manage.py runserver 0.0.0.0:8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>.

## What you get

| Page | What it does |
|---|---|
| `/` | Dashboard — totals, test cases by status, bugs by status, per-module counts |
| `/modules` | Grid of all modules with test case / bug counts |
| `/modules/[id]` | Test case table for one module (Registration, Nursing, Lab, …) |
| `/test-cases` | All test cases, search by TC ID / title / sub-module |
| `/test-cases/new` | Create — TC ID auto-generates, but you can override it |
| `/test-cases/[id]` | Detail + screenshots + edit link |
| `/bugs` | Bug list |
| `/bugs/[id]` | Bug detail + linked test cases + screenshots |
| `/settings` | Add/edit **Modules, Severities, Priorities, Test Statuses, Bug Statuses** — the dropdowns in every form |
| `/projects` | **Project Management** — Monday.com-style boards. Projects → Boards → Groups → Items with dynamic columns (text/status/priority/person/date/file). Per-item right-side drawer with rich-text comments, attachment vault, and append-only activity log. |

## Daily usage

- **Log a new test case**: `/test-cases/new` → pick module → fill in → save. TC ID auto-generates as `TC_REG_004` etc.
- **Log a bug**: `/bugs/new` → pick module → fill in → save. Bug ID auto-generates as `BUG-012` etc.
- **Link a bug to a failing test case**: open the test case → Edit → pick it in the "Linked Bug" dropdown.
- **Upload a screenshot**: open a test case or bug detail page → scroll to the Attachments section → pick file → Upload.
- **Change allowed statuses/severities/priorities**: `/settings` — add, rename, reorder, delete, change colors.

## Import / re-import the Excel

Re-running `import_excel` is safe — it updates existing rows (matched by `TC ID` / `Bug ID`) and creates new ones. Any new severities/priorities/statuses it finds in the sheet are created automatically so you can edit them in `/settings` afterwards.

## Layout

```
backend/
  core/                    project config (settings, urls)
  apps/
    core/                  base models
    accounts/              User + roles
    qa/                    Module, Severity, Priority, TestStatus, BugStatus,
                           Bug, TestCase, Attachment + APIs + admin
      management/commands/
        seed_lookups.py
        import_excel.py
  media/                   uploaded screenshots (git-ignored)

frontend/
  app/                     Next.js App Router pages
  components/              TestCaseForm, BugForm, AttachmentUploader
  lib/                     api client + types
```

## Project Management module

The `/projects/<id>/boards/<id>/` page is a Monday.com-style work tracker:

- **Dynamic columns** — text, long_text, number, status, dropdown, priority, person, date, checkbox, file. Add/remove at runtime; no migrations.
- **Comment + activity drawer** — every row has a comment-bubble icon (filled when comments exist, count badge). Click → right-side drawer with three tabs:
  - **Comments** — Tiptap rich-text editor with formatting, links, headings, lists, attachments. All bodies are server-sanitised via `bleach`.
  - **Files** — every file attached to this item, whether to a `long_text` / `file` cell or to a comment.
  - **Activity Log** — append-only audit trail: cell changes (old → new chips), comment add/edit/delete, attachment add/remove, item create/rename/move.

See [`docs/SKILL_project_management.md`](docs/SKILL_project_management.md) and [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) for the full QA + skill notes.

## Docs / Skills

The [`docs/`](docs/) folder is the source of truth for module skills + QA. Read it before any non-trivial change.

- [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) — stack, layout, conventions
- [`docs/MODULE_MAP.md`](docs/MODULE_MAP.md) — apps + their cross-links
- [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) — checks to run on every change
- [`docs/SKILL_project_management.md`](docs/SKILL_project_management.md) — PM domain map
- [`docs/BUG_LOG.md`](docs/BUG_LOG.md) — append-only post-mortem trail

## Notes

- Auth is open for local dev (any request goes through). Add login later if you need it.
- Email/SMTP is not wired — the old notification system was overkill for this use case.
