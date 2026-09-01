import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  private readonly startedAt = Date.now();
  private readonly logger = new Logger(AppController.name);

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
      // El mensaje del driver va al log, no a la respuesta (RL-M-04): este
      // endpoint no pide autenticación y está exento del límite de tasa, así
      // que devolvía a cualquiera el error crudo de PostgreSQL — que suele
      // nombrar el host, el usuario y la base. Para monitorear alcanza con
      // saber que está caída.
      this.logger.error(
        `Health check: la base no responde — ${e instanceof Error ? e.message : 'error desconocido'}`,
      );
      checks.database = { status: 'down', latencyMs: Date.now() - t0 };
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
