FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt \
 && pip install "gunicorn==22.0.0"

COPY . /app

RUN mkdir -p /app/staticfiles /app/media \
 && chmod +x /app/entrypoint.sh || true

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
