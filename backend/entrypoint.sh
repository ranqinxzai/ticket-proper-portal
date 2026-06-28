#!/bin/sh
set -e

echo "[entrypoint] waiting for database ${DB_HOST}:${DB_PORT} ..."
python - <<'PY'
import os, socket, time, sys
host = os.environ.get("DB_HOST", "ticket-db")
port = int(os.environ.get("DB_PORT", "5432"))
deadline = time.time() + 60
while time.time() < deadline:
    try:
        with socket.create_connection((host, port), timeout=2):
            print(f"[entrypoint] db reachable at {host}:{port}")
            sys.exit(0)
    except OSError:
        time.sleep(1)
print("[entrypoint] db not reachable in time", file=sys.stderr)
sys.exit(1)
PY

echo "[entrypoint] running migrations (django-tenants: public + every org schema)"
# Shared apps in `public`, then TENANT apps in every org schema. Idempotent.
# NOTE: the one-time legacy single-tenant -> demo conversion
# (migrate_legacy_to_tenant) must already have been run before this fires on a
# DB that still holds pre-multitenancy data — see docs/QA_CHECKLIST.md.
python manage.py migrate_schemas --shared --noinput
python manage.py migrate_schemas --tenant --noinput

echo "[entrypoint] collecting static"
python manage.py collectstatic --noinput

echo "[entrypoint] starting gunicorn"
exec gunicorn core.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-3}" \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
