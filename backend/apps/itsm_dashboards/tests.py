"""SavedFilter scoping: personal (user-level) vs shared (project-level) filters."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

import importlib

from django.apps import apps as django_apps

from apps.itsm_dashboards.models import Dashboard, QueueViewPreference, SavedFilter, Widget
from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership
from apps.itsm_projects.models import Project

User = get_user_model()


def _seed_min():
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_projects.seed import run as seed_projects
    from apps.itsm_rbac.registry import seed_rbac
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_rbac()
    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


def _member(username, helpdesk, role="agent", lead=True):
    from apps.itsm_rbac.models import RoleAssignment, SystemRole

    u = User.objects.create_user(username=username, password="x")
    RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code=role))
    HelpdeskMembership.objects.create(
        helpdesk=helpdesk, user=u, is_active=True,
        role_in_helpdesk="lead" if lead else "member")
    return u


def _results(resp):
    return resp.data["results"] if isinstance(resp.data, dict) else resp.data


class SavedFilterScopeTests(TestCase):
    """S5 (2026-10-18): a view belongs to the queue it was saved from; views shared
    from All Tickets reach that helpdesk's members only."""

    def setUp(self):
        _seed_min()
        self.it = Helpdesk.objects.get(key="IT")
        self.hr = Helpdesk.objects.get(key="HR")
        self.p1 = Project.objects.get(helpdesk=self.it, project_type="incident")
        self.p2 = Project.objects.get(helpdesk=self.it, project_type="service_request")
        self.hr_p = Project.objects.get(helpdesk=self.hr, project_type="incident")
        self.me = _member("it_me", self.it)
        self.mate = _member("it_mate", self.it)
        self.hr_agent = _member("hr_agent", self.hr)
        self.root = User.objects.create_superuser(username="root", password="x")

        mk = SavedFilter.objects.create
        self.mine_p1 = mk(name="Mine P1", owner=self.me, project=self.p1)
        self.mine_all = mk(name="Mine All", owner=self.me, helpdesk=self.it)
        self.mate_personal = mk(name="Mate personal", owner=self.mate, project=self.p1)
        self.shared_p1 = mk(name="Shared P1", owner=self.mate, is_shared=True, project=self.p1)
        self.shared_p2 = mk(name="Shared P2", owner=self.mate, is_shared=True, project=self.p2)
        self.shared_it = mk(name="Shared IT", owner=self.mate, is_shared=True, helpdesk=self.it)
        self.shared_hr = mk(name="Shared HR", owner=self.hr_agent, is_shared=True, helpdesk=self.hr)
        # legacy rows the backfill couldn't attribute (project & helpdesk null)
        self.legacy_mine = mk(name="Legacy mine", owner=self.me)
        self.legacy_shared = mk(name="Legacy shared", owner=self.mate, is_shared=True)

        self.client = APIClient()
        self.url = reverse("itsm-saved-filter-list")

    def _names(self, user, params):
        self.client.force_authenticate(user)
        resp = self.client.get(self.url, params)
        self.assertEqual(resp.status_code, 200)
        return {r["name"] for r in _results(resp)}

    def test_project_queue_shows_its_own_views_plus_helpdesk_shares(self):
        self.assertEqual(self._names(self.me, {"project": str(self.p1.id)}),
                         {"Mine P1", "Shared P1", "Shared IT"})
        # personal views don't follow the agent into other queues
        self.assertEqual(self._names(self.me, {"project": str(self.p2.id)}),
                         {"Shared P2", "Shared IT"})

    def test_all_tickets_shows_only_this_helpdesks_views(self):
        self.assertEqual(self._names(self.me, {"helpdesk": str(self.it.id)}),
                         {"Mine All", "Shared IT", "Legacy mine"})
        self.assertEqual(self._names(self.me, {"helpdesk": "IT"}),  # key works too
                         {"Mine All", "Shared IT", "Legacy mine"})
        # an unscoped legacy SHARED row now reaches its owner only
        self.assertEqual(self._names(self.mate, {"helpdesk": str(self.it.id)}),
                         {"Shared IT", "Legacy shared"})

    def test_other_helpdesk_never_sees_shared_all_tickets_views(self):
        self.assertEqual(self._names(self.hr_agent, {"helpdesk": str(self.hr.id)}),
                         {"Shared HR"})
        self.assertEqual(self._names(self.hr_agent, {"helpdesk": str(self.it.id)}), set())
        self.assertEqual(self._names(self.hr_agent, {"project": str(self.p1.id)}), set())
        self.assertNotIn("Shared IT", self._names(self.hr_agent, {}))
        self.client.force_authenticate(self.hr_agent)
        detail = reverse("itsm-saved-filter-detail", args=[str(self.shared_it.id)])
        self.assertEqual(self.client.get(detail).status_code, 404)

    def test_superuser_sees_each_helpdesks_shares_in_its_scope(self):
        self.assertEqual(self._names(self.root, {"helpdesk": str(self.hr.id)}), {"Shared HR"})
        self.assertEqual(self._names(self.root, {"helpdesk": str(self.it.id)}), {"Shared IT"})

    def test_never_leaks_others_personal(self):
        for params in ({}, {"project": str(self.p1.id)}, {"helpdesk": str(self.it.id)}):
            names = self._names(self.me, params)
            self.assertNotIn("Mate personal", names)
            self.assertNotIn("Legacy shared", names)

    # writes ----------------------------------------------------------------
    def _create(self, user, **body):
        self.client.force_authenticate(user)
        payload = {"name": "New", "query_spec": {}, "is_shared": True}
        payload.update(body)
        return self.client.post(self.url, payload, format="json")

    def test_create_scope_checks(self):
        self.assertEqual(self._create(self.me, project=None).status_code, 400)
        self.assertEqual(self._create(self.me, project=None, helpdesk=str(self.hr.id)).status_code, 403)
        self.assertEqual(self._create(self.me, project=str(self.hr_p.id)).status_code, 403)
        ok = self._create(self.me, project=None, helpdesk=str(self.it.id))
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.data["helpdesk"], self.it.id)
        proj = self._create(self.me, project=str(self.p1.id), helpdesk=str(self.it.id))
        self.assertEqual(proj.status_code, 201, proj.content)
        self.assertIsNone(proj.data["helpdesk"])  # a project view's helpdesk is its project's

    def test_owner_can_delete_own_view_but_not_others(self):
        # the seeded Agent has no Delete bit on itsm.tickets.queue
        self.client.force_authenticate(self.me)
        mine = reverse("itsm-saved-filter-detail", args=[str(self.mine_p1.id)])
        self.assertEqual(self.client.delete(mine).status_code, 204)
        theirs = reverse("itsm-saved-filter-detail", args=[str(self.shared_p1.id)])
        self.assertEqual(self.client.delete(theirs).status_code, 403)
        self.assertTrue(SavedFilter.objects.filter(pk=self.shared_p1.pk).exists())


