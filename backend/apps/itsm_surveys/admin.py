from django.contrib import admin

from .models import SurveyConfig, SurveyResponse


@admin.register(SurveyConfig)
class SurveyConfigAdmin(admin.ModelAdmin):
    list_display = ("__str__", "project", "is_default", "enabled", "trigger", "scale_type")
    list_filter = ("is_default", "enabled", "trigger", "scale_type")


@admin.register(SurveyResponse)
class SurveyResponseAdmin(admin.ModelAdmin):
    list_display = ("ticket", "project", "status", "scale_type", "rating",
                    "is_satisfied", "submitted_at")
    list_filter = ("status", "scale_type", "is_satisfied")
    raw_id_fields = ("ticket", "project", "requestor", "config")
