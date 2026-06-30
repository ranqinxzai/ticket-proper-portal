import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
DEBUG = os.getenv("DEBUG", "True").lower() == "true"
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")]

# ── Multi-tenancy (django-tenants, schema-per-org) ──────────────────────────
# The app is served to many independent organisations from ONE instance. Each
# org gets its own Postgres schema (hard two-way data isolation). Routing is by
# URL path (/t/<slug>/…) via apps.tenants.middleware.PathTenantMiddleware, NOT
# by hostname — so we do NOT use django-tenants' TenantMainMiddleware.
#
#   SHARED_APPS  → tables live in the `public` schema.
#   TENANT_APPS  → tables are cloned into every org schema.
#   INSTALLED_APPS = SHARED + (TENANT - SHARED)   (django-tenants convention)
#
# `apps.accounts` (the AUTH_USER_MODEL) is in BOTH: the public copy holds ONLY
# platform super-admins (who run the provisioning console); each org schema has
# its own users. No org/business data ever lives in `public`.

SHARED_APPS = [
    "django_tenants",                 # must be first
    "apps.tenants",                   # Client + Domain (the org registry)
    # Django framework (also in TENANT_APPS → each schema gets its own copy)
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.admin",
    "django.contrib.staticfiles",
    # Third-party infra (no per-tenant tables — shared is fine)
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "django_filters",
    "corsheaders",
    "django_apscheduler",             # ONE global scheduler job store (public)
    # Platform identity: public users table = platform super-admins only
    "apps.accounts.apps.AccountsConfig",
]

TENANT_APPS = [
    # Framework tables that must exist per-schema
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.admin",
    # Per-org identity + all business apps
    "apps.accounts.apps.AccountsConfig",
    "apps.core.apps.CoreConfig",
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
    # Email channel: inbound mail → tickets/comments; outbound via mailbox SMTP.
    "apps.itsm_email.apps.ItsmEmailConfig",
    "apps.itsm_reporting.apps.ItsmReportingConfig",
    "apps.itsm_dashboards.apps.ItsmDashboardsConfig",
    # New modules — P6: approvals.  P4: catalog.  P5: knowledge base.
    "apps.itsm_approvals.apps.ItsmApprovalsConfig",
    "apps.itsm_catalog.apps.ItsmCatalogConfig",
    "apps.itsm_knowledge.apps.ItsmKnowledgeConfig",
]

INSTALLED_APPS = list(SHARED_APPS) + [a for a in TENANT_APPS if a not in SHARED_APPS]

# ── Test mode: flatten the schema split ─────────────────────────────────────
# The existing unit suite uses plain django.test.TestCase and exercises tenant
# models in a single schema. Under django-tenants the test DB's public schema
# would lack the tenant tables, so we make every app SHARED for tests → all
# tables live in the test DB's public schema and the existing tests run
# unchanged. Tenant ISOLATION is verified separately by the integration
# rehearsal (real schemas), not by these unit tests.
import sys  # noqa: E402

if "test" in sys.argv:
    # Make every app SHARED (tables in public). TENANT_APPS must stay non-empty
    # (django-tenants enforces this), and overlap with SHARED is fine.
    SHARED_APPS = INSTALLED_APPS

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

MIDDLEWARE = [
    # FIRST: resolve org from the /t/<slug>/ URL path and switch the Postgres
    # schema before anything touches the DB. Replaces django-tenants'
    # hostname-based TenantMainMiddleware (we route by path, not subdomain).
    "apps.tenants.middleware.PathTenantMiddleware",
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
        # django-tenants backend: manages search_path per request/schema.
        "ENGINE": "django_tenants.postgresql_backend",
        "NAME": os.getenv("DB_NAME", "ticketing_pilot"),
        "USER": os.getenv("DB_USER", "postgres"),
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
    }
}

# Routes migrations/queries to the right schema (shared vs tenant apps).
DATABASE_ROUTERS = ("django_tenants.routers.TenantSyncRouter",)

# The org registry models (in apps.tenants, a SHARED app).
TENANT_MODEL = "tenants.Client"
TENANT_DOMAIN_MODEL = "tenants.Domain"

AUTH_USER_MODEL = "accounts.User"

# Case-insensitive login (email is case-insensitive per RFC 5321). Our custom
# backend resolves the login by username/email `__iexact` so `Shekhar@ticket.com`
# and `shekhar@ticket.com` are the same account; the default backend is kept as a
# fallback. Covers the ITSM JWT, platform-admin JWT, and legacy session logins.
AUTHENTICATION_BACKENDS = [
    "apps.accounts.backends.CaseInsensitiveModelBackend",
    "django.contrib.auth.backends.ModelBackend",
]

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

# Production DRF auth is JWT-ONLY. Only `TenantAwareJWTAuthentication` enforces the
# org binding (token's `tenant` claim == active schema); Session + Basic auth do
# NOT, so a stray session/basic credential would skip the cross-org guard. They're
# kept solely as a DEBUG convenience for the DRF browsable API. The frontends
# (tenant app + platform console) authenticate exclusively with JWT.
_AUTH_CLASSES = ["apps.tenants.auth.TenantAwareJWTAuthentication"]
if DEBUG:
    _AUTH_CLASSES += [
        "apps.accounts.auth.CsrfExemptSessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": _AUTH_CLASSES,
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
    "createsuperuser", "seed_itsm", "loaddata", "dumpdata", "poll_email_once",
    # ── django-tenants / provisioning one-offs (never start the scheduler) ──
    "migrate_schemas", "tenant_command", "all_tenants_command", "clone_tenant",
    "create_tenant", "delete_tenant",            # django-tenants' own commands
    "create_org", "delete_org", "create_platform_admin", "migrate_legacy_to_tenant",
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

EMAIL_DOMAIN = os.getenv("EMAIL_DOMAIN", "ticketing.local")          # synthetic Message‑ID host
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
# Canonical external base (scheme+host) for OAuth redirect URIs + the post-consent
# bounce back to the app. The per-org redirect becomes
# {PUBLIC_BASE_URL}/api/v1/t/<org>/itsm/email/oauth/callback/. Falls back to
# FRONTEND_BASE_URL (defined below) at runtime when unset.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "ticketing-local",
    }
}

FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