class SavedFilterBackfillTests(TestCase):
    """0006: attribute legacy project=null views to a helpdesk."""

    def setUp(self):
        _seed_min()
        self.it = Helpdesk.objects.get(key="IT")
        self.hr = Helpdesk.objects.get(key="HR")
        self.hr_p = Project.objects.get(helpdesk=self.hr, project_type="incident")
        self.mod = importlib.import_module(
            "apps.itsm_dashboards.migrations.0006_backfill_savedfilter_helpdesk")

    def _run(self):
        self.mod.backfill(django_apps, None)

    def test_rules_in_order_and_idempotent(self):
        by_spec = SavedFilter.objects.create(name="spec", query_spec={
            "match": "all",
            "conditions": [{"field": "project", "op": "in", "value": [str(self.hr_p.id)]}]})
        member = _member("single", self.it)
        by_owner = SavedFilter.objects.create(name="owner", owner=member)
        multi = _member("multi", self.it)
        HelpdeskMembership.objects.create(helpdesk=self.hr, user=multi, is_active=True)
        ambiguous = SavedFilter.objects.create(name="ambiguous", owner=multi, is_shared=True)
        project_row = SavedFilter.objects.create(
            name="project", project=self.hr_p, owner=member)
        self._run()
        for sf in (by_spec, by_owner, ambiguous, project_row):
            sf.refresh_from_db()
        self.assertEqual(by_spec.helpdesk_id, self.hr.id)
        self.assertEqual(by_owner.helpdesk_id, self.it.id)
        self.assertIsNone(ambiguous.helpdesk_id)
        self.assertIsNone(project_row.helpdesk_id)  # project rows untouched
        self._run()  # idempotent
        ambiguous.refresh_from_db()
        self.assertIsNone(ambiguous.helpdesk_id)

    def test_single_helpdesk_tenant_scopes_everything(self):
        Helpdesk.objects.exclude(pk=self.it.pk).update(is_deleted=True)
        sf = SavedFilter.objects.create(name="any", is_shared=True)
        self._run()
        sf.refresh_from_db()
        self.assertEqual(sf.helpdesk_id, self.it.id)


