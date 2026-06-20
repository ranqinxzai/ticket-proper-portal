from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (
        ("QA", {"fields": ("full_name", "role")}),
    )
    list_display = ("username", "email", "full_name", "role", "is_active")
