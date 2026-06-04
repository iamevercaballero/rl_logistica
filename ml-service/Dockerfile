# ── Build stage ───────────────────────────────────────────────────────────────
# python:3.12-slim has no gcc by default; statsmodels/numpy ship pre-built
# wheels for linux/amd64 on PyPI, so no compiler is needed for those.
FROM python:3.12-slim AS base

WORKDIR /app

# Pin pip to avoid resolver regressions
RUN pip install --no-cache-dir --upgrade pip==24.3.1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 8000

# 2 workers: one handles requests while the other fits a model.
# Do NOT use --reload in production.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--log-level", "info"]
