# OneHelpdesk — Client Onboarding Input Form

Please fill in the sections below. This information lets us configure your OneHelpdesk
instance — workspaces, projects, users, SLAs, routing and notifications — before go‑live.
Anything you leave blank, we will set up with sensible defaults and confirm with you later.

**How OneHelpdesk is structured (quick orientation):**

```
Helpdesk (Workspace / Department)        e.g. IT Helpdesk, HR Helpdesk
   └── Projects                          e.g. Incident, Service Request, + custom
          └── Ticket Types / Categories  e.g. Hardware, Access Request, Network
Cross-cutting setup that applies to the above:
   • Users & Roles      • Assignment Groups & Routing   • SLAs & Business Calendar
   • Custom Fields      • Workflows & Statuses          • Approvals
   • Notifications/Email • Service Catalog & Knowledge Base
```

> Every helpdesk gets a short **prefix code** (2–5 letters) used in ticket numbers — e.g.
> `IT` → `ITINC-1` (incident), `ITREQ-1` (request). Tell us the prefix you'd like per helpdesk.

---

## A. Helpdesks (Workspaces)

List every helpdesk / department that will run on the platform. A user in one helpdesk
**cannot** see another helpdesk's tickets unless explicitly given access.

| # | Helpdesk Name | Prefix (2–5 letters) | Short Description | Owner / Lead |
|---|---------------|----------------------|-------------------|--------------|
| 1 | _e.g. IT Helpdesk – Dehradun_ | _e.g. ITDD_ | | |
| 2 | _e.g. IT Helpdesk – Delhi_ | _e.g. ITDL_ | | |
| 3 | | | | |

> ⚠️ **Decision needed:** "IT Helpdesk Dehradun" and "IT Helpdesk Delhi" can be modelled
> **two ways** — please tell us which you prefer:
> - **(a) Separate helpdesks** — full isolation; each location has its own queue, agents,
>   reports and ticket prefix. Best if the teams are independent.
> - **(b) One "IT Helpdesk" with Location as a field/assignment group** — shared queue, one
>   IT team, filter/route by location. Best if it's one team across sites.

---

## B. Projects within each Helpdesk

Each helpdesk comes with two default projects — **Incident** (something is broken) and
**Service Request** (someone wants something). You can add **custom** projects too
(e.g. "Change Management", "Onboarding"). For each helpdesk, list the projects and the
ticket **categories** within them.

| Helpdesk | Project | Type (Incident / Request / Custom) | Ticket Categories / Types |
|----------|---------|-------------------------------------|----------------------------|
| _IT_ | Incident | Incident | _Hardware, Network, Software, Email…_ |
| _IT_ | Service Request | Request | _Access Request, New Laptop, Software Install…_ |
| _IT_ | _e.g. Change Mgmt_ | Custom | |
| _HR_ | … | | |

---

## C. Priority, Impact & Urgency

Tickets carry **Priority** (drives SLA & routing). Priority can be set directly or derived
from **Impact × Urgency**. Confirm the scheme you want, or accept the default.

- **Priorities** (default): `Critical`, `High`, `Medium`, `Low` — change/extend? ______
- Do you want priority **auto-derived** from an Impact × Urgency matrix? ☐ Yes ☐ No
- If yes, list Impact levels ____________ and Urgency levels ____________

---

## D. SLA Targets

For each priority, what is the target **first response** time and **resolution** time?
(These are measured against your business hours in Section E.) Fill per helpdesk if they differ.

| Priority | First Response (target) | Resolution (target) |
|----------|-------------------------|----------------------|
| Critical | _e.g. 30 min_ | _e.g. 4 hours_ |
| High | _e.g. 1 hour_ | _e.g. 8 hours_ |
| Medium | _e.g. 4 hours_ | _e.g. 2 business days_ |
| Low | _e.g. 1 business day_ | _e.g. 5 business days_ |

**Escalations** — when an SLA is at risk/breached, what should happen?

| At | Action |
|----|--------|
| 75% of SLA elapsed | _e.g. notify assignee_ |
| 90% of SLA elapsed | _e.g. notify supervisor_ |
| 100% / breached | _e.g. notify supervisor + reassign / raise priority_ |

---

## E. Business Hours & Calendar (IST)

The SLA clock only runs during working hours.

- **Time zone:** Asia/Kolkata (IST) — confirm ______
- **Working days:** _e.g. Mon–Fri / Mon–Sat_ ______
- **Working hours:** _e.g. 09:30–18:30_ ______
- **Different calendar per helpdesk?** ☐ No (one for all) ☐ Yes — describe ______
- **Holiday list** (dates the SLA clock pauses) — attach or list below:

| Date | Holiday |
|------|---------|
| | |

---

## F. Workflows & Statuses

Default ticket lifecycle: **New → Assigned → In Progress → On Hold → Resolved → Closed**
(with Reopen). Tell us only where you differ.