class WidgetScopeTests(TestCase):
    """R2: widget data only for dashboards the caller owns or that are shared."""

    def setUp(self):
        _seed_min()
        it = Helpdesk.objects.get(key="IT")
        self.me = _member("w_me", it)
        self.other = _member("w_other", it)
        self.private = Dashboard.objects.create(name="Private", owner=self.other)
        self.shared = Dashboard.objects.create(name="Shared", owner=self.other, is_shared=True)
        self.w_private = Widget.objects.create(
            dashboard=self.private, widget_type="kpi", title="P", config={"metric": "open_count"})
        self.w_shared = Widget.objects.create(
            dashboard=self.shared, widget_type="kpi", title="S", config={"metric": "open_count"})
        self.client = APIClient()
        self.client.force_authenticate(self.me)

    def test_private_dashboard_widgets_are_hidden(self):
        url = lambda w: reverse("itsm-widget-data", args=[str(w.id)])  # noqa: E731
        self.assertEqual(self.client.get(url(self.w_private)).status_code, 404)
        self.assertEqual(self.client.get(url(self.w_shared)).status_code, 200)
        ids = {r["id"] for r in _results(self.client.get(reverse("itsm-widget-list")))}
        self.assertEqual(ids, {str(self.w_shared.id)})

    def test_cannot_add_widget_to_someone_elses_private_dashboard(self):
        resp = self.client.post(reverse("itsm-widget-list"), {
            "dashboard": str(self.private.id), "widget_type": "kpi", "title": "X"}, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)


