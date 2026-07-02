#!/usr/bin/env bash
# Wire onedesk.1learn.ai into the running edge nginx (onemedehr-nginx-1) WITHOUT
# touching its persistent config. Safe + idempotent. Re-run after any full
# recreate of the onemedehr (edge) stack OR the ticketprod stack.
# Requires the Let's Encrypt cert for onedesk.1learn.ai to already exist in the
# onemedehr_certbot-certs volume (issue it via the onemedehr certbot service).
set -euo pipefail

EDGE=onemedehr-nginx-1
NET=ticketprod_default
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> attaching $EDGE to $NET (if not already)"
docker network connect "$NET" "$EDGE" 2>/dev/null && echo "   connected" || echo "   already connected"

echo "==> copying onedesk.conf into $EDGE"
docker cp "$HERE/onedesk.conf" "$EDGE:/etc/nginx/conf.d/onedesk.conf"

echo "==> validating config"
docker exec "$EDGE" nginx -t

echo "==> graceful reload"
docker exec "$EDGE" nginx -s reload
echo "==> done. https://onedesk.1learn.ai should be live."
