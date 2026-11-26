# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock /tmp/requirements.lock
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then PIP_CERT=/run/secrets/proxy_ca pip install --no-cache-dir -r /tmp/requirements.lock; else pip install --no-cache-dir -r /tmp/requirements.lock; fi
COPY --chown=1000:1000 . /app/scanner_service/
RUN useradd --create-home --uid 1000 scanner && mkdir -p /cache && chown 1000:1000 /cache
USER scanner
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SCANNER_MARKET_CACHE=/cache
EXPOSE 3002
CMD ["uvicorn", "scanner_service.app:app", "--host", "0.0.0.0", "--port", "3002", "--workers", "1"]
