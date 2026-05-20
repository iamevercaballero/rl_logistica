import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  private readonly startedAt = Date.now();

  constructor(private readonly dataSource: DataSource) {}

  @Get()
  root() {
    return { ok: true, name: 'Logistica Palets API', time: new Date().toISOString() };
  }

  // Health check para load balancers / uptime monitors. Exento de rate limiting.
  @SkipThrottle()
  @Get('health')
  async health() {
    const checks: Record<string, { status: string; latencyMs?: number; note?: string }> = {};
    let status: 'ok' | 'error' = 'ok';

    const t0 = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      checks.database = { status: 'ok', latencyMs: Date.now() - t0 };
    } catch (e) {
      checks.database = {
        status: 'down',
        latencyMs: Date.now() - t0,
        note: e instanceof Error ? e.message : 'unknown error',
      };
      status = 'error';
    }

    const result = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      checks,
    };

    // 503 si algún check crítico falló (para que el monitor lo detecte).
    if (status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
