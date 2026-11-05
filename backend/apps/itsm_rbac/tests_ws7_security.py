"""2026-10-18 security batch (WS7): per-tenant email-bot cache (S2), a deleted role
grants nothing (R1), built-in / in-use role + superuser / bot / last-admin guards
(S6), and enforcement of the four previously unchecked modules with a no-change
data migration (S7)."""

import importlib
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership

from .models import Module, RoleAssignment, RoleModulePermission, SystemRole
from .registry import seed_rbac
from .services import check_permission, get_user_role, invalidate_permission_cache

User = get_user_model()
MIGRATION = importlib.import_module("apps.itsm_rbac.migrations.0014_backfill_enforced_module_grants")


def _seed_min():
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_projects.seed import run as seed_projects
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_rbac()
    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


def _clone_role(code, source="agent"):
    """A custom role with exactly the source role's explicit rows (like a role an
    admin built in the matrix — the matrix PUTs a row for every module)."""
    role = SystemRole.objects.create(code=code, name=code.title())
    src = SystemRole.objects.get(code=source)
    for p in RoleModulePermission.objects.filter(role=src):
        RoleModulePermission.objects.create(
            role=role, module=p.module, can_read=p.can_read, can_create=p.can_create,
            can_update=p.can_update, can_delete=p.can_delete)
    return role


def _set(role, code, **bits):
    mod = Module.objects.get(code=code)
    RoleModulePermission.objects.update_or_create(role=role, module=mod, defaults=bits)
    invalidate_permission_cache()


def _user(username, role=None, helpdesk=None, lead=True, **kw):
    u = User.objects.create_user(username=username, password="x", **kw)
    if role is not None:
        RoleAssignment.objects.create(user=u, role=role)
    if helpdesk is not None:
        HelpdeskMembership.objects.create(
            helpdesk=helpdesk, user=u, is_active=True,
            role_in_helpdesk="lead" if lead else "member")
    return u


def _run_migration():
    MIGRATION.backfill(django_apps, None)
    invalidate_permission_cache()


# ── S2 ──────────────────────────────────────────────────────────────────────


class EmailBotCachePerSchemaTests(TestCase):
    def setUp(self):
        from apps.itsm_email.services import system_user

        self.su = system_user
        system_user.reset_cache()

    def tearDown(self):
        self.su.reset_cache()

    def test_cache_is_keyed_by_schema(self):
        with mock.patch.object(connections["default"], "schema_name", "org_a"):
            bot_a = self.su.get_email_bot()
        # Simulate org B's own users table: A's bot row is not there.
        User.objects.filter(pk=bot_a.pk).update(username="org-a-bot")
        with mock.patch.object(connections["default"], "schema_name", "org_b"):
            bot_b = self.su.get_email_bot()
        self.assertNotEqual(bot_a.pk, bot_b.pk)  # not A's cached object
        with mock.patch.object(connections["default"], "schema_name", "org_a"):
            self.assertEqual(self.su.get_email_bot().pk, bot_a.pk)  # A keeps its own
        self.su.reset_cache()
        self.assertEqual(self.su._cache, {})


# ── R1 ──────────────────────────────────────────────────────────────────────


class DeletedRoleGrantsNothingTests(TestCase):
    def setUp(self):
        seed_rbac()

    def test_soft_deleted_role_grants_nothing(self):
        role = _clone_role("gone")
        user = _user("ghost", role=role)
        self.assertTrue(check_permission(user, "itsm.tickets", "read"))
        role.soft_delete()
        invalidate_permission_cache()
        user = User.objects.get(pk=user.pk)
        self.assertIsNone(get_user_role(user))
        self.assertFalse(check_permission(user, "itsm.tickets", "read"))


# ── S6 ──────────────────────────────────────────────────────────────────────


