"""
RL Logística — ML Forecast Service
===================================
FastAPI microservice providing demand forecasting via Holt-Winters
Exponential Smoothing, trained on PostgreSQL movement history.

Endpoints:
  GET /health          → liveness check
  GET /predict         → forecast demand per product (all or single)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

import asyncpg
from fastapi import FastAPI, HTTPException, Query, Request

from database import get_daily_exits_by_product
from forecaster import forecast_product

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("ml-service")


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to PostgreSQL at %s:%s/%s …",
                os.getenv("DB_HOST", "db"),
                os.getenv("DB_PORT", "5432"),
                os.getenv("DB_DATABASE", ""))
    app.state.pool = await asyncpg.create_pool(
        host=os.getenv("DB_HOST", "db"),
        port=int(os.getenv("DB_PORT", "5432")),
        user=os.getenv("DB_USERNAME", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_DATABASE", "rl_logistica"),
        min_size=1,
        max_size=4,
        command_timeout=15,
    )
    logger.info("DB pool ready — ML service is up.")
    yield
    await app.state.pool.close()
    logger.info("DB pool closed.")


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="RL Logística — ML Forecast Service",
    version="1.0.0",
    description="Demand forecasting with Holt-Winters Exponential Smoothing",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> Dict[str, str]:
    """Liveness endpoint — checked by NestJS before calling /predict."""
    return {"status": "ok", "service": "ml-forecast", "version": "1.0.0"}


@app.get("/predict")
async def predict(
    request: Request,
    product_id: Optional[str] = Query(
        None,
        alias="productId",
        description="UUID of a single product; omit to forecast all products with exits.",
    ),
    horizon_days: int = Query(
        14,
        alias="horizonDays",
        ge=1,
        le=90,
        description="Number of future days to forecast.",
    ),
    lookback_days: int = Query(
        60,
        alias="lookbackDays",
        ge=14,
        le=365,
        description="Number of historical days to use for training.",
    ),
) -> Dict[str, Any]:
    """
    Returns a dictionary keyed by productId, each value containing:
    {
      "productId", "code", "description", "unitOfMeasure",
      "modelType": "holt-winters"|"holt-trend"|"ses"|"mean_fallback"|"no_data",
      "dataPoints": int,
      "avgDailyConsumption": float,
      "mae": float | null,
      "forecast": [{"date", "value", "lower", "upper"}]
    }
    """
    pool: asyncpg.Pool = request.app.state.pool

    by_product = await get_daily_exits_by_product(pool, lookback_days, product_id)

    if not by_product:
        return {}

    result: Dict[str, Any] = {}
    for pid, data in by_product.items():
        try:
            fc = forecast_product(data["daily"], horizon=horizon_days)
            result[pid] = {**data["meta"], **fc}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Forecast failed for product %s: %s", pid, exc)
            # Emit a graceful fallback so one bad product doesn't kill the batch
            daily = data["daily"]
            avg = sum(d["exits"] for d in daily) / max(len(daily), 1)
            result[pid] = {
                **data["meta"],
                "modelType": "fallback",
                "dataPoints": len(daily),
                "avgDailyConsumption": round(avg, 2),
                "mae": None,
                "forecast": [],
            }

    return result
