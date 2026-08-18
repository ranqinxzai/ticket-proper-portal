"""Per-user project assignment — strict-whitelist access + hard boundary.

Covers `services.accessible_project_ids` (the scope rule + lead overrides),
`ProjectViewSet` list/tab scoping, the ticket hard boundary, and the
`add_member` requestor guard + `create_user` project validation.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_helpdesks.models import HelpdeskMembership
from apps.itsm_rbac.models import RoleAssignment, RoleModulePermission, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_tickets.services import ticket_service

from .models import Project, ProjectMembership
from .seed import run as seed_projects
from .services import accessible_project_ids

User = get_user_model()


def _seed():
    seed_rbac()
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


class ProjectAccessTests(TestCase):
    def setUp(self):
        cache.clear()  # check_permission is cached per (role, module, action)
        _seed()
        self.itinc = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.itreq = Project.objects.get(helpdesk__key="IT", project_type="service_request")
        self.hd_it = self.itinc.helpdesk_id

        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.hd_it, user=self.agent, is_active=True)

        self.sup = User.objects.create_user(username="su", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.boss = User.objects.create_superuser(username="boss", password="x", email="b@b.io")

    # ── the scope rule ───────────────────────────────────────────────────────
    def test_superuser_and_supervisor_unrestricted(self):
        self.assertIsNone(accessible_project_ids(self.boss))
        self.assertIsNone(accessible_project_ids(self.sup))  # itsm.projects:update

    def test_member_with_no_grant_sees_nothing(self):
        # Strict whitelist: a member helpdesk with zero ProjectMembership ⇒ no projects.
        self.assertEqual(accessible_project_ids(self.agent), [])

    def test_member_sees_only_assigned_project(self):
        ProjectMembership.objects.create(project=self.itinc, user=self.agent)
        self.assertEqual(accessible_project_ids(self.agent), [self.itinc.id])

    def test_helpdesk_lead_sees_all_helpdesk_projects(self):
        HelpdeskMembership.objects.filter(helpdesk_id=self.hd_it, user=self.agent).update(
            role_in_helpdesk="lead"
        )
        self.assertEqual(
            set(accessible_project_ids(self.agent)), {self.itinc.id, self.itreq.id}
        )

    def test_project_lead_override(self):
        # A member of IT with no grant, but lead of ITREQ → still sees ITREQ.
        self.itreq.lead = self.agent
        self.itreq.save(update_fields=["lead"])
        self.assertEqual(accessible_project_ids(self.agent), [self.itreq.id])

    # ── tab/list scoping + ticket hard boundary ──────────────────────────────
    def test_project_list_scoped_to_assignment(self):
        ProjectMembership.objects.create(project=self.itinc, user=self.agent)
        client = APIClient()
        client.force_authenticate(self.agent)
        keys = {p["key"] for p in client.get(reverse("itsm-project-list")).json()["results"]}
        self.assertIn(self.itinc.key, keys)
        self.assertNotIn(self.itreq.key, keys)

    def test_manager_without_membership_sees_all_projects(self):
        # Regression for the reported bug: a project-admin (holds itsm.projects:update)
        # with NO HelpdeskMembership must still see every project. Before the manager
        # bypass the helpdesk clamp resolved to [] and hid all projects — even assigned
        # ones. self.sup is a supervisor (full-CRUD seed) with no membership.
        client = APIClient()
        client.force_authenticate(self.sup)
        keys = {p["key"] for p in client.get(reverse("itsm-project-list")).json()["results"]}
        self.assertEqual(keys, {p.key for p in Project.objects.filter(is_deleted=False)})
        self.assertIn(self.itinc.key, keys)
        self.assertIn(self.itreq.key, keys)

    def test_manager_helpdesk_param_narrows(self):
        # A manager still honours the advisory ?helpdesk= view-scope for ANY helpdesk,
        # with no membership required — the param never widens beyond it.
        client = APIClient()
        client.force_authenticate(self.sup)
        projects = client.get(
            reverse("itsm-project-list"), {"helpdesk": self.hd_it}
        ).json()["results"]
        self.assertTrue(projects)
        self.assertTrue(all(p["helpdesk_key"] == "IT" for p in projects))
        self.assertIn(self.itinc.key, {p["key"] for p in projects})

    def test_readonly_supervisor_scoped_to_assignment(self):
        # Model B: a supervisor whose itsm.projects grant is READ-ONLY is a non-manager
        # and is scoped to explicitly-assigned projects (needs helpdesk + project
        # membership). Closest-ancestor-wins ⇒ the update=False row overrides itsm.
        RoleModulePermission.objects.filter(
            role__code="supervisor", module__code="itsm.projects"
        ).update(can_read=True, can_create=False, can_update=False, can_delete=False)
        cache.clear()
        HelpdeskMembership.objects.create(helpdesk_id=self.hd_it, user=self.sup, is_active=True)
        ProjectMembership.objects.create(project=self.itinc, user=self.sup)
        client = APIClient()
        client.force_authenticate(self.sup)
        keys = {p["key"] for p in client.get(reverse("itsm-project-list")).json()["results"]}
        self.assertIn(self.itinc.key, keys)
        self.assertNotIn(self.itreq.key, keys)

    def test_ticket_hard_boundary(self):
        ProjectMembership.objects.create(project=self.itinc, user=self.agent)
        mine = ticket_service.create_ticket(
            project=self.itinc, ticket_type=self.itinc.ticket_types.first(),
            summary="mine", priority="p3", apply_routing=False,
        )
        foreign = ticket_service.create_ticket(
            project=self.itreq, ticket_type=self.itreq.ticket_types.first(),
            summary="foreign", priority="p3", apply_routing=False,
        )
        client = APIClient()
        client.force_authenticate(self.agent)
        ids = {t["id"] for t in client.get(reverse("itsm-ticket-list")).json()["results"]}
        self.assertIn(str(mine.id), ids)
        self.assertNotIn(str(foreign.id), ids)
        # The unassigned project's ticket is 404 by id, too.
        self.assertEqual(
            client.get(reverse("itsm-ticket-detail", args=[foreign.ticket_number])).status_code,
            404,
        )

    # ── assignment guards ────────────────────────────────────────────────────
    def test_add_member_rejects_requestor(self):
        req = User.objects.create_user(username="req", password="x")
        RoleAssignment.objects.create(user=req, role=SystemRole.objects.get(code="requestor"))
        client = APIClient()
        client.force_authenticate(self.sup)
        resp = client.post(
            reverse("itsm-project-add-member", args=[self.itinc.id]),
            {"user": req.id}, format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_create_user_rejects_project_without_its_helpdesk(self):
        client = APIClient()
        client.force_authenticate(self.boss)
        resp = client.post(
            reverse("itsm-member-create-user"),
            {"username": "newbie", "role_code": "agent",
             "helpdesks": [],  # ITINC's helpdesk NOT requested
             "projects": [{"id": str(self.itinc.id)}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class PriorityMatrixSerializerTests(TestCase):
    """ITIL priority-matrix validation: drop bad codes, merge over the default."""

    def test_validate_priority_matrix_merges_and_drops_bad(self):
        from .models import default_priority_matrix
        from .serializers import ProjectWriteSerializer

        out = ProjectWriteSerializer().validate_priority_matrix({
            "high": {"high": "p4"},             # valid override
            "bogus": {"x": "y"},                # unknown impact → dropped
            "low": {"high": "p1", "zz": "nope"},  # one valid, one bad urgency
            "medium": {"medium": "banana"},     # bad priority → ignored
        })
        self.assertEqual(out["high"]["high"], "p4")         # overridden
        self.assertEqual(out["low"]["high"], "p1")          # overridden
        self.assertNotIn("bogus", out)                       # dropped
        # untouched cells fall back to the standard default
        default = default_priority_matrix()
        self.assertEqual(out["medium"]["medium"], default["medium"]["medium"])
        self.assertEqual(out["high"]["medium"], default["high"]["medium"])


class StandardProjectImportTests(TestCase):
    """The standard-project catalog + per-helpdesk import: the full provisioning
    chain (project, types, layout, notification scheme, survey, no-SLA policy,
    membership grants), the friendly rejections, the API surface, and the
    portal exclusion of Problem projects."""

    def setUp(self):
        cache.clear()
        _seed()
        from apps.itsm_helpdesks.models import Helpdesk

        self.it = Helpdesk.objects.get(key="IT")
        self.boss = User.objects.create_superuser(username="boss", password="x", email="b@b.io")
        # A helpdesk-member agent (sees the imported project's tab via membership).
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk=self.it, user=self.agent, is_active=True)
        # A supervisor who is an IT member (import needs helpdesk access + create).
        self.sup = User.objects.create_user(username="su", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        HelpdeskMembership.objects.create(helpdesk=self.it, user=self.sup, is_active=True)

    def _import(self, template="problem", helpdesk=None):
        from .standard_projects import import_standard_project

        return import_standard_project(helpdesk or self.it, template, user=self.boss)

    # ── service: full provisioning chain ─────────────────────────────────────
    def test_import_problem_provisions_everything(self):
        from apps.itsm_core.models import FieldLayout, FieldLayoutItem
        from apps.itsm_notifications.models import NotificationScheme
        from apps.itsm_sla.models import SLAPolicy
        from apps.itsm_surveys.models import SurveyConfig

        project = self._import()
        self.assertEqual(project.key, "ITPRB")
        self.assertEqual(project.project_type, "problem")
        self.assertEqual(project.default_workflow.base_type, "problem")
        self.assertIsNotNone(project.default_group_id)  # IT service desk
        # Default ticket type
        tt = project.ticket_types.get(key="problem")
        self.assertTrue(tt.is_default)
        self.assertEqual(tt.base_category, "problem")
        # Layout with the Problem sections (root_cause + workaround placed)
        layout = FieldLayout.objects.get(project=project, ticket_type__isnull=True)
        sections = set(
            FieldLayoutItem.objects.filter(layout=layout).values_list("section", flat=True)
        )
        self.assertIn("Problem Assessment", sections)
        self.assertIn("Root Cause & Workaround", sections)
        keys = set(
            FieldLayoutItem.objects.filter(layout=layout)
            .values_list("field__key", flat=True)
        )
        self.assertIn("workaround_notes", keys)
        self.assertIn("investigation_reason", keys)
        self.assertNotIn("major_incident", keys)  # incident-only stays off
        # Engine config clones
        self.assertTrue(NotificationScheme.objects.filter(project=project).exists())
        self.assertTrue(SurveyConfig.objects.filter(project=project).exists())
        # No-SLA default policy: project-scoped, active, with zero metrics —
        # and NOT flagged is_default (a second default would hijack
        # resolve_policy's tenant-wide fallback for every other project).
        policy = SLAPolicy.objects.get(project=project)
        self.assertTrue(policy.is_active)
        self.assertFalse(policy.is_default)
        self.assertEqual(policy.metrics.count(), 0)
        # Ticket-template parity with the seeded chain.
        from apps.itsm_tickets.models import TicketTemplate
        self.assertTrue(
            TicketTemplate.objects.filter(
                project=project, name="Recurring Incident Investigation"
            ).exists()
        )
        # Membership parity: helpdesk members got ProjectMembership rows
        self.assertTrue(
            ProjectMembership.objects.filter(project=project, user=self.agent,
                                             is_active=True).exists()
        )

    def test_problem_ticket_starts_no_sla_clocks(self):
        # Seed the tenant-default SLA policy first — the point is that the
        # project-scoped empty policy WINS over it (else incident clocks start).
        from apps.itsm_sla.models import SLATracker
        from apps.itsm_sla.seed import run as seed_sla

        seed_sla()
        project = self._import()
        with self.captureOnCommitCallbacks(execute=True):
            ticket = ticket_service.create_ticket(
                project=project, ticket_type=project.ticket_types.get(key="problem"),
                summary="Recurring VPN drops", user=self.boss, apply_routing=False,
            )
        self.assertEqual(SLATracker.objects.filter(ticket=ticket).count(), 0)
        # Control: an Incident ticket in the same helpdesk DOES start clocks.
        inc = Project.objects.get(helpdesk=self.it, project_type="incident")
        with self.captureOnCommitCallbacks(execute=True):
            inc_ticket = ticket_service.create_ticket(
                project=inc, ticket_type=inc.ticket_types.get(key="incident"),
                summary="Outage", user=self.boss, apply_routing=False,
            )
        self.assertGreater(SLATracker.objects.filter(ticket=inc_ticket).count(), 0)

    def test_import_incident_into_fresh_helpdesk(self):
        # A UI-created helpdesk starts empty; the catalog provisions Incident too.
        from apps.itsm_helpdesks.models import Helpdesk

        fac = Helpdesk.objects.create(name="Facility Ops", key="FO", status="active")
        project = self._import(template="incident", helpdesk=fac)
        self.assertEqual(project.key, "FOINC")
        self.assertEqual(project.project_type, "incident")
        self.assertTrue(project.ticket_types.filter(key="incident", is_default=True).exists())

    # ── service: friendly rejections ─────────────────────────────────────────
    def test_import_twice_rejected(self):
        self._import()
        with self.assertRaisesMessage(ValueError, "already has a Problem Management"):
            self._import()

    def test_import_unknown_template_rejected(self):
        with self.assertRaisesMessage(ValueError, "Unknown standard project template"):
            self._import(template="change")

    def test_import_inactive_helpdesk_rejected(self):
        self.it.status = "inactive"
        self.it.save(update_fields=["status"])
        with self.assertRaisesMessage(ValueError, "active helpdesk"):
            self._import()

    def test_import_taken_key_rejected(self):
        Project.objects.create(
            helpdesk=self.it, name="Squatter", key="ITPRB", project_type="custom"
        )
        with self.assertRaisesMessage(ValueError, "already in use"):
            self._import()

    def test_reimport_restores_soft_deleted_standard_project(self):
        # Soft delete keeps the row (key stays taken) — an explicit re-import
        # restores the SAME project instead of dead-ending on the key check.
        project = self._import()
        project.soft_delete(user=self.boss)
        self.assertFalse(Project.objects.filter(pk=project.pk).exists())
        restored = self._import()
        self.assertEqual(restored.pk, project.pk)
        self.assertFalse(restored.is_deleted)
        self.assertEqual(restored.status, "active")

    def test_seed_skips_soft_deleted_standard_project(self):
        # Re-running the tenant seed must neither crash (IntegrityError on the
        # unconditional key uniqueness) nor resurrect a deliberately deleted
        # standard project.
        inc = Project.objects.get(helpdesk=self.it, project_type="incident")
        inc.soft_delete(user=self.boss)
        seed_projects()  # would raise IntegrityError before the all_objects fix
        inc.refresh_from_db()
        self.assertTrue(inc.is_deleted)  # not resurrected

    def test_portal_read_path_excludes_problem_tickets(self):
        # An agent can set an end user as requestor on a problem ticket; the
        # portal "My requests" surface must still never show it.
        project = self._import()
        enduser = User.objects.create_user(username="reqx", password="x")
        RoleAssignment.objects.create(
            user=enduser, role=SystemRole.objects.get(code="requestor"))
        with self.captureOnCommitCallbacks(execute=True):
            ticket = ticket_service.create_ticket(
                project=project, ticket_type=project.ticket_types.get(key="problem"),
                summary="Internal RCA", requestor=enduser, user=self.boss,
                apply_routing=False,
            )
        client = APIClient()
        client.force_authenticate(enduser)
        listing = client.get(reverse("itsm-portal-request-list"))
        self.assertEqual(listing.status_code, 200, listing.content)
        body = listing.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertNotIn(ticket.ticket_number, {t["ticket_number"] for t in rows})
        detail = client.get(
            reverse("itsm-portal-request-detail", args=[ticket.ticket_number]))
        self.assertEqual(detail.status_code, 404, detail.content)

    # ── API surface ──────────────────────────────────────────────────────────
    def test_templates_endpoint_lists_install_state(self):
        client = APIClient()
        client.force_authenticate(self.sup)
        url = reverse("itsm-project-standard-templates")
        rows = {r["template"]: r for r in client.get(url, {"helpdesk": "IT"}).json()}
        self.assertEqual(set(rows), {"incident", "service_request", "problem"})
        self.assertTrue(rows["incident"]["installed"])       # seeded
        self.assertFalse(rows["problem"]["installed"])
        self.assertEqual(rows["problem"]["key"], "ITPRB")
        # After import it flips
        self._import()
        rows = {r["template"]: r for r in client.get(url, {"helpdesk": "IT"}).json()}
        self.assertTrue(rows["problem"]["installed"])
        self.assertEqual(rows["problem"]["installed_project_key"], "ITPRB")

    def test_import_endpoint_supervisor_201(self):
        client = APIClient()
        client.force_authenticate(self.sup)
        resp = client.post(
            reverse("itsm-project-import-standard"),
            {"helpdesk": "IT", "template": "problem"}, format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["key"], "ITPRB")
        # Second import → friendly 400, not a 500
        resp = client.post(
            reverse("itsm-project-import-standard"),
            {"helpdesk": "IT", "template": "problem"}, format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_import_endpoint_agent_403(self):
        client = APIClient()
        client.force_authenticate(self.agent)  # itsm.projects is read-only for agents
        resp = client.post(
            reverse("itsm-project-import-standard"),
            {"helpdesk": "IT", "template": "problem"}, format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(Project.objects.filter(key="ITPRB").exists())

    def test_import_endpoint_foreign_helpdesk_404(self):
        # A supervisor who is NOT a member of HR cannot import into it — and the
        # response is indistinguishable from a nonexistent helpdesk (no oracle).
        client = APIClient()
        client.force_authenticate(self.sup)
        resp = client.post(
            reverse("itsm-project-import-standard"),
            {"helpdesk": "HR", "template": "problem"}, format="json",
        )
        self.assertEqual(resp.status_code, 404, resp.content)
        self.assertFalse(Project.objects.filter(key="HRPRB").exists())

    def test_import_endpoint_unknown_helpdesk_404(self):
        client = APIClient()
        client.force_authenticate(self.boss)
        resp = client.post(
            reverse("itsm-project-import-standard"),
            {"helpdesk": "NOPE", "template": "problem"}, format="json",
        )
        self.assertEqual(resp.status_code, 404, resp.content)

    # ── serializer: standard types only via the import choke-point ───────────
    def test_plain_project_write_rejects_standard_types(self):
        # A bare POST/PATCH with a standard project_type bypasses the import's
        # provisioning chain (workflow, no-SLA policy, memberships) → 400.
        client = APIClient()
        client.force_authenticate(self.boss)
        resp = client.post(
            reverse("itsm-project-list"),
            {"helpdesk": str(self.it.id), "name": "Another Incident",
             "key": "ITX", "project_type": "incident"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("project_type", resp.json())
        # Retyping an existing custom project to problem is equally rejected…
        custom = Project.objects.create(
            helpdesk=self.it, name="Ops", key="ITOPS", project_type="custom"
        )
        resp = client.patch(
            reverse("itsm-project-detail", args=[custom.id]),
            {"project_type": "problem"}, format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        # …while CUSTOM creation and same-type PATCHes stay allowed.
        ok = client.post(
            reverse("itsm-project-list"),
            {"helpdesk": str(self.it.id), "name": "Second custom",
             "key": "ITX2", "project_type": "custom"},
            format="json",
        )
        self.assertEqual(ok.status_code, 201, ok.content)
        inc = Project.objects.get(helpdesk=self.it, project_type="incident")
        ok = client.patch(
            reverse("itsm-project-detail", args=[inc.id]),
            {"name": "IT Incidents", "project_type": "incident"}, format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)

    # ── portal exclusion ─────────────────────────────────────────────────────
    def test_portal_never_lists_problem_projects(self):
        project = self._import()
        requestor = User.objects.create_user(username="enduser", password="x")
        RoleAssignment.objects.create(
            user=requestor, role=SystemRole.objects.get(code="requestor"))
        client = APIClient()
        client.force_authenticate(requestor)
        resp = client.get(
            reverse("itsm-portal-intake-projects"), {"helpdesk": "IT"}
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        listed = {p["id"] for p in resp.json()}
        self.assertNotIn(str(project.id), listed)
        # The seeded Incident project IS create-eligible (control).
        inc = Project.objects.get(helpdesk=self.it, project_type="incident")
        self.assertIn(str(inc.id), listed)
