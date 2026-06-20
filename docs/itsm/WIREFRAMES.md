# Wireframes — ITSM Platform

ASCII wireframes for the major screens. These match the IA in `INFORMATION_ARCHITECTURE.md` and the component tree in `FRONTEND_COMPONENT_ARCHITECTURE.md`. Conventions: `[Button]`, `‹select›`, `( )`/`(•)` radio, `[ ]`/`[x]` checkbox, `▸` nav item, `●` RAG dot.

---

## 1. App Shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ITSM    ⌘K Search tickets…                              🔔 3   ‹Project: INC›  ▾AS │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ▸ Projects    │                                                                │
│ ▸ Queues      │                                                                │
│ ▸ Tickets     │                      < route content >                         │
│ ▸ Dashboards  │                                                                │
│ ▸ Reports     │                                                                │
│ ───────────── │                                                                │
│ ⚙ Administration (Supervisor only)                                             │
└───────────────┴──────────────────────────────────────────────────────────────┘
   nav items gated by the permission map; 🔔 = notification bell + inbox popover
```

## 2. Ticket Queue

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tickets · INC                          [+ Create]   ‹Saved queue: My open ▾›   │
│ Filters: (•)Open ( )All  [Priority ▾][Assignee ▾][Group ▾][+ Add filter]  ⚙Cols│
├──────┬───────────────────────────────┬──────────┬──────┬──────────┬────────────┤
│ [x]  │ INC-1042  VPN down for finance │ ●In Prog │ High │ A. Smith │ 🔴 12m left │
│ [ ]  │ INC-1041  Printer offline      │ ●New     │ Med  │ —        │ 🟢 3h 40m   │
│ [ ]  │ INC-1039  Email bounce-backs   │ ●Pending │ Crit │ R. Patel │ ⏸ paused    │
│ …    │ (virtualized rows)                                                       │
├──────┴───────────────────────────────────────────────────────────────────────┤
│ ▣ 2 selected   [Assign ▾] [Transition ▾] [Set priority ▾] [Watch] [✕]         │  ← bulk bar (gated itsm.tickets.bulk)
└──────────────────────────────────────────────────────────────────────────────┘
```

## 3. Ticket Detail (2‑pane)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ INC-1042 · VPN down for finance team                         [Transition ▾]   │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ Description  ✎                                 │ Status     ●In Progress  ▾    │
│  Users in finance cannot reach the VPN.        │ Assignee   ‹A. Smith ▾›       │
│                                                │ Group      ‹Network Team ▾›   │
│ ┌ Comments ┬ Worklog ┬ History ┬ Files ┐       │ Priority   ‹High ▾›           │
│ │(Public)(Internal)                     │       │ ───────────────────────────  │
│ │ ▸ A. Smith (public)  Looking into it. │       │ SLA                          │
│ │ ▸ R. Patel (internal) Concentrator?   │       │  First response ✓ met        │
│ │                                       │       │  Resolution 🔴 12m left (red) │
│ ├───────────────────────────────────────┤       │ ───────────────────────────  │
│ │ [Tiptap composer]    (•)Public ( )Int │       │ Watchers   AS, RP   [+ Watch] │
│ │ [Canned ▾] [@] [B I U]        [Comment]│       │ Links      blocks INC-1050   │
│ └───────────────────────────────────────┘       │ Custom fields (from layout)  │
│                                                │  CI: vpn-gw-01   Site: HQ     │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

## 4. Create Ticket (3‑step wizard)

```
Step 1 ───────────────────  Step 2 ───────────────────  Step 3 ──────────────────
┌─ Type ──────────────┐     ┌─ Template (optional) ─┐    ┌─ Details ───────────────┐
│ Project ‹INC ▾›     │     │ ( ) Blank             │    │ Summary  [____________] │
│ Type:               │     │ (•) VPN outage        │    │ Priority ‹High ▾›       │
│  (•) Incident       │     │ ( ) Password reset    │    │ Impact  ‹High ▾›        │
│  ( ) Hardware       │     │ ( ) New laptop        │    │ Group   ‹Network ▾›     │
│  ( ) Network        │     │                       │    │ Description [Tiptap]    │
│  ( ) Application     │     │                       │    │ + dynamic fields(layout)│
│            [Next →] │     │      [← Back][Next →] │    │      [← Back][Create]   │
└─────────────────────┘     └───────────────────────┘    └─────────────────────────┘
   form built from FieldLayout · runtime Zod · FieldControl per field type
```

