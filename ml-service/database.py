"""
PostgreSQL async queries for the ML Forecast Service.
Reads movement history directly from the WMS database.
"""
import asyncpg
from datetime import date, timedelta
from typing import Dict, List, Optional


async def get_daily_exits_by_product(
    pool: asyncpg.Pool,
    lookback_days: int,
    product_id: Optional[str] = None,
) -> Dict[str, Dict]:
    """
    Query daily exit + adjustment_out quantities per product for the last
    `lookback_days` days, ignoring VOIDED movements.

    Returns:
        { productId: { meta: {...}, daily: [{"date": "YYYY-MM-DD", "exits": float}] } }
    """
    since: date = date.today() - timedelta(days=lookback_days)

    base_query = """
        SELECT
            DATE_TRUNC('day', m.date)::date       AS "date",
            p.id::text                             AS "productId",
            p.code                                 AS "code",
            p.description                          AS "description",
            p."unitOfMeasure"                      AS "unitOfMeasure",
            COALESCE(SUM(m.quantity), 0)::float    AS "exits"
        FROM products p
        INNER JOIN movements m
               ON  m."productId" = p.id
               AND m.date        >= $1
               AND m.type        IN ('EXIT', 'ADJUSTMENT_OUT')
               AND m."voidStatus" <> 'VOIDED'
        WHERE p.active = true
        {extra_filter}
        GROUP BY DATE_TRUNC('day', m.date), p.id, p.code, p.description, p."unitOfMeasure"
        ORDER BY p.code ASC, "date" ASC
    """

    if product_id:
        rows = await pool.fetch(
            base_query.format(extra_filter="AND p.id = $2::uuid"),
            since,
            product_id,
        )
    else:
        rows = await pool.fetch(
            base_query.format(extra_filter=""),
            since,
        )

    by_product: Dict[str, Dict] = {}
    for row in rows:
        pid: str = row["productId"]
        if pid not in by_product:
            by_product[pid] = {
                "meta": {
                    "productId": pid,
                    "code": row["code"],
                    "description": row["description"],
                    "unitOfMeasure": row["unitOfMeasure"],
                },
                "daily": [],
            }
        by_product[pid]["daily"].append(
            {"date": str(row["date"]), "exits": float(row["exits"])}
        )

    return by_product
