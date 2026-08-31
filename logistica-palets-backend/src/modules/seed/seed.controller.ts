import {
  Controller, Post, Body, UseGuards, BadRequestException, Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { SeedService } from './seed.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('seed')
export class SeedController {
  private readonly logger = new Logger(SeedController.name);

  constructor(private readonly seedService: SeedService) {}

  /**
   * El seed y el reset borran o reescriben datos de inventario, así que exigen
   * `ALLOW_SEED=true` en **todos** los entornos, no sólo en producción.
   *
   * Antes la condición era `NODE_ENV === 'production' && ALLOW_SEED !== 'true'`,
   * que tenía dos agujeros: fuera de producción el endpoint quedaba abierto pasara
   * lo que pasara —poner `ALLOW_SEED=false` no servía de nada—, y bastaba con que
   * `NODE_ENV` no fuera exactamente "production" para habilitarlo en cualquier
   * lado. Ahora la única llave es la variable, y hay que ponerla a propósito.
   *
   * OJO: comparar contra 'true' explícito. `!process.env.ALLOW_SEED` sería false
   * cuando ALLOW_SEED="false" (string truthy), dejando el seed abierto.
   */
  private assertSeedAllowed(accion: string): void {
    if (process.env.ALLOW_SEED !== 'true') {
      throw new BadRequestException(
        `${accion} deshabilitado: requiere ALLOW_SEED=true. ` +
          'Es una operación destructiva sobre el inventario; habilitala sólo de forma deliberada.',
      );
    }
  }

  @Post('from-excel')
  @Roles('ADMIN')
  async seedFromExcel(@Body() body: { maxMovimientos?: number; soloProductos?: boolean }) {
    this.assertSeedAllowed('Seed');
    this.logger.log('Iniciando seed desde Excel...');
    return this.seedService.seedFromExcel(body.maxMovimientos ?? 300, body.soloProductos ?? false);
  }

  @Post('reset')
  @Roles('ADMIN')
  async reset() {
    this.assertSeedAllowed('Reset');
    this.logger.warn('Reset de datos solicitado (ALLOW_SEED=true).');
    return this.seedService.resetData();
  }
}
