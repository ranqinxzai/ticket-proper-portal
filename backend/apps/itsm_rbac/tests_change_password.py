"""Self-service password change (`/itsm/auth/change-password/`)."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

User = get_user_model()

URL = "/api/v1/itsm/auth/change-password/"


class ChangePasswordApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="jo", password="oldpass123", email="jo@example.io"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_happy_path_changes_password(self):
        resp = self.client.post(
            URL,
            {"current_password": "oldpass123", "new_password": "brandnew456"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("brandnew456"))
        self.assertFalse(self.user.check_password("oldpass123"))

    def test_wrong_current_password_rejected(self):
        resp = self.client.post(
            URL,
            {"current_password": "nope", "new_password": "brandnew456"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("current_password", resp.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("oldpass123"))

    def test_new_password_too_short_rejected(self):
        resp = self.client.post(
            URL,
            {"current_password": "oldpass123", "new_password": "short"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("oldpass123"))

    def test_new_equal_to_current_rejected(self):
        resp = self.client.post(
            URL,
            {"current_password": "oldpass123", "new_password": "oldpass123"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.json())

    def test_missing_fields_rejected(self):
        resp = self.client.post(URL, {"current_password": "oldpass123"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_sso_user_without_usable_password_rejected(self):
        sso = User.objects.create_user(username="sso", email="sso@example.io")
        sso.set_unusable_password()
        sso.save()
        client = APIClient()
        client.force_authenticate(sso)
        resp = client.post(
            URL,
            {"current_password": "x", "new_password": "brandnew456"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Microsoft", resp.json().get("detail", ""))

    def test_anonymous_rejected(self):
        client = APIClient()
        resp = client.post(
            URL,
            {"current_password": "oldpass123", "new_password": "brandnew456"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)
