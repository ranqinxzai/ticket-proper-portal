#!/usr/bin/env bash
# Daily Let's Encrypt renewal for the edge certs. All certs (his.onemedai.org,
# md.1learn.ai, ohd.1learn.ai) live in the shared onemedehr certbot volumes and
# validate over the edge's default :80 ACME webroot, so a single `certbot renew`
# covers every domain. certbot only renews certs within 30 days of expiry, so
# this is a safe daily no-op until something is actually due. After renewal we
# graceful-reload the edge nginx so the fresh cert is served (zero downtime).
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ONEMEDEHR=/home/santhosh/apps/project/his/onemedehr
EDGE=onemedehr-nginx-1

echo "[renew-certs] $(date -Is) running certbot renew"
docker compose -f "$ONEMEDEHR/docker-compose.prod.yml" run --rm certbot renew

echo "[renew-certs] reloading edge nginx ($EDGE)"
docker exec "$EDGE" nginx -s reload

echo "[renew-certs] done"
