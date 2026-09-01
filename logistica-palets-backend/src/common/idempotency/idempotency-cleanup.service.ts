import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { IDEMPOTENCY_TTL_HOURS, IdempotencyKey } from './idempotency-key.entity';

/**
 * Purga las claves vencidas.
 *
 * Sin esto la tabla crece una fila por cada escritura del sistema y nunca baja:
 * a los pocos años sería la tabla más grande de la base, guardando respuestas
 * que ya nadie va a reintentar.
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgarVencidas(): Promise<void> {
    const corte = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
    try {
      const { affected } = await this.repo.delete({ createdAt: LessThan(corte) });
      if (affected) this.logger.log(`Claves de idempotencia purgadas: ${affected}`);
    } catch (error) {
      // Es mantenimiento: que falle no debe tumbar el proceso ni el cron.
      this.logger.warn(`No se pudieron purgar las claves de idempotencia: ${String(error)}`);
    }
  }
}
