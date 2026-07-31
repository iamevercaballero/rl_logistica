import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  MethodNotAllowedException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { Request } from 'express';
import { PalletsService } from './pallets.service';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

class QuickTransferDto {
  @IsUUID()
  toLocationId: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pallets')
export class PalletsController {
  constructor(private readonly service: PalletsService) {}

  // ── READ ──────────────────────────────────────────────────────────────────

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(
    @Query('lotId') lotId?: string,
    @Query('status') status?: string,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ lotId, status, productId, locationId, search });
  }

  /** KPI counts — must be before :id to avoid param collision */
  @Get('kpis')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  kpis() {
    return this.service.kpis();
  }

  /** Reconcilia estados inconsistentes de pallets existentes según su historial */
  @Post('reconcile-status')
  @Roles('ADMIN', 'MANAGER')
  reconcileStatuses() {
    return this.service.reconcileStatuses();
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/history')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(id);
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  create(@Body() dto: CreatePalletDto) {
    return this.service.create(dto);
  }

  /** Quick transfer: move a single pallet to a new location, records a TRANSFER movement */
  @Post(':id/transfer')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  quickTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuickTransferDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.quickTransfer(id, dto.toLocationId, req.user.userId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePalletDto) {
    return this.service.update(id, dto);
  }

  // DELETE deshabilitado — los pallets no se eliminan para preservar trazabilidad
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  remove(@Param('id', ParseUUIDPipe) _id: string) {
    throw new MethodNotAllowedException(
      'La eliminación de pallets está deshabilitada para preservar la trazabilidad',
    );
  }
}
