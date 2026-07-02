#!/usr/bin/env bash
# Wire ohd.1learn.ai into the running edge nginx (onemedehr-nginx-1) WITHOUT
# touching its persistent config. Safe + idempotent. Re-run after any full
# recreate of the onemedehr (edge) stack OR the ticketprod stack.
#
#   1) attach the edge nginx to the ticketprod docker network (so it can
#      resolve ticketprod-nginx)
#   2) copy this vhost into the container's conf.d
#   3) validate (nginx -t) and graceful-reload  (his.onemedai.org untouched)
set -euo pipefail

EDGE=onemedehr-nginx-1
NET=ticketprod_default
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> attaching $EDGE to $NET (if not already)"
docker network connect "$NET" "$EDGE" 2>/dev/null && echo "   connected" || echo "   already connected"

echo "==> copying ohd.conf into $EDGE"
docker cp "$HERE/ohd.conf" "$EDGE:/etc/nginx/conf.d/ohd.conf"

echo "==> validating config"
docker exec "$EDGE" nginx -t

echo "==> graceful reload"
docker exec "$EDGE" nginx -s reload
echo "==> done. https://ohd.1learn.ai should be live."
