from rest_framework import permissions


class HasAppAccess(permissions.BasePermission):
    """Require the request user to have access to a specific app key (e.g. 'qa', 'pm').

    Usage:
        class MyViewSet(viewsets.ModelViewSet):
            permission_classes = [HasAppAccess.for_app("pm")]
    """

    app_key: str = ""

    @classmethod
    def for_app(cls, key: str):
        return type(
            f"HasAppAccess_{key}",
            (cls,),
            {"app_key": key},
        )

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return self.app_key in (user.app_access or [])
