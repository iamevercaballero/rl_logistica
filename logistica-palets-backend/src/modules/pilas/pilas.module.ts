import { Module } from '@nestjs/common';
import { PilasService } from './pilas.service';

/**
 * `PilasService` no inyecta repositorios propios — todos sus métodos operan
 * sobre el `EntityManager` transaccional que les pasa el caller (para poder
 * participar en la misma transacción que `createInTransaction`), así que
 * este módulo no necesita `TypeOrmModule.forFeature`.
 */
@Module({
  providers: [PilasService],
  exports: [PilasService],
})
export class PilasModule {}
