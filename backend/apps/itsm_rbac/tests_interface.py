"""Interface: Classic / Modern (2026-11-05, Modern B2).

Org policy (`TenantInterfaceConfig`, `admin/interface/` + public `auth/interface/`),
the per-user choice (`User.ui_preference`, `auth/preferences/`, echoed on
`/auth/me/`), the `itsm.admin.interface` module grants and its seed migration."""

import datetime
import importlib

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.itsm_core.models.audit import AdminAuditEvent

from .models import Module, RoleAssignment, RoleModulePermission, SystemRole, TenantInterfaceConfig
from .registry import seed_rbac
from .services import check_permission, invalidate_permission_cache

User = get_user_model()
API = "/api/v1/itsm"
PUBLIC = f"{API}/auth/interface/"
ADMIN = f"{API}/admin/interface/"
PREFS = f"{API}/auth/preferences/"
ME = f"{API}/auth/me/"
MIGRATION = importlib.import_module("apps.itsm_rbac.migrations.0017_seed_interface_module")


def _client(user=None):
    c = APIClient()
    if user is not None:
        c.force_authenticate(user)
    return c


def _days(n: int) -> str:
    return (timezone.localdate() + datetime.timedelta(days=n)).isoformat()


class _Base(TestCase):
    def setUp(self):
        seed_rbac()
        invalidate_permission_cache()
        self.sup = User.objects.create_user(username="sup", password="x", full_name="Sue Pervisor")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.agent = User.objects.create_user(username="agent", password="x", full_name="Ann Agent")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))

    def put(self, body, user=None):
        with self.captureOnCommitCallbacks(execute=True):
            return _client(user or self.sup).put(ADMIN, body, format="json")


