import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RefreshSession } from './entities/refresh-session.entity';

/**
 * Purga las sesiones de refresco vencidas.
 *
 * Una fila por login y por refresco: sin esto la tabla crece sin techo con
 * sesiones que ya nadie puede usar. Se borran las vencidas, revocadas o no —una
 * sesión expirada no aporta nada, ni siquiera para detectar reuso, porque el
 * token tampoco verificaría.
 *
 * Se da un día de gracia sobre el vencimiento para que una investigación
 * reciente todavía encuentre el rastro. La bitácora de `auth_events`, que sí es
 * append-only, conserva el registro de los ingresos.
 */
@Injectable()
export class RefreshSessionCleanupService {
  private readonly logger = new Logger(RefreshSessionCleanupService.name);

  constructor(
    @InjectRepository(RefreshSession)
    private readonly repo: Repository<RefreshSession>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgarVencidas(): Promise<void> {
    const corte = new Date(Date.now() - 24 * 60 * 60 * 1000);
    try {
      const { affected } = await this.repo.delete({ expiresAt: LessThan(corte) });
      if (affected) this.logger.log(`Sesiones de refresco purgadas: ${affected}`);
    } catch (error) {
      // Es mantenimiento: que falle no debe tumbar el proceso ni el cron.
      this.logger.warn(`No se pudieron purgar las sesiones de refresco: ${String(error)}`);
    }
  }
}