class QueueViewPreferenceTests(TestCase):
    """The per-user default queue view: POST upserts; a user only sees their own."""

    def setUp(self):
        _seed_min()
        self.project = Project.objects.filter(project_type="incident").first()
        self.me = User.objects.create_superuser(username="root", password="x")
        self.other = User.objects.create_user(username="other", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.me)
        self.url = reverse("itsm-queue-view-list")

    def test_post_upserts_one_row_per_project(self):
        r1 = self.client.post(self.url, {"project": str(self.project.id), "view_key": "open"}, format="json")
        self.assertEqual(r1.status_code, 201)
        r2 = self.client.post(self.url, {"project": str(self.project.id), "view_key": "overdue"}, format="json")
        self.assertEqual(r2.status_code, 201)
        rows = QueueViewPreference.objects.filter(owner=self.me, project=self.project, is_deleted=False)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.first().view_key, "overdue")

    def test_blank_view_key_clears_default(self):
        """U8: the star toggles off by POSTing a blank key (no Delete bit needed)."""
        self.client.post(self.url, {"project": str(self.project.id), "view_key": "open"}, format="json")
        r = self.client.post(self.url, {"project": str(self.project.id), "view_key": ""}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        resp = self.client.get(self.url, {"project": str(self.project.id)})
        self.assertEqual([row["view_key"] for row in _results(resp)], [""])

    def test_get_returns_only_callers_own(self):
        QueueViewPreference.objects.create(owner=self.me, project=self.project, view_key="open")
        QueueViewPreference.objects.create(owner=self.other, project=self.project, view_key="overdue")
        resp = self.client.get(self.url, {"project": str(self.project.id)})
        self.assertEqual(resp.status_code, 200)
        results = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        self.assertEqual([r["view_key"] for r in results], ["open"])


class ProjectFilterDefaultsTests(TestCase):
    """ProjectWriteSerializer validation for the Filters tab fields."""

    def setUp(self):
        _seed_min()
        self.project = Project.objects.filter(project_type="incident").first()
        self.me = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.me)
        self.url = reverse("itsm-project-detail", args=[str(self.project.id)])

    def test_disabled_view_keys_strips_all_and_unknown(self):
        resp = self.client.patch(
            self.url, {"disabled_view_keys": ["all", "open", "bogus", "open"]}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["disabled_view_keys"], ["open"])  # all + bogus + dup dropped

    def test_default_view_key_blanks_unknown_keeps_system(self):
        bad = self.client.patch(self.url, {"default_view_key": "nope"}, format="json")
        self.assertEqual(bad.status_code, 200)
        self.assertEqual(bad.data["default_view_key"], "")
        good = self.client.patch(self.url, {"default_view_key": "overdue"}, format="json")
        self.assertEqual(good.data["default_view_key"], "overdue")

    def test_default_view_key_accepts_existing_saved_filter(self):
        sf = SavedFilter.objects.create(
            name="Shared", owner=self.me, is_shared=True, project=self.project)
        resp = self.client.patch(self.url, {"default_view_key": f"saved:{sf.id}"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["default_view_key"], f"saved:{sf.id}")
        # A non-existent saved-filter reference falls back to blank.
        gone = self.client.patch(
            self.url, {"default_view_key": "saved:00000000-0000-0000-0000-000000000000"}, format="json")
        self.assertEqual(gone.data["default_view_key"], "")

    def test_default_view_key_requires_shared_filter_on_this_project(self):
        other = Project.objects.exclude(pk=self.project.pk).exclude(
            helpdesk=self.project.helpdesk).first()
        personal = SavedFilter.objects.create(
            name="Personal", owner=self.me, is_shared=False, project=self.project)
        foreign = SavedFilter.objects.create(
            name="Foreign", owner=self.me, is_shared=True, project=other)
        same_hd = SavedFilter.objects.create(
            name="Helpdesk-wide", owner=self.me, is_shared=True, helpdesk=self.project.helpdesk)
        other_hd = SavedFilter.objects.create(
            name="Other helpdesk", owner=self.me, is_shared=True, helpdesk=other.helpdesk)
        legacy = SavedFilter.objects.create(
            name="Legacy", owner=self.me, is_shared=True, project=None)
        # A personal (non-shared) filter can't be a project default → blanked.
        r1 = self.client.patch(self.url, {"default_view_key": f"saved:{personal.id}"}, format="json")
        self.assertEqual(r1.data["default_view_key"], "")
        # A shared filter scoped to a *different* project → blanked.
        r2 = self.client.patch(self.url, {"default_view_key": f"saved:{foreign.id}"}, format="json")
        self.assertEqual(r2.data["default_view_key"], "")
        # Shared from THIS helpdesk's All Tickets → accepted (it lists in this queue).
        r3 = self.client.patch(self.url, {"default_view_key": f"saved:{same_hd.id}"}, format="json")
        self.assertEqual(r3.data["default_view_key"], f"saved:{same_hd.id}")
        # Another helpdesk's All-Tickets share, or an unscoped legacy one → blanked (R2).
        for sf in (other_hd, legacy):
            r = self.client.patch(self.url, {"default_view_key": f"saved:{sf.id}"}, format="json")
            self.assertEqual(r.data["default_view_key"], "", sf.name)


class HelpdeskFilterDefaultsTests(TestCase):
    """HelpdeskWriteSerializer validation for the All-Tickets Filters page fields,
    their auth/me exposure, and the saved filter's ``owner_name``."""

    def setUp(self):
        _seed_min()
        self.project = Project.objects.filter(project_type="incident").first()
        self.hd = self.project.helpdesk
        self.me = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.me)
        self.url = reverse("itsm-helpdesk-detail", args=[str(self.hd.id)])

    def test_disabled_view_keys_strips_all_and_unknown(self):
        resp = self.client.patch(
            self.url, {"combined_disabled_view_keys": ["all", "overdue", "bogus", "overdue"]},
            format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.hd.refresh_from_db()
        self.assertEqual(self.hd.combined_disabled_view_keys, ["overdue"])

    def test_default_view_key_keeps_system_blanks_unknown(self):
        self.client.patch(self.url, {"combined_default_view_key": "unassigned"}, format="json")
        self.hd.refresh_from_db()
        self.assertEqual(self.hd.combined_default_view_key, "unassigned")
        self.client.patch(self.url, {"combined_default_view_key": "nope"}, format="json")
        self.hd.refresh_from_db()
        self.assertEqual(self.hd.combined_default_view_key, "")

    def test_default_view_key_requires_filter_shared_from_this_all_tickets(self):
        other_hd = Helpdesk.objects.exclude(pk=self.hd.pk).first()
        ok = SavedFilter.objects.create(
            name="Helpdesk-wide", owner=self.me, is_shared=True, helpdesk=self.hd)
        personal = SavedFilter.objects.create(
            name="Personal", owner=self.me, is_shared=False, helpdesk=self.hd)
        project_scoped = SavedFilter.objects.create(
            name="Project", owner=self.me, is_shared=True, project=self.project)
        foreign = SavedFilter.objects.create(
            name="Other helpdesk", owner=self.me, is_shared=True, helpdesk=other_hd)
        deleted = SavedFilter.objects.create(
            name="Deleted", owner=self.me, is_shared=True, helpdesk=self.hd, is_deleted=True)
        self.client.patch(self.url, {"combined_default_view_key": f"saved:{ok.id}"}, format="json")
        self.hd.refresh_from_db()
        self.assertEqual(self.hd.combined_default_view_key, f"saved:{ok.id}")
        for sf in (personal, project_scoped, foreign, deleted):
            self.client.patch(self.url, {"combined_default_view_key": f"saved:{sf.id}"}, format="json")
            self.hd.refresh_from_db()
            self.assertEqual(self.hd.combined_default_view_key, "", sf.name)

    def test_settings_exposed_in_helpdesk_membership(self):
        from apps.itsm_helpdesks.services import build_helpdesk_membership

        self.hd.combined_default_view_key = "overdue"
        self.hd.combined_disabled_view_keys = ["due_today"]
        self.hd.save(update_fields=["combined_default_view_key", "combined_disabled_view_keys"])
        row = next(h for h in build_helpdesk_membership(self.me) if h["key"] == self.hd.key)
        self.assertEqual(row["combined_default_view_key"], "overdue")
        self.assertEqual(row["combined_disabled_view_keys"], ["due_today"])

    def test_saved_filter_lists_owner_name(self):
        self.me.full_name = "Root Admin"
        self.me.save(update_fields=["full_name"])
        SavedFilter.objects.create(name="Mine", owner=self.me, is_shared=True, helpdesk=self.hd)
        SavedFilter.objects.create(name="Orphan", owner=None, is_shared=True, helpdesk=self.hd)
        resp = self.client.get(reverse("itsm-saved-filter-list"), {"helpdesk": str(self.hd.id)})
        self.assertEqual(resp.status_code, 200, resp.content)
        names = {r["name"]: r["owner_name"] for r in _results(resp)}
        self.assertEqual(names["Mine"], "Root Admin")
        self.assertEqual(names["Orphan"], "")