class InterfacePolicyTests(_Base):
    def test_public_defaults_without_a_row(self):
        resp = _client().get(PUBLIC)
        self.assertEqual(resp.status_code, 200, resp.content)
        # Modern is the default since 2026-11-05c (it was Classic when Modern shipped).
        self.assertEqual(resp.json(), {
            "ui_default": "modern", "ui_allow_switch": True,
            "ui_classic_retire_on": None, "classic_retired": False,
        })

    def test_admin_get_never_writes(self):
        resp = _client(self.sup).get(ADMIN)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["ui_default"], "modern")
        self.assertFalse(TenantInterfaceConfig.objects.exists())

    def test_supervisor_upserts_one_row_and_is_audited(self):
        # Classic first: saving the default value (Modern) would be a no-op diff,
        # which the audit mixin skips.
        resp = self.put({"ui_default": "classic"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["ui_default"], "classic")
        resp = self.put({"ui_allow_switch": False})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(TenantInterfaceConfig.objects.count(), 1)
        row = TenantInterfaceConfig.current()
        self.assertEqual((row.ui_default, row.ui_allow_switch), ("classic", False))
        # Like Branding, the singleton row is created empty first, so both saves are
        # recorded as updates carrying the field diff.
        events = list(AdminAuditEvent.objects.filter(area="itsm.admin.interface").order_by("created_at"))
        self.assertEqual([e.action for e in events], ["update", "update"])
        self.assertTrue(any(c["field"] == "ui_default" and c["new"] == "classic" for c in events[0].changes))
        self.assertTrue(any(c["field"] == "ui_allow_switch" for c in events[1].changes))

    def test_agent_and_anonymous_cannot_write(self):
        self.assertEqual(self.put({"ui_default": "modern"}, user=self.agent).status_code, 403)
        self.assertEqual(_client().put(ADMIN, {"ui_default": "modern"}, format="json").status_code, 401)
        self.assertEqual(_client(self.agent).get(ADMIN).status_code, 403)
        self.assertFalse(TenantInterfaceConfig.objects.exists())

    def test_invalid_default_rejected(self):
        resp = self.put({"ui_default": "retro"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("ui_default", resp.json())

    def test_classic_default_with_past_retire_date_rejected(self):
        resp = self.put({"ui_default": "classic", "ui_classic_retire_on": _days(-1)})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("ui_default", resp.json())
        # A future date is fine (Classic still exists until then).
        resp = self.put({"ui_default": "classic", "ui_classic_retire_on": _days(30)})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()["classic_retired"])

    def test_public_reports_retirement(self):
        self.put({"ui_default": "modern", "ui_classic_retire_on": _days(0)})
        body = _client().get(PUBLIC).json()
        self.assertEqual(body["ui_default"], "modern")
        self.assertTrue(body["classic_retired"])
        self.assertEqual(body["ui_classic_retire_on"], _days(0))


class UserPreferenceTests(_Base):
    def test_modern_saved_and_echoed_by_me(self):
        resp = _client(self.agent).post(PREFS, {"ui_preference": "modern"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["ui_preference"], "modern")
        self.agent.refresh_from_db()
        self.assertEqual(self.agent.ui_preference, "modern")
        self.assertEqual(_client(self.agent).get(ME).json()["ui_preference"], "modern")

    def test_blank_means_follow_the_org(self):
        self.agent.ui_preference = "modern"
        self.agent.save(update_fields=["ui_preference"])
        resp = _client(self.agent).post(PREFS, {"ui_preference": ""}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.agent.refresh_from_db()
        self.assertEqual(self.agent.ui_preference, "")

    def test_bad_value_and_anonymous_rejected(self):
        self.assertEqual(
            _client(self.agent).post(PREFS, {"ui_preference": "retro"}, format="json").status_code, 400)
        self.assertEqual(_client().post(PREFS, {"ui_preference": "modern"}, format="json").status_code, 401)

    def test_classic_refused_once_retired(self):
        self.put({"ui_default": "modern", "ui_classic_retire_on": _days(0)})
        resp = _client(self.agent).post(PREFS, {"ui_preference": "classic"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(_client(self.agent).post(PREFS, {"ui_preference": "modern"}, format="json").status_code, 200)

    def test_switching_off_refuses_the_other_interface(self):
        self.put({"ui_default": "modern", "ui_allow_switch": False})
        self.assertEqual(
            _client(self.agent).post(PREFS, {"ui_preference": "classic"}, format="json").status_code, 400)
        self.assertEqual(
            _client(self.agent).post(PREFS, {"ui_preference": "modern"}, format="json").status_code, 200)

    def test_preference_is_not_an_admin_audit_event(self):
        with self.captureOnCommitCallbacks(execute=True):
            _client(self.agent).post(PREFS, {"ui_preference": "modern"}, format="json")
        self.assertFalse(AdminAuditEvent.objects.exists())


class InterfaceModuleGrantTests(_Base):
    def test_seed_grants(self):
        for user in (self.sup,):
            for action in ("read", "create", "update", "delete"):
                self.assertTrue(check_permission(user, "itsm.admin.interface", action), action)
        self.assertFalse(check_permission(self.agent, "itsm.admin.interface", "read"))
        module = Module.objects.get(code="itsm.admin.interface")
        self.assertEqual(module.parent.code, "itsm.admin")
        self.assertEqual(module.category, "administration")

    def test_migration_is_idempotent_and_keeps_edits(self):
        module = Module.objects.get(code="itsm.admin.interface")
        custom = SystemRole.objects.create(code="custom-x", name="Custom X")
        agent_role = SystemRole.objects.get(code="agent")
        RoleModulePermission.objects.filter(role=agent_role, module=module).update(can_read=True)
        MIGRATION.seed_module(django_apps, None)
        MIGRATION.seed_module(django_apps, None)
        self.assertEqual(RoleModulePermission.objects.filter(role=custom, module=module).count(), 1)
        self.assertFalse(RoleModulePermission.objects.get(role=custom, module=module).can_read)
        # A hand-edited grant survives a re-run (get_or_create never overwrites).
        self.assertTrue(RoleModulePermission.objects.get(role=agent_role, module=module).can_read)
        self.assertEqual(Module.objects.filter(code="itsm.admin.interface").count(), 1)