- Use the default lifecycle? ☐ Yes ☐ No
- Any **custom statuses** (e.g. "Awaiting Vendor", "Pending Approval")? ______
- Any **custom workflow rules** (e.g. mandatory field before Resolve, manager approval before
  closing a request, can't close with open sub-tasks)? ______
- Different workflow per project? ☐ No ☐ Yes — describe ______

---

## G. Users & Roles

List everyone who will **work** tickets (agents/supervisors). Roles in OneHelpdesk:

- **Agent** — works tickets in their assigned helpdesk(s).
- **Supervisor** — Agent powers **plus** admin/config (manage users, SLAs, groups, reports).
  *(This is the "admin" role — there is no separate "Admin" role.)*
- **Requestor** — end-user who only raises/tracks their own requests via the portal (see Section O).
- **Lead** — not a role but a flag: a user can be the **lead** of a helpdesk or assignment group.
- Custom roles with fine-grained permissions can be created if needed.

| Name | Email | Role (Agent / Supervisor) | Helpdesk(s) they access | Lead of? (helpdesk/group) |
|------|-------|---------------------------|--------------------------|----------------------------|
| | | | | |
| | | | | |

> **How do users log in?** ☐ Local username/password (we create accounts)
> ☐ SSO / Single Sign-On (Google / Microsoft / SAML) — if yes, which? ______

---

## H. Assignment Groups & Routing

**Assignment groups** are the teams that own tickets (e.g. "Desktop Support", "Network Team").
New tickets can auto-assign to a group, and to a person within it.

| Group Name | Helpdesk | Members (names/emails) | Lead |
|------------|----------|------------------------|------|
| _e.g. Desktop Support_ | _IT_ | | |
| _e.g. Network Team_ | _IT_ | | |

**Auto-assignment** — when a new ticket lands on a group, who gets it?
☐ Round-robin (even spread) ☐ Least-loaded ☐ Always the group lead ☐ Manual pick

**Routing rules** — should tickets auto-route to a group based on conditions? e.g.:
- _"Category = Network → Network Team"_
- _"Location = Delhi → IT Delhi group"_
- _"Priority = Critical → notify Supervisor"_

List your rules: ______________________________________________

---

## I. Custom Fields

Beyond the standard fields (summary, description, priority, category, requester), what extra
fields do you need to capture? Specify per project.

| Project | Field Label | Type (text / dropdown / date / number / user) | Options (if dropdown) | Required? |
|---------|-------------|------------------------------------------------|------------------------|-----------|
| _IT Incident_ | _e.g. Asset Tag_ | text | | No |
| _IT Incident_ | _e.g. Location_ | dropdown | _Dehradun, Delhi…_ | Yes |
| _IT Request_ | _e.g. Cost Center_ | text | | No |

---

## J. Approvals

Some requests need sign-off before work starts (e.g. software purchase, access grant).

- Which request types require approval? ______
- Who approves? ☐ The requester's **manager** ☐ A named approver ☐ A group — specify ______
- (If "manager" — we'll need each user's manager mapping; include it in Section G or attach.)

---

## K. Notifications & Email

- **Channels:** In-App ✔ and Email are supported (WhatsApp is on the roadmap).
- Which events should email the requester/agent? (ticket created, assigned, replied,
  resolved, SLA breach, approval needed) ______
- **Outbound email** — do we send from your mail server (SMTP details) or a OneHelpdesk
  address? ______
- **Inbound email-to-ticket** — should emails to an address (e.g. `support@yourco.com`)
  create tickets automatically? If yes, list the address(es) per helpdesk: ______

---

## L. Service Catalog (Request Portal)

The end-user portal can show a **catalog** of requestable items (e.g. "New Laptop",
"VPN Access", "Reset Password"). List the items you want to offer, grouped by helpdesk:

| Helpdesk | Catalog Item | Maps to Project/Category | Needs Approval? |
|----------|--------------|---------------------------|------------------|
| _IT_ | _New Laptop_ | _Service Request / Hardware_ | Yes |
| _IT_ | _VPN Access_ | _Service Request / Access_ | Yes |

---

## M. Knowledge Base

Self-help articles end-users and agents can search.

- Do you want a Knowledge Base at launch? ☐ Yes ☐ Later
- Any existing articles/FAQs to import? ☐ Yes (attach) ☐ No

---

## N. Canned Responses / Templates

Pre-written replies agents can insert (e.g. "We've received your request…", "Resolved — please
confirm"). List any you want pre-loaded, per helpdesk: ______

---

## O. End Users / Requestors

The people who **raise** tickets (staff/customers), as opposed to agents who work them.

- Roughly how many end users? ______
- How should they be created? ☐ Bulk import (we'll send a template) ☐ Self-register
  ☐ Auto-provisioned via SSO ☐ Created on first ticket
- Should end users be restricted to certain helpdesks? ______

---

## P. Branding

- Company logo (attach, PNG/SVG) ______
- Brand color(s) / per-helpdesk colors & icons ______
- Portal name / wordmark (default: "One Helpdesk") ______

---

## Q. Reports & Dashboards

- Which KPIs matter most? (open tickets, SLA compliance %, avg resolution time, agent
  workload, tickets by category…) ______
- Who needs scheduled reports, and how often? ______

---

## R. Data Migration & Go-Live

- Any existing tickets / historical data to migrate from another tool? ☐ No ☐ Yes — from
  what system, and how many tickets? ______
- Target go-live date: ______
- Pilot scope first (one helpdesk) then expand? ☐ Yes ☐ No

---

### Checklist of what we need from you

- [ ] A. Helpdesk list + prefixes (and the location decision)
- [ ] B. Projects + categories per helpdesk
- [ ] C/D. Priorities + SLA targets + escalations
- [ ] E. Business hours + holiday calendar
- [ ] F. Any custom statuses/workflow rules
- [ ] G. Users, emails, roles, helpdesk access (+ login method)
- [ ] H. Assignment groups + routing rules
- [ ] I. Custom fields
- [ ] J. Approval rules (+ manager mapping)
- [ ] K. Notification/email preferences (+ SMTP / inbound addresses)
- [ ] L–N. Catalog items, KB, canned responses (optional at launch)
- [ ] O. End-user count + provisioning method
- [ ] P. Logo + branding
- [ ] Q. Reporting needs
- [ ] R. Migration + go-live date
