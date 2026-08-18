import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { AdjustmentsService } from './adjustments.service';
import {
  CreateAdjustmentDto,
  UpdateAdjustmentDto,
  RejectAdjustmentDto,
  AdjustmentQueryDto,
} from './dto/adjustment.dto';
import {
  WarehouseAccessService,
  type AccessUser,
  type WarehouseScope,
} from '../warehouses/warehouse-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

type AuthedRequest = Request & { user: AccessUser };

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('adjustments')
export class AdjustmentsController {
  constructor(
    private readonly service: AdjustmentsService,
    private readonly access: WarehouseAccessService,
  ) {}

  private async scopeOf(req: AuthedRequest, warehouseId?: string): Promise<WarehouseScope> {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return warehouseIds;
  }

  /** Crea un nuevo borrador de solicitud de ajuste (multi-producto). */
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createDraft(@Body() dto: CreateAdjustmentDto, @Req() req: AuthedRequest) {
    return this.service.createDraft(dto, req.user.userId, req.user.role);
  }

  /** Edita el borrador (solo mientras está en BORRADOR). */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdjustmentDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.updateDraft(id, dto, req.user.userId, req.user.role);
  }

  /** Envía el borrador a aprobación. */
  @Patch(':id/submit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.submitForApproval(id, req.user.userId, req.user.role);
  }

  /** Aprueba la solicitud → postea el stock (MANAGER / ADMIN). */
  @Patch(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.approve(id, req.user.userId, req.user.role);
  }

  /** Rechaza la solicitud → vuelve a BORRADOR con comentario (MANAGER / ADMIN). */
  @Patch(':id/reject')
  @Roles('ADMIN', 'MANAGER')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAdjustmentDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.reject(id, dto, req.user.userId, req.user.role);
  }

  /** Anula una solicitud no aprobada. */
  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.cancel(id, req.user.userId, req.user.role);
  }

  /** Lista solicitudes con filtros. */
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  async findAll(@Query() query: AdjustmentQueryDto, @Req() req: AuthedRequest) {
    return this.service.findAll(query, await this.scopeOf(req, query.warehouseId));
  }

  /** Detalle de una solicitud con sus líneas. */
  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findOne(id, req.user);
  }
}
