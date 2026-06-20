#!/bin/sh
# Generates a short-lived self-signed placeholder cert if the real
# Let's Encrypt cert for pilot-ticket.onemedai.org is not present yet. This
# lets nginx start cleanly on the very first boot (before certbot has
# run). Once certbot writes the real cert, a `nginx -s reload` picks it
# up on subsequent starts.
set -e

DOMAIN=pilot-ticket.onemedai.org
CERT_DIR=/etc/letsencrypt/live/$DOMAIN

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "[entrypoint] real cert present at $CERT_DIR, skipping placeholder"
    exit 0
fi

echo "[entrypoint] generating self-signed placeholder cert at $CERT_DIR"
mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -subj "/CN=$DOMAIN" \
    -keyout "$CERT_DIR/privkey.pem" \
    -out    "$CERT_DIR/fullchain.pem" 2>/dev/null
chmod 644 "$CERT_DIR/fullchain.pem"
chmod 600 "$CERT_DIR/privkey.pem"
