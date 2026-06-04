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
} from '@nestjs/common';
import { Request } from 'express';
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('movements')
export class MovementsController {
  constructor(private readonly service: MovementsService) {}

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  create(@Body() dto: CreateMovementDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.create(dto, req.user.userId);
  }

  /** Crea un documento logístico (remito) multi-producto/multi-lote con código RLNE/RLNS. */
  @Post('documents')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createDocument(@Body() dto: CreateDocumentDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.createDocument(dto, req.user.userId);
  }

  /** Lista documentos logísticos (remitos). */
  @Get('documents')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findDocuments(@Query() query: { type?: string; from?: string; to?: string; search?: string }) {
    return this.service.findDocuments(query);
  }

  /** Documento enriquecido para impresión (nombres de producto, lote, depósito y pallets). */
  @Get('documents/:id/print')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findDocumentForPrint(@Param('id') id: string) {
    return this.service.findDocumentForPrint(id);
  }

  /** Detalle de un documento: cabecera + líneas (movimientos) + detalle por palet. */
  @Get('documents/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findDocument(@Param('id') id: string) {
    return this.service.findDocument(id);
  }

  /**
   * Solicita la anulación automática de un movimiento.
   * Genera un AdjustmentRequest compensatorio en PENDIENTE_APROBACION.
   * El MANAGER aprueba el ajuste → stock se corrige y el movimiento queda VOIDED.
   */
  @Post(':id/void')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  requestVoid(
    @Param('id') id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.requestVoid(id, req.user.userId);
  }

  /** Edita metadatos de cualquier movimiento con trazabilidad completa. */
  @Patch(':id/edit')
  @Roles('ADMIN', 'MANAGER')
  editMetadata(
    @Param('id') id: string,
    @Body() dto: RegularizeMovementDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.editMetadata(id, dto, req.user.userId);
  }

  @Patch(':id/regularize')
  @Roles('ADMIN', 'MANAGER')
  regularize(
    @Param('id') id: string,
    @Body() dto: RegularizeMovementDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.regularize(id, dto, req.user.userId);
  }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query() query: MovementsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