class RoleGuardTests(TestCase):
    def setUp(self):
        seed_rbac()
        self.root = User.objects.create_superuser(username="root7", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)

    def _url(self, role):
        return reverse("itsm-role-detail", args=[str(role.id)])

    def test_built_in_role_cannot_be_deleted(self):
        agent = SystemRole.objects.get(code="agent")
        resp = self.client.delete(self._url(agent))
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("Built-in", resp.json()["detail"])
        self.assertTrue(SystemRole.objects.filter(pk=agent.pk).exists())

    def test_role_in_use_cannot_be_deleted(self):
        role = _clone_role("l1")
        _user("holder", role=role, is_active=False)  # inactive holders count too
        resp = self.client.delete(self._url(role))
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("1 user still has this role", resp.json()["detail"])

    def test_unused_custom_role_deletes(self):
        role = _clone_role("spare")
        self.assertEqual(self.client.delete(self._url(role)).status_code, 204)
        self.assertFalse(SystemRole.objects.filter(pk=role.pk).exists())

    def test_built_in_role_code_and_active_are_locked(self):
        agent = SystemRole.objects.get(code="agent")
        self.assertEqual(
            self.client.patch(self._url(agent), {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(
            self.client.patch(self._url(agent), {"code": "agent2"}, format="json").status_code, 400)
        ok = self.client.patch(self._url(agent), {"name": "Service Agent"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["user_count"], 0)

    def test_user_count_is_exposed(self):
        role = _clone_role("counted")
        _user("c1", role=role)
        rows = self.client.get("/api/v1/itsm/roles/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual(next(r for r in rows if r["code"] == "counted")["user_count"], 1)


class SetActiveGuardTests(TestCase):
    def setUp(self):
        seed_rbac()
        self.admin = _user("adm7", role=SystemRole.objects.get(code="admin"))
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _set_active(self, user, value):
        return self.client.post(
            f"/api/v1/itsm/members/{user.pk}/set_active/", {"is_active": value}, format="json")

    def test_cannot_deactivate_superuser_bot_or_self(self):
        su = User.objects.create_superuser(username="boss7", password="x")
        self.assertEqual(self._set_active(su, False).status_code, 400)
        from apps.itsm_email.services.system_user import get_email_bot, reset_cache

        reset_cache()
        bot = get_email_bot()
        resp = self._set_active(bot, False)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("system account", resp.json()["detail"])
        self.assertEqual(self._set_active(self.admin, False).status_code, 400)
        su.refresh_from_db()
        bot.refresh_from_db()
        self.assertTrue(su.is_active and bot.is_active)
        reset_cache()

    def test_normal_user_can_be_deactivated(self):
        u = _user("plain7")
        resp = self._set_active(u, False)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()["is_active"])
        self.assertFalse(resp.json()["is_system_account"])


class ConsoleUserGuardTests(TestCase):
    """Platform console guards. In test mode every app lives in one schema, so the
    org is a ``Client`` pointing at ``public`` (bulk_create skips schema creation) and
    the platform admin is an UNSAVED superuser (so it isn't counted as an org admin)."""

    def setUp(self):
        from apps.tenants.models import Client

        Client.objects.bulk_create([Client(schema_name="public", name="Test org")])
        platform = User(username="platform", is_superuser=True, is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(platform)
        self.only = User.objects.create_superuser(username="owner7", password="x")

    def _url(self, user):
        return f"/api/v1/admin/orgs/public/users/{user.username}/"

    def test_only_active_admin_cannot_be_deactivated_demoted_or_deleted(self):
        # an INACTIVE second superuser doesn't count
        User.objects.create_superuser(username="old7", password="x", is_active=False)
        for body in ({"is_active": False}, {"is_admin": False}):
            resp = self.client.patch(self._url(self.only), body, format="json")
            self.assertEqual(resp.status_code, 400, resp.content)
            self.assertIn("only active administrator", resp.json()["detail"])
        self.assertEqual(self.client.delete(self._url(self.only)).status_code, 400)
        self.only.refresh_from_db()
        self.assertTrue(self.only.is_active and self.only.is_superuser)

    def test_with_a_second_active_admin_it_is_allowed(self):
        User.objects.create_superuser(username="second7", password="x")
        resp = self.client.patch(self._url(self.only), {"is_active": False}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_system_accounts_are_protected(self):
        from apps.itsm_automation.services.system_user import get_automation_bot
        from apps.itsm_automation.services.system_user import reset_cache as reset_auto
        from apps.itsm_email.services.system_user import get_email_bot, reset_cache

        reset_cache()
        reset_auto()
        for bot in (get_email_bot(), get_automation_bot()):
            self.assertEqual(self.client.delete(self._url(bot)).status_code, 400)
            self.assertEqual(
                self.client.patch(self._url(bot), {"is_active": False}, format="json").status_code, 400)
            self.assertEqual(
                self.client.patch(self._url(bot), {"is_admin": True}, format="json").status_code, 400)
            # password-only edits still work
            self.assertEqual(
                self.client.patch(self._url(bot), {"password": "abcdefgh1"}, format="json").status_code, 200)
            self.assertTrue(User.objects.filter(pk=bot.pk, is_active=True).exists())
        reset_cache()
        reset_auto()


# ── S7 ──────────────────────────────────────────────────────────────────────


class EnforcedModulesTests(TestCase):
    def setUp(self):
        _seed_min()
        self.it = Helpdesk.objects.get(key="IT")
        from apps.itsm_projects.models import Project

        self.proj = Project.objects.get(helpdesk=self.it, project_type="incident")
        self.tt = self.proj.ticket_types.get(key="incident")
        self.role = _clone_role("l1")
        self.user = _user("l1user", role=self.role, helpdesk=self.it)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _create(self):
        body = {"project": str(self.proj.id), "ticket_type": str(self.tt.id),
                "summary": "Printer jam", "description_html": "<p>Again</p>"}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(reverse("itsm-ticket-list"), body, format="json")

    # ticket create ----------------------------------------------------------
    def test_ticket_create_enforces_child_module_and_migration_restores(self):
        _set(self.role, "itsm.tickets.create", can_read=True, can_create=False,
             can_update=True, can_delete=False)
        self.assertEqual(self._create().status_code, 403)
        _run_migration()  # parent itsm.tickets create=True ⇒ child flipped back
        self.assertEqual(self._create().status_code, 201)

    def test_ticket_create_inherits_without_a_child_row(self):
        RoleModulePermission.objects.filter(
            role=self.role, module__code="itsm.tickets.create").delete()
        invalidate_permission_cache()
        self.assertEqual(self._create().status_code, 201)

    # reports ----------------------------------------------------------------
    def test_sla_and_agent_reports_are_gated(self):
        _set(self.role, "itsm.reports.sla", can_read=False, can_create=False,
             can_update=False, can_delete=False)
        _set(self.role, "itsm.reports.agent", can_read=False, can_create=False,
             can_update=False, can_delete=False)
        base = "/api/v1/itsm/reports/"
        for name in ("sla-compliance", "sla-breach-list", "sla-at-risk-list",
                     "sla-breached-open-list", "agent-performance"):
            self.assertEqual(self.client.get(f"{base}{name}/").status_code, 403, name)
        self.assertEqual(self.client.get(f"{base}sla-compliance/export/").status_code, 403)
        self.assertEqual(self.client.get(f"{base}by-status/").status_code, 200)
        listed = self.client.get(base).json()["reports"]
        self.assertNotIn("sla-compliance", listed)
        self.assertNotIn("agent-performance", listed)
        self.assertIn("by-status", listed)
        pack = self.client.get(f"{base}export/")
        self.assertEqual(pack.status_code, 200)
        _run_migration()  # Reports read is True ⇒ both children restored
        self.assertEqual(self.client.get(f"{base}sla-compliance/").status_code, 200)
        self.assertEqual(self.client.get(f"{base}agent-performance/").status_code, 200)

    # approvals inbox --------------------------------------------------------
    def test_approval_inbox_is_gated_for_roled_users_only(self):
        url = "/api/v1/itsm/approval-requests/my-pending/"
        _set(self.role, "itsm.portal.approvals", can_read=False, can_create=False,
             can_update=False, can_delete=False)
        self.assertEqual(self.client.get(url).status_code, 403)
        _run_migration()
        self.assertEqual(self.client.get(url).status_code, 200)
        # seeded agent + requestor, a role-less user and a superuser all pass
        for who in (
            _user("ag7", role=SystemRole.objects.get(code="agent")),
            _user("rq7", role=SystemRole.objects.get(code="requestor")),
            _user("norole7"),
            User.objects.create_superuser(username="su7", password="x"),
        ):
            c = APIClient()
            c.force_authenticate(who)
            self.assertEqual(c.get(url).status_code, 200, who.username)


class EnforcedModulesMigrationTests(TestCase):
    """The 0014 backfill: explicit rows equal today's effective access."""

    def setUp(self):
        seed_rbac()

    def _row(self, role, code):
        return RoleModulePermission.all_objects.get(role=role, module__code=code)

    def test_flips_both_directions_and_keeps_other_bits(self):
        role = _clone_role("mix")
        _set(role, "itsm.tickets.create", can_read=True, can_create=False,
             can_update=False, can_delete=True)
        # reports parent False but child True ⇒ today denied ⇒ child set False (no gain)
        _set(role, "itsm.reports", can_read=False, can_create=False, can_update=False,
             can_delete=False)
        _set(role, "itsm.reports.sla", can_read=True, can_create=False, can_update=False,
             can_delete=False)
        _run_migration()
        r = self._row(role, "itsm.tickets.create")
        self.assertTrue(r.can_create)
        self.assertTrue(r.can_read and r.can_delete and not r.can_update)  # untouched
        self.assertFalse(self._row(role, "itsm.reports.sla").can_read)
        self.assertTrue(self._row(role, "itsm.portal.approvals").can_read)

    def test_missing_row_created_with_inherited_bits_and_deleted_row_revived(self):
        role = _clone_role("sparse")
        RoleModulePermission.objects.filter(
            role=role, module__code="itsm.reports.agent").delete()
        dead = self._row(role, "itsm.tickets.create")
        dead.soft_delete()
        _run_migration()
        agent_row = self._row(role, "itsm.reports.agent")
        parent = self._row(role, "itsm.reports")
        self.assertEqual(
            (agent_row.can_read, agent_row.can_create, agent_row.can_update, agent_row.can_delete),
            (parent.can_read, parent.can_create, parent.can_update, parent.can_delete))
        revived = self._row(role, "itsm.tickets.create")
        self.assertFalse(revived.is_deleted)
        self.assertTrue(revived.can_create)  # agent clone has itsm.tickets create

    def test_seeded_roles_unchanged_and_idempotent(self):
        def snapshot():
            return sorted(
                (p.role.code, p.module.code, p.can_read, p.can_create, p.can_update,
                 p.can_delete, p.is_deleted)
                for p in RoleModulePermission.all_objects.select_related("role", "module"))

        before = snapshot()
        _run_migration()
        after = snapshot()
        self.assertEqual(before, after)  # seed already matches today's effective access
        _run_migration()
        self.assertEqual(after, snapshot())
        req = SystemRole.objects.get(code="requestor")
        self.assertFalse(self._row(req, "itsm.tickets.create").can_create)
        self.assertTrue(self._row(req, "itsm.portal.approvals").can_read)

    def test_seed_gives_agents_the_approvals_inbox(self):
        agent = SystemRole.objects.get(code="agent")
        self.assertTrue(self._row(agent, "itsm.portal.approvals").can_read)

    def test_fresh_schema_is_a_noop(self):
        Module.all_objects.all().delete()
        MIGRATION.backfill(django_apps, None)  # no modules yet ⇒ nothing to do
