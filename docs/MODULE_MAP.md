# Module Map — Ticketing System

## Apps

| App | Purpose | Key Models | URL Prefix |
|-----|---------|------------|------------|
| `apps.core` | Shared mixins (`SoftDeleteModel`, `TimeStamped`, `BaseModel`) + lookup utilities. | (abstract only) | n/a |
| `apps.accounts` | User identity + role-based app access. | `User` (extends `AbstractUser`, adds `role`, `app_access`) | `/api/v1/auth/...` |
| `apps.qa` | QA tracker — Excel replacement. Modules, severities, priorities, statuses, bugs, test cases, screenshots. | `Module`, `Severity`, `Priority`, `TestStatus`, `BugStatus`, `Bug`, `TestCase`, `Attachment` | `/api/v1/...` (root-mounted) |
| `apps.project_management` | Monday.com-style boards. Project → Board → Group → Item → CellValue, plus comments + activity. | `Project`, `Board`, `Column`, `Group`, `Item`, `CellValue`, `CellAttachment`, `ItemComment`, `CommentAttachment`, `ItemActivity` | `/api/v1/pm/...` |

---

## Cross-App Touchpoints

```
   accounts.User  ──► created_by / author / actor on every PM model
        │
        └──► app_access (JSON list)  ──► HasAppAccess permission ──► PM viewsets
```

QA and Project Management are **independent** modules — no FKs cross between them. A single login can access both via `app_access = ["qa", "pm"]`.

---

## Project Management — internal FK chain

```
Project (id BigAuto)
  └─ Board (id BigAuto, project FK)
       ├─ Column (board FK, type, settings JSON)
       ├─ Group  (board FK, color)
       └─ Item   (board FK, group FK nullable, name, display_order)
            ├─ CellValue       (item FK, column FK, UNIQUE(item,column), one typed value column)
            │     └─ CellAttachment   (cell FK, file)
            ├─ ItemComment     (item FK, author FK, body_html, body_text, edited_at, is_deleted)
            │     └─ CommentAttachment (comment FK, file)
            └─ ItemActivity    (item FK, actor FK nullable, action, column FK nullable, payload JSON)
```

`CellValue` is intentionally one row per `(item, column)` pair instead of dynamic columns on `Item`. Lets users add/remove columns without DDL migrations.

---

## QA — internal FK chain

```
Module
  ├─ TestCase (module FK, severity, priority, test_status FKs)
  └─ Bug      (module FK, severity, priority, bug_status FKs, links to test_cases)

Attachment (test_case FK | bug FK, mutually exclusive)
```

---

## API Surface (high level)

### QA Tracker
- `/api/v1/modules/`, `/severities/`, `/priorities/`, `/test-statuses/`, `/bug-statuses/`
- `/api/v1/test-cases/`, `/bugs/`, `/attachments/`

### Project Management
- `/api/v1/pm/projects/`
- `/api/v1/pm/boards/` + `/api/v1/pm/projects/<id>/boards/` (nested)
- `/api/v1/pm/columns/`  + `/columns/reorder/`
- `/api/v1/pm/groups/`
- `/api/v1/pm/items/`    + `/items/<id>/cells/<column_id>/`  + `/items/<id>/files/`
- `/api/v1/pm/attachments/` (cell attachments)
- `/api/v1/pm/comments/` + `/api/v1/pm/comment-attachments/`
- `/api/v1/pm/activity/` (read-only audit feed, filter by `?item=`)
