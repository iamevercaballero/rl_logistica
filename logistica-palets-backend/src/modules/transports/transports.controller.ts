import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { RolesGuard } from '../auth/roles/roles.guard';
import { CreateTransportDto } from './dto/create-transport.dto';
import { RegisterInspectionDto, UpdateTransportDto } from './dto/update-transport.dto';
import { TransportsService } from './transports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('transports')
export class TransportsController {
  constructor(private readonly service: TransportsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll() {
    return this.service.findAll();
  }

  /** Historial de remitos (entradas/salidas) vinculados a la patente del vehículo. */
  @Get(':id/history')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  create(@Body() dto: CreateTransportDto) {
    return this.service.create(dto);
  }

  /** Registra una inspección en la bitácora del vehículo. */
  @Post(':id/inspection')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  inspect(
    @Param('id') id: string,
    @Body() dto: RegisterInspectionDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.inspect(id, dto, req.user.userId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTransportDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
