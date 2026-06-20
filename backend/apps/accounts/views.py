from django.contrib.auth import authenticate, login, logout
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User
from .serializers import UserSerializer


class IsStaffOrSelfReadOnly(permissions.BasePermission):
    """Staff users manage everyone; non-staff can read & edit only themselves."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        # Anyone authenticated can POST /users/ only if staff.
        if view.action in {"create", "destroy"}:
            return bool(request.user and request.user.is_authenticated and request.user.is_staff)
        # update/partial_update: allow; object-level check handles it
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if request.user.is_staff:
            return True
        return obj.pk == request.user.pk


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("id")
    serializer_class = UserSerializer
    permission_classes = [IsStaffOrSelfReadOnly]
    filterset_fields = ["is_active", "role", "is_staff"]
    search_fields = ["username", "email", "full_name"]

    @action(detail=False, methods=["get"])
    def me(self, request):
        if not request.user.is_authenticated:
            return Response({"detail": "anonymous"}, status=401)
        return Response(UserSerializer(request.user).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.pk == request.user.pk:
            return Response({"detail": "You cannot delete your own account."},
                            status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class LoginView(APIView):
    def post(self, request):
        username = (request.data.get("username") or request.data.get("email") or "").strip()
        password = request.data.get("password") or ""
        if not username or not password:
            return Response({"detail": "Username and password are required."}, status=status.HTTP_400_BAD_REQUEST)
        user = authenticate(request, username=username, password=password)
        if user is None:
            candidate = User.objects.filter(email__iexact=username).first()
            if candidate:
                user = authenticate(request, username=candidate.username, password=password)
        if user is None:
            return Response({"detail": "Invalid username or password."}, status=status.HTTP_401_UNAUTHORIZED)
        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({"status": "ok"})


class MeView(APIView):
    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"detail": "anonymous"}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(UserSerializer(request.user).data)
