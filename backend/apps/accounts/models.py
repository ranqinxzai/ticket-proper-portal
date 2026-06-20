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


def default_app_access():
    return [AppKey.QA.value, AppKey.PM.value]


class User(AbstractUser):
    full_name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.QA)
    app_access = models.JSONField(default=default_app_access, blank=True)

    def __str__(self):
        return self.full_name or self.username

    def has_app(self, key: str) -> bool:
        if self.is_superuser:
            return True
        return key in (self.app_access or [])
