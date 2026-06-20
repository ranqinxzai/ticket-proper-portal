import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
DEBUG = os.getenv("DEBUG", "True").lower() == "true"
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "django_filters",
    "django_apscheduler",
    "corsheaders",
    "apps.core.apps.CoreConfig",
    "apps.accounts.apps.AccountsConfig",
    # ── ITSM platform (ManageEngine-inspired rebuild) ───────────────────────
    # P0: core → rbac → helpdesks.  P1: projects → groups → workflows → tickets.
    "apps.itsm_core.apps.ItsmCoreConfig",
    "apps.itsm_rbac.apps.ItsmRbacConfig",
    "apps.itsm_helpdesks.apps.ItsmHelpdesksConfig",
    "apps.itsm_projects.apps.ItsmProjectsConfig",
    "apps.itsm_groups.apps.ItsmGroupsConfig",
    "apps.itsm_workflows.apps.ItsmWorkflowsConfig",
    "apps.itsm_tickets.apps.ItsmTicketsConfig",
    # P3: SLA + notifications.  P7: reporting + dashboards.
    "apps.itsm_sla.apps.ItsmSlaConfig",
    "apps.itsm_notifications.apps.ItsmNotificationsConfig",
    "apps.itsm_reporting.apps.ItsmReportingConfig",
    "apps.itsm_dashboards.apps.ItsmDashboardsConfig",
    # New modules — P6: approvals.  P4: catalog.  P5: knowledge base.
    "apps.itsm_approvals.apps.ItsmApprovalsConfig",
    "apps.itsm_catalog.apps.ItsmCatalogConfig",
    "apps.itsm_knowledge.apps.ItsmKnowledgeConfig",
]

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

# Running behind a TLS-terminating reverse proxy (edge-router -> ticket-nginx).
# Trust X-Forwarded-Proto so request.is_secure() reports https and redirects
# are built with the right scheme.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

ROOT_URLCONF = "core.urls"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.debug",
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

WSGI_APPLICATION = "core.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME", "ticketing_system"),
        "USER": os.getenv("DB_USER", "postgres"),
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
    }
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "apps.accounts.auth.CsrfExemptSessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.accounts.auth.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# ── JWT (ITSM agent app) ────────────────────────────────────────────────────
from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "ITSM Platform API",
    "DESCRIPTION": "Agent-focused IT Service Management (Incident + Service Request).",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

# ── Schedulers (SLA breach sweep, notification outbox flush, reporting) ──────
# Disabled by default; the runserver/gunicorn process sets RUN_SCHEDULER=1.
RUN_SCHEDULER = os.getenv("RUN_SCHEDULER", "0").lower() in ("1", "true", "yes")
SCHEDULER_BLOCKED_COMMANDS = frozenset({
    "migrate", "makemigrations", "shell", "shell_plus", "test", "collectstatic",
    "createsuperuser", "seed_itsm", "loaddata", "dumpdata",
})

# Business defaults for the SLA / notification engines (overridable via env).
SLA_BREACH_SWEEP_INTERVAL_MINUTES = int(os.getenv("SLA_BREACH_SWEEP_INTERVAL_MINUTES", "1"))
NOTIFICATIONS_OUTBOX_FLUSH_SECONDS = int(os.getenv("NOTIFICATIONS_OUTBOX_FLUSH_SECONDS", "30"))
NOTIFICATIONS_MAX_ATTEMPTS = int(os.getenv("NOTIFICATIONS_MAX_ATTEMPTS", "6"))

CORS_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
CORS_ALLOW_CREDENTIALS = True

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = "noreply@ticketing.local"

# ── Email channel (itsm_email): inbound polling + outbound threading ─────────
# Secrets are Fernet‑encrypted at rest. ITSM_CREDENTIAL_KEY may be a 44‑char
# urlsafe Fernet key or any passphrase (derived to a key); blank → derived from
# SECRET_KEY (dev/CI only — set a real key in production).
ITSM_CREDENTIAL_KEY = os.getenv("ITSM_CREDENTIAL_KEY", "")

EMAIL_DOMAIN = os.getenv("EMAIL_DOMAIN", "ticketing.local")          # Message‑ID / plus‑addr host
EMAIL_REPLY_TO_LOCALPART = os.getenv("EMAIL_REPLY_TO_LOCALPART", "support")  # support+INC-123@domain
EMAIL_POLL_INTERVAL_SECONDS = int(os.getenv("EMAIL_POLL_INTERVAL_SECONDS", "60"))   # global poll tick
EMAIL_RETRY_INBOUND_MINUTES = int(os.getenv("EMAIL_RETRY_INBOUND_MINUTES", "10"))   # failed‑row sweep
EMAIL_MAX_MESSAGE_BYTES = int(os.getenv("EMAIL_MAX_MESSAGE_BYTES", str(25 * 1024 * 1024)))  # 25MB cap
EMAIL_MAX_INBOUND_ATTEMPTS = int(os.getenv("EMAIL_MAX_INBOUND_ATTEMPTS", "5"))
EMAIL_SYSTEM_ACTOR_USERNAME = os.getenv("EMAIL_SYSTEM_ACTOR_USERNAME", "email-bot")  # audit actor

# OAuth2 (XOAUTH2 over IMAP) — one provider app, many mailboxes. Per‑channel we
# store only the granted tokens (encrypted). Leave blank to disable a provider.
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
MICROSOFT_OAUTH_CLIENT_ID = os.getenv("MICROSOFT_OAUTH_CLIENT_ID", "")
MICROSOFT_OAUTH_CLIENT_SECRET = os.getenv("MICROSOFT_OAUTH_CLIENT_SECRET", "")
MICROSOFT_OAUTH_TENANT = os.getenv("MICROSOFT_OAUTH_TENANT", "common")
EMAIL_OAUTH_REDIRECT_URI = os.getenv(
    "EMAIL_OAUTH_REDIRECT_URI", "http://localhost:8000/api/v1/itsm/email/oauth/callback/"
)

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "ticketing-local",
    }
}

FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
