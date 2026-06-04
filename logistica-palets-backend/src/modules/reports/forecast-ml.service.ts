import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/* ── ML model types returned by the Python service ─────────────────────────── */
export type MlModelType =
  | 'holt-winters'
  | 'holt-trend'
  | 'ses'
  | 'mean_fallback'
  | 'fallback'
  | 'no_data';

export interface MlForecastDay {
  date: string;
  value: number;   // predicted daily consumption
  lower: number;   // 80 % CI lower bound
  upper: number;   // 80 % CI upper bound
}

export interface MlProductForecast {
  productId: string;
  code: string;
  description: string;
  unitOfMeasure: string | null;
  modelType: MlModelType;
  dataPoints: number;
  avgDailyConsumption: number;
  mae: number | null;
  forecast: MlForecastDay[];
}

/* ── Service ─────────────────────────────────────────────────────────────── */
@Injectable()
export class ForecastMlService {
  private readonly logger = new Logger(ForecastMlService.name);

  /** Base URL for the Python FastAPI service. */
  private readonly mlServiceUrl: string;

  /** Max ms to wait before falling back to statistical forecast. */
  private readonly TIMEOUT_MS = 8_000;

  constructor(private readonly config: ConfigService) {
    this.mlServiceUrl =
      this.config.get<string>('ML_SERVICE_URL') ?? 'http://ml-service:8000';
  }

  /**
   * Quick liveness check — used to decide whether to attempt a predict call.
   * Times out after 2 s so it never blocks the main request path.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.mlServiceUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Request demand forecasts from the Python ML service.
   *
   * @returns Map(productId → MlProductForecast), or null when the service
   *          is unavailable or times out (caller falls back to statistical).
   */
  async predict(params: {
    productId?: string;
    horizonDays: number;
    lookbackDays: number;
  }): Promise<Map<string, MlProductForecast> | null> {
    try {
      const url = new URL(`${this.mlServiceUrl}/predict`);
      url.searchParams.set('horizonDays', String(params.horizonDays));
      // Request at least 60 days of history so Holt-Winters has enough data
      url.searchParams.set('lookbackDays', String(Math.max(params.lookbackDays, 60)));
      if (params.productId) url.searchParams.set('productId', params.productId);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(this.TIMEOUT_MS),
      });

      if (!res.ok) {
        this.logger.warn(`ML service HTTP ${res.status} — falling back to statistical`);
        return null;
      }

      const raw = (await res.json()) as Record<string, MlProductForecast>;
      if (typeof raw !== 'object' || raw === null) return null;

      this.logger.debug(`ML forecast received for ${Object.keys(raw).length} products`);
      return new Map(Object.entries(raw));
    } catch (err) {
      this.logger.warn(
        `ML service unavailable (${(err as Error).message}) — statistical fallback active`,
      );
      return null;
    }
  }
}