## 5. Field & Layout Designer (dnd‑kit)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layout · INC / Incident                    [+ New field]   [Preview] [Save]   │
├───────────────┬─────────────────────────────────────────────┬───────────────┤
│ Palette       │ Layout canvas (drag to order)               │ Field editor  │
│  ▫ Text       │ ┌─────────────────────────────────────────┐ │ Key   ci_name │
│  ▫ Multiline  │ │ ⠿ Summary*           [req] [vis]         │ │ Type  text    │
│  ▫ Number     │ │ ⠿ Priority           [req]              │ │ [x] Mandatory │
│  ▫ Date       │ │ ⠿ Affected CI (text) [req][hide?]       │ │ [ ] Hidden    │
│  ▫ Dropdown   │ │ ⠿ Site (dropdown)                       │ │ Visibility ▾  │
│  ▫ User picker│ │ ⠿ … drop here …                         │ │ Options: HQ,…│
│  ▫ Group pick │ └─────────────────────────────────────────┘ │   [Save field]│
└───────────────┴─────────────────────────────────────────────┴───────────────┘
```

## 6. Visual Workflow Builder (React Flow)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Workflow · Default Incident (v1)        [Validate] [Publish]   ⊕ Add status   │
├──────────────────────────────────────────────────────┬──────────────────────┤
│  todo            in_progress              done        │ Inspector            │
│ ┌────┐  Assign  ┌────────┐  Hold  ┌────────┐          │ Transition: Resolve  │
│ │New │ ───────▶ │Assigned│──────▶ │In Prog │◀──Resume │ From: In Progress    │
│ └────┘          └────────┘        └───┬────┘          │ To:   Resolved       │
│                                Resolve│               │ Conditions:          │
│                                       ▼               │  • is_assignee       │
│                                  ┌─────────┐  Close    │ Screen: Resolution*  │
│                                  │Resolved │ ────────▶ │ Post-fns:            │
│                                  └─────────┘  ┌──────┐ │  set_resolution      │
│                                   ▲ Reopen    │Closed│ │  stamp resolved_at   │
│                                   └───────────┴──────┘ │  stop_sla(resolution)│
│ ! Validation: 1 initial ✓ · 1 Done ✓ · reachable ✓    │       [Save]         │
└──────────────────────────────────────────────────────┴──────────────────────┘
```

## 7. SLA Policy Editor

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SLA Policy · Standard Incident                                  [Save]        │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ Business calendar         │ Metrics & targets                                │
│  Timezone ‹Europe/Berlin› │  ┌ Metric ─────────┬ Crit ┬ High ┬ Med ┬ Low ┐  │
│  Days  [x]Mon…[x]Fri []Sat│  │ First response  │ 15m  │ 30m  │ 2h  │ 4h  │  │
│  Hours 09:00 – 17:00      │  │ Resolution      │ 2h   │ 4h   │ 1d  │ 3d  │  │
│  Holidays [+ Add]         │  └─────────────────┴──────┴──────┴─────┴─────┘  │
│   • 2026-12-25 Christmas  │ Escalations                                      │
│                           │  75% → notify assignee                           │
│                           │  90% → notify group lead                         │
│                           │  100%→ reassign to lead + raise_priority         │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

## 8. Notification Scheme Editor

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Notification Scheme · INC default                               [Save]        │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ Rules                          │ Edit rule: CommentAdded                     │
│  • TicketCreated   in_app,email│  Event     ‹CommentAdded ▾›                  │
│  • Assigned        in_app,email│  Channels  [x]In-app [x]Email [ ]Webhook    │
│ ▸• CommentAdded    in_app,email│  Recipients [x]Requestor [x]Watchers        │
│  • StatusChanged   email       │             [ ]Assignee [ ]Group members    │
│  • SLABreach       in_app,email│  Template ‹Public comment added ▾› [Edit]   │
│  [+ Add rule]                  │  [x]Suppress actor  [ ]Dedupe off           │
│                                │  ┌ Email template (Tiptap) ───────────────┐ │
│                                │  │ Subject: New comment on {{ticket}}      │ │
│                                │  │ {{actor}} commented: {{preview}} [link] │ │
│                                │  └─────────────────────────────────────────┘ │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

## 9. Dashboard Builder (react‑grid‑layout)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Dashboard · Service Desk         [+ Add widget ▾]   [Share]   [Done editing]  │
├──────────────────────────┬──────────────────────────┬──────────────────────┤
│ ⠿ Open tickets       142 │ ⠿ By priority   (pie)    │ ⠿ SLA compliance      │
│   KPI                     │   ◔ Crit High Med Low    │   gauge  92%          │
├──────────────────────────┴──────────────────────────┤──────────────────────┤
│ ⠿ Created vs Resolved (trend, last 30d)             │ ⠿ My queue (list)     │
│   ╱╲   ╱╲___                                          │  INC-1042 …          │
│  ╱  ╲_╱      resolved ▁▂▅▇                            │  INC-1041 …          │
└──────────────────────────────────────────────────────┴──────────────────────┘
   each widget backed by a SavedFilter.query_spec · drag ⠿ to move/resize
```

## 10. Reports

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Report · SLA Compliance                                                       │
│ Range ‹Last 30 days ▾›  Project ‹INC ▾›  Group ‹All ▾›  Group-by ‹Priority ▾› │
├─────────────────────────────────────────────────────────────────────────────┤
│   Met ████████████████████░░  92%                                            │
│   ┌ bar chart: met vs breached by priority ┐                                 │
│   │ Crit ██░  High ████░ Med █████ Low █████│                                 │
│   └──────────────────────────────────────────┘                              │
│ ┌ Table ───────────┬──────┬─────────┬────────┐                  [Export CSV] │
│ │ Priority │ Tickets│ Met  │ Breached│ %      │                              │
│ │ Critical │ 18     │ 16   │ 2       │ 88.9%  │                              │
│ │ High     │ 64     │ 60   │ 4       │ 93.8%  │                              │
│ └──────────┴────────┴──────┴─────────┴────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 11. Login

```
┌──────────────────────────────┐
│           ITSM                │
│   ┌────────────────────────┐  │
│   │ Username  [__________] │  │
│   │ Password  [__________] │  │
│   │            [ Sign in ] │  │
│   └────────────────────────┘  │
│   POST /api/v1/itsm/auth/login│
└──────────────────────────────┘
```
