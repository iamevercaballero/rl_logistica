"""
Demand forecasting via Holt-Winters Exponential Smoothing.

Model selection by data availability:
  ≥ 21 obs → Holt-Winters (trend + additive weekly seasonality, period=7)
  ≥ 10 obs → Holt with trend, no seasonality
  ≥ 3  obs → Simple Exponential Smoothing (SES)
  < 3  obs → mean fallback

Confidence intervals: 80% CI using residual std scaled by √horizon
(sqrt rule for accumulating uncertainty over forecast horizon).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing, SimpleExpSmoothing

logger = logging.getLogger(__name__)

# z-score for 80 % two-sided confidence interval
_Z80: float = 1.282


def forecast_product(
    daily_data: List[Dict[str, Any]],  # [{"date": "YYYY-MM-DD", "exits": float}]
    horizon: int = 14,
) -> Dict[str, Any]:
    """
    Fit the best Exponential Smoothing variant and return a forecast dict:

    {
      "modelType": "holt-winters" | "holt-trend" | "ses" | "mean_fallback" | "no_data",
      "dataPoints": int,
      "avgDailyConsumption": float,
      "mae": float | None,
      "forecast": [{"date": str, "value": float, "lower": float, "upper": float}]
    }
    """
    if not daily_data:
        return _empty_result(horizon, n_obs=0)

    # ── Build complete daily time series (fill missing days with 0) ───────────
    df = pd.DataFrame(daily_data)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()

    full_idx = pd.date_range(df.index.min(), df.index.max(), freq="D")
    series: pd.Series = df["exits"].reindex(full_idx, fill_value=0.0).astype(float)

    n_obs: int = len(series)
    has_signal: bool = bool(series.sum() > 0)

    forecast_dates = [
        (date.today() + timedelta(days=i)).isoformat()
        for i in range(1, horizon + 1)
    ]

    if not has_signal or n_obs < 3:
        return _empty_result(horizon, n_obs)

    # ── Model selection ───────────────────────────────────────────────────────
    model_type = "ses"
    fitted = None

    try:
        if n_obs >= 21:
            model = ExponentialSmoothing(
                series,
                trend="add",
                seasonal="add",
                seasonal_periods=7,
                initialization_method="estimated",
            )
            fitted = model.fit(optimized=True, remove_bias=True)
            model_type = "holt-winters"

        elif n_obs >= 10:
            model = ExponentialSmoothing(
                series,
                trend="add",
                seasonal=None,
                initialization_method="estimated",
            )
            fitted = model.fit(optimized=True, remove_bias=True)
            model_type = "holt-trend"

        else:
            model = SimpleExpSmoothing(series, initialization_method="estimated")
            fitted = model.fit(optimized=True)
            model_type = "ses"

    except Exception as exc:  # noqa: BLE001
        logger.warning("Model fit failed, using mean fallback: %s", exc)
        avg = float(series.tail(14).mean())
        return _mean_fallback(avg, n_obs, forecast_dates)

    # ── Forecast ──────────────────────────────────────────────────────────────
    raw: np.ndarray = np.maximum(0.0, fitted.forecast(horizon).to_numpy())

    residuals: pd.Series = fitted.resid.dropna()
    resid_std: float = float(residuals.std()) if len(residuals) > 1 else 0.0
    mae: float | None = float(np.mean(np.abs(residuals))) if len(residuals) > 0 else None

    forecast_list: List[Dict[str, Any]] = []
    for i, (d, v) in enumerate(zip(forecast_dates, raw)):
        uncertainty = resid_std * np.sqrt(i + 1)  # grows with horizon
        lower = max(0.0, float(v) - _Z80 * uncertainty)
        upper = float(v) + _Z80 * uncertainty
        forecast_list.append(
            {
                "date": d,
                "value": round(float(v), 1),
                "lower": round(lower, 1),
                "upper": round(upper, 1),
            }
        )

    avg_consumption = float(series.mean())

    return {
        "modelType": model_type,
        "dataPoints": n_obs,
        "avgDailyConsumption": round(avg_consumption, 2),
        "mae": round(mae, 2) if mae is not None else None,
        "forecast": forecast_list,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _empty_result(horizon: int, n_obs: int) -> Dict[str, Any]:
    today = date.today()
    return {
        "modelType": "no_data",
        "dataPoints": n_obs,
        "avgDailyConsumption": 0.0,
        "mae": None,
        "forecast": [
            {"date": (today + timedelta(days=i)).isoformat(), "value": 0.0, "lower": 0.0, "upper": 0.0}
            for i in range(1, horizon + 1)
        ],
    }


def _mean_fallback(avg: float, n_obs: int, dates: List[str]) -> Dict[str, Any]:
    avg = max(0.0, avg)
    return {
        "modelType": "mean_fallback",
        "dataPoints": n_obs,
        "avgDailyConsumption": round(avg, 2),
        "mae": None,
        "forecast": [
            {"date": d, "value": round(avg, 1), "lower": round(avg * 0.8, 1), "upper": round(avg * 1.2, 1)}
            for d in dates
        ],
    }
