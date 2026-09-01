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
  UseInterceptors,
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
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

type AuthedRequest = Request & { user: AccessUser };

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UseInterceptors(IdempotencyInterceptor)
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
  @Idempotent()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('adjustments', 'create')
  createDraft(@Body() dto: CreateAdjustmentDto, @Req() req: AuthedRequest) {
    return this.service.createDraft(dto, req.user.userId, req.user.role);
  }

  /** Edita el borrador (solo mientras está en BORRADOR). */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('adjustments', 'update')
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
  @RequirePermission('adjustments', 'update')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.submitForApproval(id, req.user.userId, req.user.role);
  }

  /** Aprueba la solicitud → postea el stock (MANAGER / ADMIN). */
  @Patch(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('adjustments', 'approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.approve(id, req.user.userId, req.user.role);
  }

  /** Rechaza la solicitud → vuelve a BORRADOR con comentario (MANAGER / ADMIN). */
  @Patch(':id/reject')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('adjustments', 'approve')
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
  @RequirePermission('adjustments', 'approve')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.cancel(id, req.user.userId, req.user.role);
  }

  /** Lista solicitudes con filtros. */
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('adjustments', 'read')
  async findAll(@Query() query: AdjustmentQueryDto, @Req() req: AuthedRequest) {
    return this.service.findAll(
      query,
      await this.scopeOf(req, query.warehouseId),
      { userId: req.user.userId, role: req.user.role },
    );
  }

  /** Detalle de una solicitud con sus líneas. */
  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('adjustments', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findOne(id, req.user);
  }
}
