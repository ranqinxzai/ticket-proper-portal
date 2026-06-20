from django.apps import AppConfig


class ItsmNotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.itsm_notifications"
    label = "itsm_notifications"
    verbose_name = "ITSM Notifications"

    def ready(self):
        from apps.itsm_core.scheduler_boot import should_run_scheduler
        if should_run_scheduler():
            from .scheduler import start_scheduler
            start_scheduler()
