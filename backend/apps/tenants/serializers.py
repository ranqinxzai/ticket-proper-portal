from __future__ import annotations

from django.db import connection
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Client


class PlatformTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Login for platform super-admins (public schema).

    Deliberately does NOT use the ITSM user serializer — the public schema has no
    ITSM tables. The token gets ``tenant="public"`` so TenantAwareJWTAuthentication
    accepts it on the public console routes.
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["is_superuser"] = user.is_superuser
        token["tenant"] = connection.schema_name  # "public"
        token["platform"] = True
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.is_superuser:
            raise serializers.ValidationError("Not a platform administrator.")
        data["user"] = {
            "id": self.user.id,
            "username": self.user.username,
            "full_name": getattr(self.user, "full_name", "") or self.user.username,
            "is_superuser": self.user.is_superuser,
        }
        return data


class OrgSerializer(serializers.ModelSerializer):
    """Read / update view of an organisation (name + active toggle)."""

    login_url = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = ["id", "name", "schema_name", "is_active", "created_on", "login_url"]
        read_only_fields = ["id", "schema_name", "created_on", "login_url"]

    def get_login_url(self, obj) -> str:
        return f"/t/{obj.schema_name}/login"


class OrgCreateSerializer(serializers.Serializer):
    """Payload to provision a new organisation + its first admin."""

    name = serializers.CharField(max_length=120)
    slug = serializers.SlugField(max_length=31)
    admin_username = serializers.CharField(max_length=150)
    admin_password = serializers.CharField(write_only=True, min_length=8)
    admin_email = serializers.EmailField(required=False, allow_blank=True, default="")
    admin_full_name = serializers.CharField(required=False, allow_blank=True, default="")


class AdminPasswordResetSerializer(serializers.Serializer):
    """Reset an org user's password (run inside that org's schema)."""

    username = serializers.CharField(max_length=150)
    new_password = serializers.CharField(write_only=True, min_length=8)


class OrgUserCreateSerializer(serializers.Serializer):
    """Create a user inside an org's schema (from the console)."""

    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    full_name = serializers.CharField(required=False, allow_blank=True, default="")
    is_admin = serializers.BooleanField(required=False, default=False)


class OrgUserUpdateSerializer(serializers.Serializer):
    """Edit a user inside an org's schema. All fields optional (partial)."""

    email = serializers.EmailField(required=False, allow_blank=True)
    full_name = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)
    is_admin = serializers.BooleanField(required=False)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True)

    def validate_password(self, value):
        if value and len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters.")
        return value
