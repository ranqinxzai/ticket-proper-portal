from django.apps import AppConfig


class ItsmAssetsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.itsm_assets"
    label = "itsm_assets"
    verbose_name = "ITSM Asset Management"

    def ready(self):
        from apps.itsm_core.scheduler_boot import should_run_scheduler
        if should_run_scheduler():
            from .scheduler import start_scheduler
            start_scheduler()
