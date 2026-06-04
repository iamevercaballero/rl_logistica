import { api } from "./client";

export type ForecastStatus = "OK" | "WARNING" | "LOW" | "CRITICAL" | "NO_DATA";

export type ForecastType = "ML" | "STATISTICAL";

export type MlModelType =
  | "holt-winters"
  | "holt-trend"
  | "ses"
  | "mean_fallback"
  | "fallback"
  | "no_data";

/** One forecast horizon day — includes 80% CI when ML is active. */
export type ForecastDay = {
  date: string;
  projectedStock: number; // current_stock minus cumulative demand up to this day
  demand: number;         // predicted daily consumption
  lower: number | null;   // 80% CI lower bound for demand (null = statistical)
  upper: number | null;   // 80% CI upper bound for demand (null = statistical)
};

export type ForecastRow = {
  product: {
    id: string;
    code: string;
    description: string;
    unitOfMeasure: string | null;
  };
  currentStock: number;
  avgDailyConsumption: number;
  avgDailyEntry: number;
  daysOfStock: number | null;
  projectedStockout: string | null;
  status: ForecastStatus;
  /** Whether forecast was produced by ML or simple moving average. */
  forecastType: ForecastType;
  mlModel: MlModelType | null;
  mlMae: number | null;          // Mean Absolute Error on training residuals
  mlDataPoints: number | null;   // Days of history the model was trained on
  forecast: ForecastDay[];
};

export type AnalyticsThroughputDay = {
  day: string;
  entries: number;
  exits: number;
  entryCount: number;
  exitCount: number;
};

export type AnalyticsTopProduct = {
  productId: string;
  code: string;
  description: string;
  totalVolume: number;
  movementCount: number;
  entries: number;
  exits: number;
};

export type AnalyticsDow = {
  dow: number;
  count: number;
  volume: number;
};

export type AnalyticsResponse = {
  range: "week" | "month";
  throughput: AnalyticsThroughputDay[];
  topProducts: AnalyticsTopProduct[];
  activityByDow: AnalyticsDow[];
};

export async function getAnalytics(range: "week" | "month" = "month") {
  const { data } = await api.get<AnalyticsResponse>("/reports/analytics", { params: { range } });
  return data;
}

export async function getForecast(params?: {
  productId?: string;
  warehouseId?: string;
  horizonDays?: number;
  lookbackDays?: number;
}) {
  const { data } = await api.get<ForecastRow[]>("/reports/forecast", { params });
  return data;
}
