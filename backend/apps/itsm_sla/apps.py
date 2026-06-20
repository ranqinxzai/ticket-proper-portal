from django.apps import AppConfig


class ItsmSlaConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.itsm_sla"
    label = "itsm_sla"
    verbose_name = "ITSM SLA"

    def ready(self):
        from apps.itsm_core.scheduler_boot import should_run_scheduler
        if should_run_scheduler():
            from .scheduler import start_scheduler
            start_scheduler()
