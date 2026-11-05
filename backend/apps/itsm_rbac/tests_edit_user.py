"""Edit user details (2026-10-24): members/{id}/update_profile/ — full name, email,
manager; guards for bots, superusers, duplicate emails and reporting loops; audit."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_core.models.audit import AdminAuditEvent
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import invalidate_permission_cache

User = get_user_model()
MEMBERS = "/api/v1/itsm/members/"


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class EditUserProfileTests(TestCase):
    def setUp(self):
        seed_rbac()
        invalidate_permission_cache()
        self.root = User.objects.create_superuser(username="root", password="x", email="root@acme.io")
        self.sup = User.objects.create_user(username="sup", password="x", full_name="Sue Pervisor")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.abhi = User.objects.create_user(username="abhi.shroff", password="x", full_name="Abhi Shroff")
        self.boss = User.objects.create_user(username="boss", password="x", full_name="Bea Boss",
                                             email="bea@acme.io")
        self.client_sup = _client(self.sup)

    def post(self, user, body, client=None):
        with self.captureOnCommitCallbacks(execute=True):
            return (client or self.client_sup).post(f"{MEMBERS}{user.pk}/update_profile/", body,
                                                    format="json")

    def test_updates_name_email_and_manager(self):
        resp = self.post(self.abhi, {"full_name": "  Abhi   Shroff ", "email": "abhi.shroff@acme.io",
                                     "manager": self.boss.pk})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.abhi.refresh_from_db()
        self.assertEqual((self.abhi.full_name, self.abhi.email, self.abhi.manager_id),
                         ("Abhi Shroff", "abhi.shroff@acme.io", self.boss.pk))
        self.assertEqual(resp.json()["manager"]["full_name"], "Bea Boss")
        self.assertEqual(self.abhi.username, "abhi.shroff")  # sign-in ID untouched

    def test_omitted_keys_unchanged_and_manager_can_be_cleared(self):
        self.abhi.manager = self.boss
        self.abhi.email = "a@acme.io"
        self.abhi.save()
        resp = self.post(self.abhi, {"manager": None})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.abhi.refresh_from_db()
        self.assertIsNone(self.abhi.manager_id)
        self.assertEqual(self.abhi.email, "a@acme.io")
        # An empty email clears it.
        self.post(self.abhi, {"email": ""})
        self.abhi.refresh_from_db()
        self.assertEqual(self.abhi.email, "")

    def test_validation(self):
        self.assertIn("full_name", self.post(self.abhi, {"full_name": "   "}).json())
        self.assertIn("email", self.post(self.abhi, {"email": "not-an-email"}).json())
        # Another account's email (case-insensitive) or username is refused.
        resp = self.post(self.abhi, {"email": "BEA@acme.io"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Bea Boss (@boss)", resp.json()["email"][0])
        User.objects.create_user(username="satyam.das@acme.io", password="x")
        self.assertIn("email", self.post(self.abhi, {"email": "Satyam.Das@acme.io"}).json())
        # Nothing was written by the refusals.
        self.abhi.refresh_from_db()
        self.assertEqual((self.abhi.full_name, self.abhi.email), ("Abhi Shroff", ""))

    def test_manager_rules(self):
        self.assertIn("manager", self.post(self.abhi, {"manager": self.abhi.pk}).json())
        self.boss.is_active = False
        self.boss.save()
        self.assertIn("manager", self.post(self.abhi, {"manager": self.boss.pk}).json())
        self.assertIn("manager", self.post(self.abhi, {"manager": 999999}).json())
        self.assertIn("manager", self.post(self.abhi, {"manager": "junk"}).json())
        # Loop: boss reports to abhi, so abhi can't report to boss.
        self.boss.is_active = True
        self.boss.manager = self.abhi
        self.boss.save()
        resp = self.post(self.abhi, {"manager": self.boss.pk})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("loop", resp.json()["manager"][0])

    def test_guards(self):
        bot = User.objects.create_user(username="email-bot", password="x")
        self.assertEqual(self.post(bot, {"full_name": "Hacked"}).status_code, 400)
        self.assertEqual(self.post(self.root, {"full_name": "Hacked"}).status_code, 403)
        self.assertEqual(self.post(self.root, {"full_name": "Root Admin"}, client=_client(self.root)).status_code, 200)
        agent = User.objects.create_user(username="agent", password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        self.assertEqual(self.post(self.abhi, {"full_name": "X"}, client=_client(agent)).status_code, 403)

    def test_audited_as_update_with_diff(self):
        self.post(self.abhi, {"email": "abhi.shroff@acme.io", "manager": self.boss.pk})
        ev = AdminAuditEvent.objects.get(area="itsm.admin.roles", action="update")
        fields = {c["field"] for c in ev.changes}
        self.assertTrue({"email", "manager"} <= fields, ev.changes)
        self.assertEqual(ev.object_id, str(self.abhi.pk))
