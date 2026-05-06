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

  @Post('from-excel')
  @Roles('ADMIN')
  async seedFromExcel(@Body() body: { maxMovimientos?: number; soloProductos?: boolean }) {
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) {
      throw new BadRequestException('Seed deshabilitado en producción. Setear ALLOW_SEED=true para habilitar.');
    }
    this.logger.log('Iniciando seed desde Excel...');
    return this.seedService.seedFromExcel(body.maxMovimientos ?? 300, body.soloProductos ?? false);
  }

  @Post('reset')
  @Roles('ADMIN')
  async reset() {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Reset deshabilitado en producción.');
    }
    return this.seedService.resetData();
  }
}
