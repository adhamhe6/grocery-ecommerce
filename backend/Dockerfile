# syntax=docker/dockerfile:1.7
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# No system packages are needed: every Python dependency ships as a binary wheel (psycopg[binary], Pillow, argon2-cffi).
COPY requirements/base.txt requirements/base.txt
RUN pip install -r requirements/base.txt

RUN useradd --system --uid 10001 --create-home app \
 && mkdir -p /data/media /app/staticfiles \
 && chown -R app:app /data /app
COPY --chown=app:app . .

USER app
ENV DJANGO_SETTINGS_MODULE=config.settings.prod MEDIA_ROOT=/data/media

# Static files are collected at build time with throwaway settings values (nothing here is a secret or reaches the image).
RUN DJANGO_SECRET_KEY=build-only-not-a-secret-build-only-not-a-secret-0000 DJANGO_ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--threads", "2", "--timeout", "30", "--access-logfile", "-", "--max-requests", "2000", "--max-requests-jitter", "200"]
