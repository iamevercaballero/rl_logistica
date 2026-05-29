import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { LotsService } from './lots.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lots')
export class LotsController {
  constructor(private readonly service: LotsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(
    @Query('productId') productId?: string,
    @Query('sapLot') sapLot?: string,
    @Query('includePallets') includePallets?: string,
  ) {
    return this.service.findAll(productId, sapLot, includePallets === 'true');
  }

  /** FEFO: lotes con stock disponible ordenados por vencimiento próximo.
   *  Filtra por productId, sapLot, o locationId (para selección de pallets en transferencias). */
  @Get('fefo')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  fefo(
    @Query('productId') productId?: string,
    @Query('sapLot') sapLot?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.findFefo(productId, sapLot, locationId);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(@Body() dto: CreateLotDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateLotDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** Reconcilia stockActual de un lote específico desde sus pallets reales. */
  @Post(':id/reconcile')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  reconcile(@Param('id') id: string) {
    return this.service.reconcileStock(id);
  }

  /** Reconcilia stockActual de todos los lotes (o de un producto). Solo reporta correcciones. */
  @Post('reconcile-all')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  reconcileAll(@Query('productId') productId?: string) {
    return this.service.reconcileAllStocks(productId);
  }
}
