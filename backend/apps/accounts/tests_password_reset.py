"""Self-service password reset (U14) + the locked-down user directory (S8)."""

from __future__ import annotations

import re
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_notifications.models import NotificationOutbox

from . import password_reset
from .models import AuthMethod, User

URL = "/api/v1/itsm/auth/password-reset/"
ORG = "apps.accounts.password_reset.current_org"


def _link_parts(row):
    m = re.search(r"/t/(\w+)/reset-password\?uid=([\w-]+)&(?:amp;)?token=([\w-]+)", row.rendered_body)
    assert m, row.rendered_body
    return m.group(1), m.group(2), m.group(3)


@mock.patch(ORG, return_value="acme")
class PasswordResetTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice", email="Alice@Example.com", password="old-pass-123")
        self.c = APIClient()

    def _request(self, login):
        return self.c.post(URL, {"login": login}, format="json")

    def _rows(self):
        return NotificationOutbox.objects.filter(event_type="PasswordReset")

    def test_request_by_username_or_email_queues_one_email(self, _org):
        r1 = self._request("alice")
        r2 = self._request("ALICE@example.com")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data, r2.data)
        self.assertEqual(self._rows().count(), 2)
        row = self._rows().first()
        self.assertIsNone(row.ticket_id)
        self.assertEqual(row.recipient, self.user)
        org, _uid, _tok = _link_parts(row)
        self.assertEqual(org, "acme")
        self.assertIn("Reset password", row.rendered_html)

    def test_same_answer_and_no_email_for_ineligible(self, _org):
        ok = self._request("alice").data
        NotificationOutbox.objects.all().delete()
        User.objects.create_user("sso", email="sso@example.com", password="x12345678",
                                 auth_method=AuthMethod.MICROSOFT)
        User.objects.create_user("automation-bot", email="bot@example.com", password="x12345678")
        User.objects.create_user("email-bot", email="ebot@example.com", password="x12345678")
        User.objects.create_user("off", email="off@example.com", password="x12345678", is_active=False)
        nopw = User.objects.create_user("intake", email="intake@example.com")
        nopw.set_unusable_password()
        nopw.save()
        for login in ("nobody", "sso", "automation-bot", "email-bot", "off@example.com",
                      "intake@example.com", ""):
            resp = self._request(login)
            self.assertEqual(resp.status_code, 200, login)
            self.assertEqual(resp.data, ok, login)
        self.assertEqual(self._rows().count(), 0)

    def test_confirm_sets_password_once(self, _org):
        self._request("alice")
        _org_slug, uid, token = _link_parts(self._rows().get())
        v = self.c.post(URL + "validate/", {"uid": uid, "token": token}, format="json")
        self.assertTrue(v.data["valid"])
        short = self.c.post(URL + "confirm/", {"uid": uid, "token": token, "new_password": "short"},
                            format="json")
        self.assertEqual(short.status_code, 400)
        self.assertIn("new_password", short.data)
        ok = self.c.post(URL + "confirm/", {"uid": uid, "token": token,
                                            "new_password": "brand-new-pass-9"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("brand-new-pass-9"))
        again = self.c.post(URL + "confirm/", {"uid": uid, "token": token,
                                               "new_password": "another-pass-77"}, format="json")
        self.assertEqual(again.status_code, 400)  # single use: the password hash changed
        self.assertEqual(again.data["detail"], password_reset.INVALID_LINK)

    def test_garbage_and_expired_tokens(self, _org):
        self._request("alice")
        _o, uid, token = _link_parts(self._rows().get())
        self.assertFalse(self.c.post(URL + "validate/", {"uid": uid, "token": "x-y"},
                                     format="json").data["valid"])
        self.assertFalse(self.c.post(URL + "validate/", {"uid": "zzz", "token": token},
                                     format="json").data["valid"])
        gen = password_reset.TenantPasswordResetTokenGenerator
        later = gen()._now() + timedelta(minutes=password_reset.RESET_VALID_MINUTES + 1)
        with mock.patch.object(gen, "_now", return_value=later):
            self.assertFalse(self.c.post(URL + "validate/", {"uid": uid, "token": token},
                                         format="json").data["valid"])

    def test_token_is_bound_to_its_org(self, org):
        self._request("alice")
        _o, uid, token = _link_parts(self._rows().get())
        org.return_value = "gridcrest"
        resp = self.c.post(URL + "confirm/", {"uid": uid, "token": token,
                                              "new_password": "brand-new-pass-9"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-pass-123"))

    def test_public_schema_refuses(self, org):
        org.return_value = None
        self.assertEqual(self._request("alice").status_code, 404)
        self.assertEqual(self._rows().count(), 0)

    def test_stale_bearer_token_does_not_block(self, _org):
        self.c.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        self.assertEqual(self._request("alice").status_code, 200)

    def test_flush_delivers_from_the_platform_address(self, _org):
        from apps.itsm_notifications.services import outbox

        self._request("alice")
        with self.settings(PLATFORM_NOTIFY_FROM="noreply@platform.test"):
            outbox.flush()
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, [self.user.email])
        self.assertIn("noreply@platform.test", msg.from_email)
        self.assertEqual(msg.subject, "Reset your password")


class UserDirectoryApiTests(TestCase):
    """S8: /users/ is read-only, agent-only and minimal."""

    def setUp(self):
        from apps.itsm_rbac.registry import seed_rbac
        from apps.itsm_rbac.models import RoleAssignment, SystemRole

        seed_rbac()
        self.agent = User.objects.create_user("agent", email="agent@example.com", password="x",
                                              full_name="Agent Smith")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.req = User.objects.create_user("req", email="req@example.com", password="x")
        RoleAssignment.objects.create(user=self.req, role=SystemRole.objects.get(code="requestor"))
        User.objects.create_user("automation-bot", email="", password="x")
        User.objects.create_user("gone", email="gone@example.com", password="x", is_active=False)
        self.url = "/api/v1/users/"

    def _c(self, user=None):
        c = APIClient()
        if user:
            c.force_authenticate(user)
        return c

    def test_anonymous_is_rejected(self):
        self.assertIn(self._c().get(self.url).status_code, (401, 403))

    def test_requestor_is_forbidden(self):
        self.assertEqual(self._c(self.req).get(self.url).status_code, 403)

    def test_agent_search_is_minimal(self):
        resp = self._c(self.agent).get(self.url, {"search": "agent", "page_size": 5})
        self.assertEqual(resp.status_code, 200)
        rows = resp.data["results"]
        self.assertEqual([r["username"] for r in rows], ["agent"])
        self.assertEqual(set(rows[0]), {"id", "username", "full_name", "email"})

    def test_bots_and_inactive_hidden(self):
        names = {r["username"] for r in self._c(self.agent).get(self.url).data["results"]}
        self.assertNotIn("automation-bot", names)
        self.assertNotIn("gone", names)

    def test_writes_are_not_allowed(self):
        c = self._c(self.agent)
        detail = f"{self.url}{self.agent.id}/"
        self.assertEqual(c.post(self.url, {"username": "x"}, format="json").status_code, 405)
        self.assertEqual(c.put(detail, {"is_staff": True}, format="json").status_code, 405)
        self.assertEqual(c.patch(detail, {"is_staff": True}, format="json").status_code, 405)
        self.assertEqual(c.delete(detail).status_code, 405)
        self.agent.refresh_from_db()
        self.assertFalse(self.agent.is_staff)

    def test_legacy_session_routes_are_gone(self):
        c = self._c()
        for path in ("/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/me"):
            self.assertEqual(c.post(path, {}).status_code, 404, path)
