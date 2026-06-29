from rest_framework import serializers

from .models import AppKey, Role, User, default_app_access


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True,
                                     style={"input_type": "password"})
    app_access = serializers.ListField(
        child=serializers.ChoiceField(choices=AppKey.choices),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "full_name", "role",
            "is_active", "is_staff", "is_superuser",
            "app_access",
            "auth_method",
            "password",
        ]
        read_only_fields = ["id", "is_superuser"]

    def validate_app_access(self, value):
        # De-dup while preserving order
        seen = []
        for v in value:
            if v not in seen:
                seen.append(v)
        return seen

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        # Microsoft-SSO users authenticate via Entra, not a local password.
        is_sso = validated_data.get("auth_method") == "microsoft"
        if "app_access" not in validated_data:
            validated_data["app_access"] = default_app_access()
        user = User(**validated_data)
        if is_sso:
            user.set_unusable_password()
        else:
            if not password:
                raise serializers.ValidationError({"password": "Password is required."})
            user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        # auth_method is fixed at creation. Ignore changes here so this generic
        # endpoint (which the legacy self-service /users/ route uses) can't switch
        # a user to Microsoft — that would strip their password login with no SSO
        # set up and lock them out, and would break the "SSO user has no usable
        # password" invariant that create() enforces.
        validated_data.pop("auth_method", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance
