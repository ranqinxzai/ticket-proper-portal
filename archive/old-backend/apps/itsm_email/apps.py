from django.apps import AppConfig


class ItsmEmailConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.itsm_email"
    label = "itsm_email"
    verbose_name = "ITSM Email Channel"

    def ready(self):
        from apps.itsm_core.scheduler_boot import should_run_scheduler

        if should_run_scheduler():
            from .scheduler import start_scheduler

            start_scheduler()
