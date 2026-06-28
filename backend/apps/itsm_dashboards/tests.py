"""SavedFilter scoping: personal (user-level) vs shared (project-level) filters."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_dashboards.models import QueueViewPreference, SavedFilter
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


class SavedFilterScopeTests(TestCase):
    def setUp(self):
        _seed_min()
        self.p1 = Project.objects.filter(project_type="incident").first()
        self.p2 = Project.objects.exclude(pk=self.p1.pk).first()
        self.me = User.objects.create_superuser(username="root", password="x")
        self.other = User.objects.create_user(username="other", password="x")

        self.mine_p1 = SavedFilter.objects.create(name="Mine P1", owner=self.me, project=self.p1)
        self.other_personal = SavedFilter.objects.create(name="Other personal", owner=self.other)
        self.shared_p1 = SavedFilter.objects.create(
            name="Shared P1", owner=self.other, is_shared=True, project=self.p1)
        self.shared_p2 = SavedFilter.objects.create(
            name="Shared P2", owner=self.other, is_shared=True, project=self.p2)
        self.shared_global = SavedFilter.objects.create(
            name="Shared global", owner=self.other, is_shared=True, project=None)

        self.client = APIClient()
        self.client.force_authenticate(self.me)
        self.url = reverse("itsm-saved-filter-list")

    def _names(self, params):
        resp = self.client.get(self.url, params)
        self.assertEqual(resp.status_code, 200)
        results = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return {r["name"] for r in results}

    def test_project_scope_lists_own_and_shared_for_project(self):
        names = self._names({"project": str(self.p1.id)})
        self.assertEqual(names, {"Mine P1", "Shared P1", "Shared global"})

    def test_other_project_hides_project_scoped_shared(self):
        names = self._names({"project": str(self.p2.id)})
        # Owner sees their own (any project) + this project's shared + global shared.
        self.assertEqual(names, {"Mine P1", "Shared P2", "Shared global"})

    def test_no_project_param_only_global_shared_plus_own(self):
        names = self._names({})
        self.assertEqual(names, {"Mine P1", "Shared global"})

    def test_never_leaks_others_personal(self):
        for params in ({}, {"project": str(self.p1.id)}, {"project": str(self.p2.id)}):
            self.assertNotIn("Other personal", self._names(params))


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
        other = Project.objects.exclude(pk=self.project.pk).first()
        personal = SavedFilter.objects.create(
            name="Personal", owner=self.me, is_shared=False, project=self.project)
        foreign = SavedFilter.objects.create(
            name="Foreign", owner=self.me, is_shared=True, project=other)
        glob = SavedFilter.objects.create(
            name="Global", owner=self.me, is_shared=True, project=None)
        # A personal (non-shared) filter can't be a project default → blanked.
        r1 = self.client.patch(self.url, {"default_view_key": f"saved:{personal.id}"}, format="json")
        self.assertEqual(r1.data["default_view_key"], "")
        # A shared filter scoped to a *different* project → blanked.
        r2 = self.client.patch(self.url, {"default_view_key": f"saved:{foreign.id}"}, format="json")
        self.assertEqual(r2.data["default_view_key"], "")
        # A cross-project (global) shared filter is resolvable everywhere → accepted.
        r3 = self.client.patch(self.url, {"default_view_key": f"saved:{glob.id}"}, format="json")
        self.assertEqual(r3.data["default_view_key"], f"saved:{glob.id}")
