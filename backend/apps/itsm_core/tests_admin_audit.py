"""Admin & security audit log (G8): capture, redaction, auth events, viewer gating, export."""

import csv
import importlib
import io
import json
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_core.models import AuditEvent
from apps.itsm_core.models.audit import AdminAuditEvent
from apps.itsm_core.services import audit
from apps.itsm_rbac.models import Module, RoleAssignment, RoleModulePermission, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import check_permission, invalidate_permission_cache
from apps.itsm_sla.models import BusinessCalendar

User = get_user_model()
API = "/api/v1/itsm"


def _user(username, role_code=None, **kw):
    user = User.objects.create_user(username=username, password="Passw0rd!x", **kw)
    if role_code:
        RoleAssignment.objects.create(user=user, role=SystemRole.objects.get(code=role_code))
    return user


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def _dump(ev) -> str:
    return json.dumps(
        [ev.actor_label, ev.object_repr, ev.changes, ev.extra, ev.user_agent], default=str
    )


class _Base(TestCase):
    def setUp(self):
        seed_rbac()
        invalidate_permission_cache()
        self.admin = _user("adm", "admin")
        self.client_admin = _client(self.admin)


class ConfigChangeCaptureTests(_Base):
    def test_update_logged_with_diff_actor_ip_and_user_agent(self):
        cal = BusinessCalendar.objects.create(name="Standard", timezone="UTC")
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client_admin.patch(
                f"{API}/business-calendars/{cal.id}/", {"name": "Standard 2"}, format="json",
                HTTP_X_FORWARDED_FOR="198.51.100.7, 203.0.113.9, 10.0.0.2",
                HTTP_USER_AGENT="audit-test-agent",
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        ev = AdminAuditEvent.objects.get()
        self.assertEqual(ev.action, "update")
        self.assertEqual(ev.area, "itsm.sla.calendars")
        self.assertEqual(ev.actor, self.admin)
        self.assertEqual(ev.actor_label, "adm")
        self.assertEqual(ev.object_id, str(cal.id))
        self.assertEqual(ev.object_repr, "Standard 2")
        # Two trusted proxies: the client is the entry the first proxy appended.
        self.assertEqual(ev.ip_address, "203.0.113.9")
        self.assertEqual(ev.user_agent, "audit-test-agent")
        self.assertIn({"field": "name", "label": "Name", "old": "Standard", "new": "Standard 2"}, ev.changes)

    def test_create_and_delete_logged(self):
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client_admin.post(
                f"{API}/business-calendars/", {"name": "Night shift", "timezone": "UTC"}, format="json"
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        created = AdminAuditEvent.objects.get(action="create")
        self.assertEqual(created.object_repr, "Night shift")
        self.assertTrue(any(c["field"] == "name" and c["new"] == "Night shift" for c in created.changes))
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client_admin.delete(f"{API}/business-calendars/{resp.json()['id']}/")
        self.assertEqual(resp.status_code, 204)
        deleted = AdminAuditEvent.objects.get(action="delete")
        self.assertTrue(any(c["field"] == "name" and c["old"] == "Night shift" for c in deleted.changes))

    def test_noop_and_rejected_writes_not_logged(self):
        cal = BusinessCalendar.objects.create(name="Standard", timezone="UTC")
        with self.captureOnCommitCallbacks(execute=True):
            same = self.client_admin.patch(
                f"{API}/business-calendars/{cal.id}/", {"name": "Standard"}, format="json"
            )
            bad = self.client_admin.patch(
                f"{API}/business-calendars/{cal.id}/", {"name": ""}, format="json"
            )
        self.assertEqual(same.status_code, 200)
        self.assertEqual(bad.status_code, 400)
        self.assertFalse(AdminAuditEvent.objects.exists())

    def test_audit_failure_never_breaks_the_request(self):
        cal = BusinessCalendar.objects.create(name="Standard", timezone="UTC")
        with mock.patch.object(AdminAuditEvent.objects, "create", side_effect=RuntimeError("boom")):
            with self.captureOnCommitCallbacks(execute=True):
                resp = self.client_admin.patch(
                    f"{API}/business-calendars/{cal.id}/", {"name": "X"}, format="json"
                )
        self.assertEqual(resp.status_code, 200)
        cal.refresh_from_db()
        self.assertEqual(cal.name, "X")

    def test_secret_is_redacted(self):
        secret = "S3cr3t-Value-0123456789!"
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client_admin.put(
                f"{API}/admin/sso-config/",
                {"microsoft_client_id": "client-abc", "microsoft_client_secret": secret},
                format="json",
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        ev = AdminAuditEvent.objects.get(area="itsm.admin.sso")
        row = next(c for c in ev.changes if c["field"] == "microsoft_client_secret_enc")
        self.assertTrue(row.get("redacted"))
        self.assertEqual(row["new"], audit.REDACTED)
        self.assertNotIn(secret, _dump(ev))
        self.assertTrue(any(c["field"] == "microsoft_client_id" and c["new"] == "client-abc" for c in ev.changes))


class AccessChangeTests(_Base):
    def test_role_permission_bulk_edit_logged_per_module(self):
        role = SystemRole.objects.create(code="custom-x", name="Custom X")
        mod = Module.objects.get(code="itsm.sla.policies")
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client_admin.put(
                f"{API}/roles/{role.id}/permissions/",
                [{"module": str(mod.id), "can_read": True, "can_create": True,
                  "can_update": False, "can_delete": False}],
                format="json",
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        ev = AdminAuditEvent.objects.get(action="permissions_changed")
        self.assertEqual(ev.area, "itsm.admin.roles")
        row = next(c for c in ev.changes if c["field"] == "permissions.itsm.sla.policies")
        self.assertEqual(row["old"], "(inherited)")
        self.assertEqual(row["new"], "read, create")

    def test_member_role_active_and_password_reset_logged(self):
        target = _user("bob", "agent")
        with self.captureOnCommitCallbacks(execute=True):
            r1 = self.client_admin.post(f"{API}/members/{target.pk}/set_role/", {"role_code": "supervisor"}, format="json")
            r2 = self.client_admin.post(f"{API}/members/{target.pk}/set_active/", {"is_active": False}, format="json")
            r3 = self.client_admin.post(f"{API}/members/{target.pk}/reset_password/", {}, format="json")
        for r in (r1, r2, r3):
            self.assertEqual(r.status_code, 200, r.content)
        role_ev = AdminAuditEvent.objects.get(action="role_changed")
        row = next(c for c in role_ev.changes if c["field"] == "itsm_role")
        self.assertEqual((row["old"], row["new"]), ("Agent (agent)", "Supervisor (supervisor)"))
        self.assertEqual(role_ev.object_id, str(target.pk))
        self.assertTrue(AdminAuditEvent.objects.filter(action="user_deactivated").exists())
        reset = AdminAuditEvent.objects.get(action="password_reset")
        self.assertNotIn(r3.json()["temp_password"], _dump(reset))
        self.assertTrue(any(c["field"] == "password" and c.get("redacted") for c in reset.changes))


class AuthEventTests(_Base):
    def setUp(self):
        super().setUp()
        self.jo = User.objects.create_user(username="jo", password="Corr3ct-pass!", email="jo@example.io")

    def test_failed_login_logged_without_password(self):
        resp = APIClient().post(
            f"{API}/auth/login/", {"username": "JO", "password": "wr0ng-PASSWORD-xyz"}, format="json",
            REMOTE_ADDR="192.0.2.44", HTTP_USER_AGENT="brute/1.0",
        )
        self.assertEqual(resp.status_code, 401)
        ev = AdminAuditEvent.objects.get(action="login_failed")
        self.assertIsNone(ev.actor)
        self.assertEqual(ev.actor_label, "JO")
        self.assertEqual(ev.area, "auth")
        self.assertEqual(ev.object_id, str(self.jo.pk))  # matched case-insensitively
        self.assertEqual(ev.ip_address, "192.0.2.44")
        self.assertEqual(ev.user_agent, "brute/1.0")
        self.assertTrue(ev.extra.get("reason"))
        self.assertNotIn("wr0ng-PASSWORD-xyz", _dump(ev))

    def test_unknown_user_failed_login_logged(self):
        APIClient().post(f"{API}/auth/login/", {"username": "ghost", "password": "x"}, format="json")
        ev = AdminAuditEvent.objects.get(action="login_failed")
        self.assertEqual((ev.actor_label, ev.object_id), ("ghost", ""))

    def test_successful_login_logged(self):
        resp = APIClient().post(
            f"{API}/auth/login/", {"username": "jo", "password": "Corr3ct-pass!"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        ev = AdminAuditEvent.objects.get(action="login")
        self.assertEqual(ev.actor, self.jo)
        self.assertEqual(ev.extra.get("method"), "password")
        self.assertNotIn(resp.json()["access"], _dump(ev))

    def test_password_change_success_and_failure(self):
        c = _client(self.jo)
        c.post(f"{API}/auth/change-password/", {"current_password": "nope", "new_password": "Brand-new-456"}, format="json")
        c.post(f"{API}/auth/change-password/", {"current_password": "Corr3ct-pass!", "new_password": "Brand-new-456"}, format="json")
        failed = AdminAuditEvent.objects.get(action="password_change_failed")
        self.assertIn("current_password", failed.extra["reason"])
        self.assertNotIn("Brand-new-456", _dump(failed))
        ok = AdminAuditEvent.objects.get(action="password_changed")
        self.assertEqual(ok.actor, self.jo)

    def test_log_admin_event_helper(self):
        audit.log_admin_event(None, "password_reset_requested", obj=self.jo, actor=False,
                              actor_label="jo@example.io", extra={"token": "abc", "channel": "email"})
        ev = AdminAuditEvent.objects.get(action="password_reset_requested")
        self.assertEqual(ev.extra, {"token": audit.REDACTED, "channel": "email"})
        self.assertIsNone(ev.actor)


class TicketTrafficNotDuplicatedTests(TestCase):
    def test_ticket_and_comment_writes_skip_admin_log(self):
        from apps.itsm_groups.seed import run as seed_groups
        from apps.itsm_helpdesks.seed import run as seed_helpdesks
        from apps.itsm_projects.models import Project
        from apps.itsm_projects.seed import run as seed_projects
        from apps.itsm_tickets.services import ticket_service
        from apps.itsm_workflows.seed import run as seed_workflows

        seed_rbac()
        seed_helpdesks()
        seed_workflows()
        seed_groups()
        seed_projects()
        su = User.objects.create_superuser(username="root", password="x", email="r@x.io")
        inc = Project.objects.filter(project_type="incident").first()
        with self.captureOnCommitCallbacks(execute=True):
            ticket = ticket_service.create_ticket(
                project=inc, ticket_type=inc.ticket_types.first(), summary="Printer", priority="p3", user=su,
            )
        before = AuditEvent.objects.filter(ticket=ticket).count()
        c = _client(su)
        with self.captureOnCommitCallbacks(execute=True):
            r1 = c.patch(f"{API}/tickets/{ticket.id}/", {"summary": "Printer on fire"}, format="json")
            r2 = c.post(f"{API}/tickets/{ticket.id}/comments/", {"body_html": "<p>On it</p>"}, format="json")
        self.assertIn(r1.status_code, (200, 202), r1.content)
        self.assertEqual(r2.status_code, 201, r2.content)
        self.assertGreater(AuditEvent.objects.filter(ticket=ticket).count(), before)
        self.assertFalse(AdminAuditEvent.objects.exists())


class ViewerTests(_Base):
    def setUp(self):
        super().setUp()
        audit.record_event(None, area="auth", action="login_failed", actor=False,
                           actor_label="=HYPERLINK(\"x\")", defer=False)
        audit.record_event(None, area="itsm.sla.calendars", action="update", actor=self.admin,
                           object_type="business calendar", object_repr="Standard",
                           changes=[{"field": "name", "label": "Name", "old": "A", "new": "B"}],
                           defer=False)

    def test_permission_gating(self):
        agent, sup = _user("ag", "agent"), _user("sup", "supervisor")
        root = User.objects.create_superuser(username="root", password="x", email="r@x.io")
        for user, code in ((agent, 403), (sup, 403), (self.admin, 200), (root, 200)):
            c = _client(user)
            self.assertEqual(c.get(f"{API}/audit-events/").status_code, code, user.username)
            self.assertEqual(c.get(f"{API}/audit-events/export/").status_code, code, user.username)
        self.assertEqual(APIClient().get(f"{API}/audit-events/").status_code, 401)

    def test_seed_grants_admin_only(self):
        sup = _user("sup", "supervisor")
        self.assertTrue(check_permission(self.admin, "itsm.admin.audit", "read"))
        self.assertFalse(check_permission(sup, "itsm.admin.audit", "read"))
        self.assertTrue(check_permission(sup, "itsm.admin.roles", "read"))  # unaffected

    def test_filters_and_facets(self):
        c = self.client_admin
        data = c.get(f"{API}/audit-events/", {"area": "itsm.sla.calendars"}).json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["area_label"], "Business calendars")
        self.assertEqual(data["results"][0]["actor_name"], "adm")
        self.assertEqual(c.get(f"{API}/audit-events/", {"action": "login_failed"}).json()["count"], 1)
        self.assertEqual(c.get(f"{API}/audit-events/", {"q": "stand"}).json()["count"], 1)
        self.assertEqual(c.get(f"{API}/audit-events/", {"actor": str(self.admin.pk)}).json()["count"], 1)
        self.assertEqual(c.get(f"{API}/audit-events/", {"date_from": "2999-01-01"}).json()["count"], 0)
        self.assertEqual(c.get(f"{API}/audit-events/", {"date_to": "not-a-date"}).status_code, 400)
        facets = c.get(f"{API}/audit-events/facets/").json()
        self.assertEqual(facets["export_max_rows"], audit.EXPORT_MAX_ROWS)
        self.assertIn({"value": str(self.admin.pk), "label": "adm"}, facets["actors"])

    def test_csv_export_escapes_formulas_caps_and_logs_itself(self):
        resp = self.client_admin.get(f"{API}/audit-events/export/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp["Content-Type"].startswith("text/csv"))
        rows = list(csv.reader(io.StringIO(resp.content.decode())))
        self.assertEqual(rows[0][0], "Time (UTC)")
        self.assertEqual(len(rows), 3)
        self.assertIn("'=HYPERLINK(\"x\")", [r[1] for r in rows[1:]])
        self.assertIn("Name: A → B", [r[7] for r in rows[1:]])
        self.assertEqual(resp["X-Audit-Export-Truncated"], "0")
        exported = AdminAuditEvent.objects.get(action="exported")
        self.assertEqual(exported.extra["rows"], 2)
        with mock.patch.object(audit, "EXPORT_MAX_ROWS", 1):
            capped = self.client_admin.get(f"{API}/audit-events/export/")
        self.assertEqual(len(list(csv.reader(io.StringIO(capped.content.decode())))), 2)
        self.assertEqual(capped["X-Audit-Export-Truncated"], "1")


class AuditModuleMigrationTests(TestCase):
    def test_data_migration_idempotent_and_supervisor_denied(self):
        seed_rbac()
        Module.objects.filter(code="itsm.admin.audit").delete()
        mig = importlib.import_module("apps.itsm_core.migrations.0016_audit_module")
        mig.seed_audit_module(django_apps, None)
        mig.seed_audit_module(django_apps, None)
        module = Module.objects.get(code="itsm.admin.audit")
        self.assertEqual(module.parent.code, "itsm.admin")
        self.assertEqual(module.category, "administration")
        rows = {p.role.code: p for p in RoleModulePermission.objects.filter(module=module).select_related("role")}
        self.assertEqual(set(rows), {"admin", "supervisor", "agent", "requestor"})
        self.assertTrue(rows["admin"].can_read)
        self.assertFalse(rows["supervisor"].can_read)


class ConsoleUserAuditTests(_Base):
    """The platform console's org-user actions land in that org's log (actor none)."""

    def setUp(self):
        super().setUp()
        from apps.tenants.models import Client

        # Test mode flattens every schema into `public`; bulk_create skips schema creation.
        Client.objects.bulk_create([Client(schema_name="public", name="Test org")])
        self.operator = User.objects.create_superuser(username="platform-op", password="x", email="p@x.io")
        self.bob = _user("bob", "agent")

    def test_console_deactivate_and_password_reset_logged(self):
        c = _client(self.operator)
        r1 = c.patch("/api/v1/admin/orgs/public/users/bob/", {"is_active": False}, format="json")
        r2 = c.post("/api/v1/admin/orgs/public/reset-admin-password/",
                    {"username": "bob", "new_password": "Console-Reset-99"}, format="json")
        self.assertEqual(r1.status_code, 200, r1.content)
        self.assertEqual(r2.status_code, 200, r2.content)
        deact = AdminAuditEvent.objects.get(action="user_deactivated")
        self.assertIsNone(deact.actor)
        self.assertEqual(deact.actor_label, "Platform admin: platform-op")
        self.assertEqual(deact.extra, {"via": "platform_console"})
        self.assertEqual(deact.object_id, str(self.bob.pk))
        reset = AdminAuditEvent.objects.get(action="password_reset")
        self.assertNotIn("Console-Reset-99", _dump(reset))
