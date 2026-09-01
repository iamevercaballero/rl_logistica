import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKey } from './idempotency-key.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

/**
 * Se importa en los módulos que tienen endpoints marcados con `@Idempotent()`.
 * No se registra como interceptor global: sólo aplica a un puñado de endpoints
 * y un interceptor global obligaría a resolver el repositorio en cada petición.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKey])],
  providers: [IdempotencyInterceptor, IdempotencyCleanupService],
  exports: [IdempotencyInterceptor, TypeOrmModule],
})
export class IdempotencyModule {}
