"""Validation/CI settings: same as prod but on a throwaway SQLite DB and with
schedulers off. Used to run migrate + seed + smoke tests without Postgres.
"""

from .settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": "/tmp/itsm_validate.sqlite3",
    }
}
RUN_SCHEDULER = False
