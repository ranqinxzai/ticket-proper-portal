"""Knowledge base: G6 search (portal visibility), B16 lifecycle + category nesting,
U12 archive/restore, K1 requestor leak, category delete, migration 0003 repair."""

import importlib

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac

from . import search
from .models import Article, ArticleTicketLink, KBCategory

User = get_user_model()


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class KBTestBase(TestCase):
    def setUp(self):
        cache.clear()
        seed_rbac()
        self.agent = User.objects.create_user(username="kb-agent", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.requestor = User.objects.create_user(username="kb-req", password="x")
        RoleAssignment.objects.create(user=self.requestor, role=SystemRole.objects.get(code="requestor"))
        self.agent_c = _client(self.agent)
        self.req_c = _client(self.requestor)

    def _art(self, title, status="published", visibility="portal", body="", **kw):
        n = Article.objects.count()
        return Article.objects.create(
            title=title, slug=f"a-{n}-{status}-{visibility}", status=status,
            visibility=visibility, body_html=body, body_text=body, **kw)

    def _titles(self, resp):
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return [a["title"] for a in data]


class KBSearchTests(KBTestBase):
    def setUp(self):
        super().setUp()
        self.pub = self._art("How to reset your password")
        self._art("Password draft notes", status="draft")
        self._art("Password internal runbook", visibility="internal")
        self._art("Old password policy", status="archived")
        self._art("VPN setup", body="Connect before resetting nothing")

    def test_portal_search_typo_only_published_portal(self):
        got = self._titles(self.req_c.get(reverse("itsm-kb-browse-list"), {"search": "pasword"}))
        self.assertEqual(got, ["How to reset your password"])

    def test_portal_stemmed_search(self):
        got = self._titles(self.req_c.get(reverse("itsm-kb-browse-list"), {"search": "resetting passwords"}))
        self.assertEqual(got, ["How to reset your password"])

    def test_agent_search_ranks_title_over_body(self):
        body_hit = self._art("Network guide", body="the vpn client needs an update")
        got = self._titles(self.agent_c.get(reverse("itsm-kb-article-list"), {"search": "vpn"}))
        self.assertEqual(got, ["VPN setup", "Network guide"])
        self.assertTrue(body_hit)

    def test_agent_search_sees_drafts_and_internal_not_archived(self):
        got = set(self._titles(self.agent_c.get(reverse("itsm-kb-article-list"), {"search": "password"})))
        self.assertEqual(got, {"How to reset your password", "Password draft notes",
                               "Password internal runbook"})

    def test_tags_are_searchable(self):
        self._art("Wireless", tags=["wifi", "eduroam"])
        got = self._titles(self.req_c.get(reverse("itsm-kb-browse-list"), {"search": "eduroam"}))
        self.assertEqual(got, ["Wireless"])

    def test_index_expression_matches_query(self):
        idx = {i.name: i for i in Article._meta.indexes}
        self.assertEqual(idx["itsm_kb_article_fts"].expressions[0], search.article_fts_vector())

    def test_requestor_admin_endpoint_only_published_portal(self):
        """K1: requestors hold itsm.knowledge:read — /kb-articles/ used to leak drafts."""
        got = set(self._titles(self.req_c.get(reverse("itsm-kb-article-list"))))
        self.assertEqual(got, {"How to reset your password", "VPN setup"})
        draft = Article.objects.get(status="draft")
        self.assertEqual(self.req_c.get(reverse("itsm-kb-article-detail", args=[draft.pk])).status_code, 404)

    def test_requestor_cannot_read_article_links(self):
        from apps.itsm_tickets.tests import _project, _seed_min
        from apps.itsm_tickets.services import ticket_service
        _seed_min()
        proj = _project("IT", "incident")
        t = ticket_service.create_ticket(project=proj, ticket_type=proj.ticket_types.first(),
                                         summary="T", apply_routing=False)
        ArticleTicketLink.objects.create(article=Article.objects.get(status="draft"), ticket=t)
        resp = self.req_c.get(reverse("itsm-kb-article-link-list"))
        self.assertEqual(self._titles_links(resp), [])
        admin = User.objects.create_superuser(username="kb-root", password="x")
        self.assertEqual(len(self._titles_links(_client(admin).get(reverse("itsm-kb-article-link-list")))), 1)

    def _titles_links(self, resp):
        self.assertEqual(resp.status_code, 200)
        return [r["article_title"] for r in resp.data["results"]]

    def test_list_is_not_capped_at_25(self):
        for i in range(30):
            self._art(f"Bulk {i}")
        resp = self.agent_c.get(reverse("itsm-kb-article-list"), {"page_size": 500})
        self.assertEqual(len(self._titles(resp)), 30 + 4)

    def test_org_wide_filter_server_side(self):
        from apps.itsm_helpdesks.seed import run as seed_helpdesks
        from apps.itsm_helpdesks.models import Helpdesk
        seed_helpdesks()
        self._art("IT only", helpdesk=Helpdesk.objects.get(key="IT"))
        got = self._titles(self.agent_c.get(reverse("itsm-kb-article-list"), {"helpdesk__isnull": "true"}))
        self.assertNotIn("IT only", got)
        self.assertIn("VPN setup", got)


class KBLifecycleTests(KBTestBase):
    def _post(self, client, art, name):
        return client.post(reverse(f"itsm-kb-article-{name}", args=[art.pk]), {}, format="json")

    def test_unpublish_moves_to_draft_and_hides_from_portal(self):
        art = self._art("Live article")
        resp = self._post(self.agent_c, art, "unpublish")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "draft")
        self.assertEqual(self._titles(self.req_c.get(reverse("itsm-kb-browse-list"))), [])

    def test_patch_cannot_change_status(self):
        art = self._art("Live article")
        resp = self.agent_c.patch(reverse("itsm-kb-article-detail", args=[art.pk]),
                                  {"status": "draft", "title": "Live article v2"}, format="json")
        self.assertEqual(resp.status_code, 200)
        art.refresh_from_db()
        self.assertEqual((art.status, art.title), ("published", "Live article v2"))
        new = self.agent_c.post(reverse("itsm-kb-article-list"),
                                {"title": "N", "slug": "n-1", "body_html": "<p>x</p>", "status": "published"},
                                format="json")
        self.assertEqual(new.data["status"], "draft")

    def test_publish_stamps_published_at(self):
        art = self._art("Draft", status="draft")
        resp = self._post(self.agent_c, art, "publish")
        self.assertEqual(resp.data["status"], "published")
        self.assertIsNotNone(resp.data["published_at"])

    def test_archive_hides_from_portal_and_default_list(self):
        art = self._art("Retire me")
        self._art("Keep me")
        resp = self._post(self.agent_c, art, "archive")
        self.assertEqual(resp.data["status"], "archived")
        self.assertEqual(self._titles(self.req_c.get(reverse("itsm-kb-browse-list"))), ["Keep me"])
        self.assertEqual(self.req_c.get(reverse("itsm-kb-browse-detail", args=[art.pk])).status_code, 404)
        self.assertEqual(self._titles(self.agent_c.get(reverse("itsm-kb-article-list"))), ["Keep me"])
        archived = self.agent_c.get(reverse("itsm-kb-article-list"), {"status": "archived"})
        self.assertEqual(self._titles(archived), ["Retire me"])
        # The editor can still open it by id.
        self.assertEqual(self.agent_c.get(reverse("itsm-kb-article-detail", args=[art.pk])).status_code, 200)

    def test_restore_returns_to_draft(self):
        art = self._art("Old", status="archived")
        resp = self._post(self.agent_c, art, "restore")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "draft")

    def test_restore_non_archived_is_400(self):
        art = self._art("Live")
        resp = self._post(self.agent_c, art, "restore")
        self.assertEqual(resp.status_code, 400)
        art.refresh_from_db()
        self.assertEqual(art.status, "published")

    def test_requestor_cannot_archive_or_publish(self):
        art = self._art("Live")
        for name in ("archive", "restore", "publish", "unpublish"):
            self.assertEqual(self._post(self.req_c, art, name).status_code, 403)

    def test_agent_cannot_delete(self):
        art = self._art("Live")
        self.assertEqual(self.agent_c.delete(reverse("itsm-kb-article-detail", args=[art.pk])).status_code, 403)


