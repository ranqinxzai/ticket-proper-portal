FROM nginx:alpine

RUN apk add --no-cache openssl

COPY entrypoint.sh /docker-entrypoint.d/00-ensure-placeholder-cert.sh
RUN chmod +x /docker-entrypoint.d/00-ensure-placeholder-cert.sh
