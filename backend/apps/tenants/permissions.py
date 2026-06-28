from rest_framework.permissions import BasePermission


class IsPlatformAdmin(BasePermission):
    """A platform super-admin (public-schema superuser).

    Console routes run in the public schema, so ``request.user`` here is a public
    user resolved by TenantAwareJWTAuthentication (whose token carries
    ``tenant="public"``). Org users' tokens are rejected before this check.
    """

    message = "Platform administrator access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_superuser)
