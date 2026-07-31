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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly service: AdjustmentsService) {}

  /** Crea un nuevo borrador de solicitud de ajuste (multi-producto). */
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createDraft(
    @Body() dto: CreateAdjustmentDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.createDraft(dto, req.user.userId);
  }

  /** Edita el borrador (solo mientras está en BORRADOR). */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdjustmentDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.updateDraft(id, dto, req.user.userId);
  }

  /** Envía el borrador a aprobación. */
  @Patch(':id/submit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.submitForApproval(id, req.user.userId);
  }

  /** Aprueba la solicitud → postea el stock (MANAGER / ADMIN). */
  @Patch(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.approve(id, req.user.userId);
  }

  /** Rechaza la solicitud → vuelve a BORRADOR con comentario (MANAGER / ADMIN). */
  @Patch(':id/reject')
  @Roles('ADMIN', 'MANAGER')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAdjustmentDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.reject(id, dto, req.user.userId);
  }

  /** Anula una solicitud no aprobada. */
  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.cancel(id, req.user.userId);
  }

  /** Lista solicitudes con filtros. */
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query() query: AdjustmentQueryDto) {
    return this.service.findAll(query);
  }

  /** Detalle de una solicitud con sus líneas. */
  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }
}
