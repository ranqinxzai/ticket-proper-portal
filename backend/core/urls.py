from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)


def healthz(_request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/healthz", healthz),
    path("api/v1/", include("apps.accounts.urls")),
    # ── ITSM platform (rebuild) — wired as each app is built ─────────────────
    path("api/v1/itsm/", include("apps.itsm_core.urls")),
    path("api/v1/itsm/", include("apps.itsm_rbac.urls")),
    path("api/v1/itsm/", include("apps.itsm_helpdesks.urls")),
    # OpenAPI schema + Swagger UI
    path("api/v1/itsm/schema/", SpectacularAPIView.as_view(), name="itsm-schema"),
    path(
        "api/v1/itsm/docs/",
        SpectacularSwaggerView.as_view(url_name="itsm-schema"),
        name="itsm-docs",
    ),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
