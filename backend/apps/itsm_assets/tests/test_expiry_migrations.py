"""The hourly expiry sweep, the org-timezone 'today', and the two data migrations."""

from __future__ import annotations

import datetime as dt
import importlib
from unittest import mock

from django.apps import apps as django_apps
from django.utils import timezone

from apps.itsm_rbac.models import Module, RoleModulePermission, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import check_permission, invalidate_permission_cache

from ..models import Asset, AssetEvent, AssetStatus
from ..services import asset_service
from ..services.parsing import org_today
from .base import API, AssetTestCase, make_user

RBAC_MIGRATION = importlib.import_module("apps.itsm_assets.migrations.0003_rbac_modules")
STATUS_MIGRATION = importlib.import_module("apps.itsm_assets.migrations.0002_default_statuses")


class ExpirySweepTests(AssetTestCase):
    def _asset(self, name, status_key, days):
        a = Asset.objects.create(
            helpdesk=self.it, name=name, asset_tag=name.upper(), category=self.computer,
            status=self.status[status_key], expiry_date=org_today() + dt.timedelta(days=days))
        return a

    def test_sweep_moves_only_active_past_expiry_and_is_idempotent(self):
        due = self._asset("due", "in_use", -1)
        repair = self._asset("repair", "in_repair", -5)
        future = self._asset("future", "in_stock", 3)
        lost = self._asset("lost", "lost", -9)
        today = self._asset("today", "in_stock", 0)   # expires today → not yet
        self.assertEqual(asset_service.sweep_expired(), 2)
        for a in (due, repair, future, lost, today):
            a.refresh_from_db()
        self.assertEqual(due.status.key, "expired")
        self.assertEqual(repair.status.key, "expired")
        self.assertEqual(future.status.key, "in_stock")
        self.assertEqual(lost.status.key, "lost")
        self.assertEqual(today.status.key, "in_stock")
        ev = AssetEvent.objects.get(asset=due, action="auto_expired")
        self.assertIsNone(ev.actor)
        self.assertEqual(ev.changes[0]["old"], "In Use")
        self.assertEqual(asset_service.sweep_expired(), 0)
        self.assertEqual(AssetEvent.objects.filter(action="auto_expired").count(), 2)

    def test_no_target_status_does_nothing(self):
        self._asset("due", "in_use", -1)
        AssetStatus.objects.filter(auto_expire_target=True).update(auto_expire_target=False)
        self.assertEqual(asset_service.sweep_expired(), 0)

    def test_today_uses_the_default_calendar_timezone(self):
        from apps.itsm_sla.models import BusinessCalendar

        BusinessCalendar.objects.update(is_default=False)
        BusinessCalendar.objects.create(name="IST", timezone="Asia/Kolkata", is_default=True)
        # 20:00 UTC on 18 Oct = 01:30 IST on 19 Oct.
        fake_now = dt.datetime(2026, 10, 18, 20, 0, tzinfo=dt.timezone.utc)
        with mock.patch.object(timezone, "now", return_value=fake_now):
            self.assertEqual(org_today(), dt.date(2026, 10, 19))


class RbacMigrationTests(AssetTestCase):
    def test_grants_by_role_and_custom_roles_get_explicit_none(self):
        custom = SystemRole.objects.create(code="viewer", name="Viewer")
        # GridCrest-style hand edit: agent already has a different row → kept.
        agent = SystemRole.objects.get(code="agent")
        mod = Module.objects.get(code="itsm.assets")
        RoleModulePermission.objects.filter(role=agent, module=mod).update(can_create=False)
        RBAC_MIGRATION.seed_modules(django_apps, None)
        RBAC_MIGRATION.seed_modules(django_apps, None)  # idempotent
        invalidate_permission_cache()
        rows = {(p.role.code, p.module.code): p for p in RoleModulePermission.objects.filter(
            module__code__startswith="itsm.assets").select_related("role", "module")}
        self.assertFalse(rows[("agent", "itsm.assets")].can_create)  # hand edit survived
        self.assertTrue(rows[("supervisor", "itsm.assets.import")].can_create)
        self.assertFalse(rows[("agent", "itsm.assets.import")].can_read)
        for code in ("itsm.assets", "itsm.assets.import", "itsm.assets.config"):
            r = rows[("viewer", code)]
            self.assertFalse(any([r.can_read, r.can_create, r.can_update, r.can_delete]))
        self.assertEqual(Module.objects.get(code="itsm.assets.config").category, "administration")
        self.assertEqual(Module.objects.get(code="itsm.assets.import").parent.code, "itsm.assets")
        u = make_user("v1", "viewer", self.it)
        self.assertFalse(check_permission(u, "itsm.assets", "read"))

    def test_seed_rbac_matches_the_migration(self):
        seed_rbac()
        agent = SystemRole.objects.get(code="agent")
        get = lambda code: RoleModulePermission.objects.get(role=agent, module__code=code)  # noqa: E731
        self.assertEqual((get("itsm.assets").can_read, get("itsm.assets").can_delete), (True, False))
        self.assertFalse(get("itsm.assets.import").can_create)
        self.assertTrue(get("itsm.assets.config").can_read)
        self.assertFalse(get("itsm.assets.config").can_update)

    def test_me_permission_map_has_the_new_codes(self):
        self.as_user(self.agent)
        perms = self.client.get(f"{API}/auth/me/").json()["permissions"]
        self.assertTrue(perms["itsm.assets"]["create"])
        self.assertFalse(perms["itsm.assets"]["delete"])
        self.assertTrue(perms["itsm.assets.config"]["read"])


class StatusMigrationTests(AssetTestCase):
    def test_skips_when_statuses_exist_and_seeds_when_empty(self):
        AssetStatus.objects.filter(key="lost").update(name="Missing (lost)")
        STATUS_MIGRATION.seed_statuses(django_apps, None)
        self.assertEqual(AssetStatus.objects.get(key="lost").name, "Missing (lost)")
        Asset.objects.all().delete()
        AssetStatus.all_objects.all().delete()
        STATUS_MIGRATION.seed_statuses(django_apps, None)
        self.assertEqual(AssetStatus.objects.count(), 6)
        self.assertEqual(AssetStatus.objects.get(is_default=True).key, "in_stock")
        self.assertEqual(AssetStatus.objects.get(auto_expire_target=True).key, "expired")
