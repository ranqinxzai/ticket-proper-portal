from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    ADMIN = "admin", "Admin"
    QA_LEAD = "qa_lead", "QA Lead"
    QA = "qa", "QA Engineer"
    DEV = "dev", "Developer"
    VIEWER = "viewer", "Viewer"


class AppKey(models.TextChoices):
    QA = "qa", "Testcase"
    PM = "pm", "Project"


class AuthMethod(models.TextChoices):
    """How a user authenticates. Chosen per-user when the account is created.

    ``PASSWORD`` — the classic username/password login (default; every existing
    user keeps this). ``MICROSOFT`` — the user signs in with their organisation's
    Microsoft (Entra ID) account via the per-tenant SSO app; their local password
    is unusable. An admin/superuser flagged ``MICROSOFT`` may still keep a usable
    password as a break-glass fallback (enforced in the login serializer).
    """

    PASSWORD = "password", "Password"
    MICROSOFT = "microsoft", "Microsoft (SSO)"


def default_app_access():
    return [AppKey.QA.value, AppKey.PM.value]


class User(AbstractUser):
    full_name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.QA)
    app_access = models.JSONField(default=default_app_access, blank=True)
    # Reporting line — drives the ITSM "requestor's manager" approval stage.
    manager = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="reports"
    )
    # ── Sign-in method (per-user SSO) ────────────────────────────────────────
    # Decides how the user authenticates (see AuthMethod). Default keeps every
    # current account on password login — no behaviour change on upgrade.
    auth_method = models.CharField(
        max_length=16, choices=AuthMethod.choices, default=AuthMethod.PASSWORD
    )
    # Microsoft Entra object id (the immutable ``oid`` claim). Stored on first
    # successful SSO sign-in so we keep matching the same account even if its
    # email/UPN later changes. Blank for password users.
    ms_object_id = models.CharField(max_length=64, blank=True, default="", db_index=True)

    def __str__(self):
        return self.full_name or self.username

    def has_app(self, key: str) -> bool:
        if self.is_superuser:
            return True
        return key in (self.app_access or [])

    @property
    def uses_sso(self) -> bool:
        return self.auth_method == AuthMethod.MICROSOFT
