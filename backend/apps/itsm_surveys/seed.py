"""Seed the global default CSAT survey config + provision per-project copies.

The single ``is_default`` row (project NULL) is the out-of-box template + fallback.
Each project gets its OWN editable clone via ``ensure_survey_config`` (called from
``ProjectViewSet.perform_create`` and ``backfill_survey_configs``) so editing one
project never affects another. Surveys ship **disabled** — an admin opts in per
project from the Survey settings tab. All idempotent.
"""

from __future__ import annotations

# Fields copied from the default template into each project clone.
_CLONE_FIELDS = (
    "enabled", "trigger", "scale_type", "question_text", "intro_text", "scale_labels",
    "comment_enabled", "comment_prompt", "comment_required", "thank_you_text",
    "email_subject", "email_body_html",
)


def run():
    """Create/refresh the global default SurveyConfig (project NULL, is_default)."""
    from .models import SurveyConfig

    default = SurveyConfig.objects.filter(is_default=True, is_deleted=False).first()
    created = default is None
    if created:
        SurveyConfig.objects.create(is_default=True, enabled=False)
    return {"default_config": "created" if created else "exists"}


def ensure_survey_config(project):
    """Ensure `project` has its own survey config — a clone of the global default.
    Idempotent: returns the existing config if present. Self-heals if the default
    is missing."""
    from .models import SurveyConfig

    existing = SurveyConfig.objects.filter(project=project, is_deleted=False).first()
    if existing:
        return existing

    default = SurveyConfig.objects.filter(is_default=True, is_deleted=False).first()
    if default is None:  # self-heal if called before the default seed
        run()
        default = SurveyConfig.objects.filter(is_default=True, is_deleted=False).first()

    values = {f: getattr(default, f) for f in _CLONE_FIELDS} if default else {}
    return SurveyConfig.objects.create(project=project, is_default=False, **values)


def backfill_survey_configs():
    """Provision a per-project survey config for every existing project. Idempotent."""
    from apps.itsm_projects.models import Project

    from .models import SurveyConfig

    projects = 0
    created = 0
    for project in Project.objects.filter(is_deleted=False):
        had = SurveyConfig.objects.filter(project=project, is_deleted=False).exists()
        ensure_survey_config(project)
        projects += 1
        if not had:
            created += 1
    return {"projects": projects, "configs_created": created}
