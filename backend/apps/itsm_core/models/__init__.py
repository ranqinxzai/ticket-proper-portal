"""Concrete ITSM-core models (AuditEvent, the field engine) land in later phases
alongside their FK dependencies (Ticket in P1, Project in P2). P0 ships only the
abstract bases below."""

from .base import (
    BaseModel,
    SoftDeleteManager,
    SoftDeleteModel,
    SoftDeleteQuerySet,
    TimeStampedModel,
    UUIDModel,
)

__all__ = [
    "BaseModel",
    "UUIDModel",
    "TimeStampedModel",
    "SoftDeleteModel",
    "SoftDeleteManager",
    "SoftDeleteQuerySet",
]
