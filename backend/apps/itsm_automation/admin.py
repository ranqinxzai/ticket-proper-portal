from django.contrib import admin

from .models import AutomationRule, AutomationRun


@admin.register(AutomationRule)
class AutomationRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "is_active", "order", "run_count", "failure_count",
                    "last_run_at")
    list_filter = ("is_active",)
    raw_id_fields = ("project", "created_by")


@admin.register(AutomationRun)
class AutomationRunAdmin(admin.ModelAdmin):
    list_display = ("rule", "ticket", "event", "status", "created_at")
    list_filter = ("status", "event")
    raw_id_fields = ("rule", "ticket")