class KBCategoryTests(KBTestBase):
    def _cat(self, name, parent=None):
        return KBCategory.objects.create(name=name, slug=name.lower().replace(" ", "-"), parent=parent)

    def _patch(self, cat, **body):
        return self.agent_c.patch(reverse("itsm-kb-category-detail", args=[cat.pk]), body, format="json")

    def test_category_with_children_cannot_get_a_parent(self):
        a, b = self._cat("A"), self._cat("B")
        self._cat("B child", parent=b)
        resp = self._patch(b, parent=str(a.pk))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("has sub-categories", resp.data["parent"][0])
        b.refresh_from_db()
        self.assertIsNone(b.parent_id)

    def test_cannot_nest_under_a_subcategory(self):
        a = self._cat("A")
        child = self._cat("A child", parent=a)
        resp = self.agent_c.post(reverse("itsm-kb-category-list"),
                                 {"name": "Deep", "slug": "deep", "parent": str(child.pk)}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("already a sub-category", resp.data["parent"][0])

    def test_cannot_be_own_parent(self):
        a = self._cat("A")
        self.assertEqual(self._patch(a, parent=str(a.pk)).status_code, 400)

    def test_leaf_can_be_reparented_and_other_edits_ok(self):
        a, b = self._cat("A"), self._cat("B")
        leaf = self._cat("Leaf", parent=a)
        self.assertEqual(self._patch(leaf, parent=str(b.pk)).status_code, 200)
        self.assertEqual(self._patch(leaf, parent=str(b.pk), name="Leaf 2").status_code, 200)
        self.assertEqual(self._patch(a, name="A2").status_code, 200)

    def test_delete_uncategorises_articles_and_promotes_children(self):
        sup = User.objects.create_user(username="kb-sup", password="x")
        RoleAssignment.objects.create(user=sup, role=SystemRole.objects.get(code="supervisor"))
        parent = self._cat("Parent")
        child = self._cat("Child", parent=parent)
        art = self._art("In parent", category=parent)
        resp = _client(sup).delete(reverse("itsm-kb-category-detail", args=[parent.pk]))
        self.assertEqual(resp.status_code, 204)
        art.refresh_from_db()
        child.refresh_from_db()
        self.assertIsNone(art.category_id)
        self.assertIsNone(child.parent_id)
        self.assertTrue(KBCategory.all_objects.get(pk=parent.pk).is_deleted)


class FlattenMigrationTests(KBTestBase):
    def _run(self):
        mod = importlib.import_module("apps.itsm_knowledge.migrations.0003_flatten_kb_categories")
        state = MigrationExecutor(connection).loader.project_state(
            ("itsm_knowledge", "0003_flatten_kb_categories"))
        mod.forwards(state.apps, None)

    def test_flattens_nesting_and_clears_deleted_refs(self):
        a = KBCategory.objects.create(name="A", slug="a")
        b = KBCategory.objects.create(name="B", slug="b", parent=a)
        c = KBCategory.objects.create(name="C", slug="c", parent=b)
        d = KBCategory.objects.create(name="D", slug="d", parent=c)
        gone = KBCategory.objects.create(name="Gone", slug="gone")
        orphan = KBCategory.objects.create(name="Orphan", slug="orphan", parent=gone)
        art = self._art("In gone", category=gone)
        gone.soft_delete()
        for _ in range(2):  # idempotent
            self._run()
            for obj in (b, c, d, orphan, art):
                obj.refresh_from_db()
            self.assertEqual((b.parent_id, c.parent_id, d.parent_id), (a.pk, a.pk, a.pk))
            self.assertIsNone(orphan.parent_id)
            self.assertIsNone(art.category_id)
