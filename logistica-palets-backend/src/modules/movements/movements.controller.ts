import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Request } from 'express';
import { MovementsService } from './movements.service';
import {
  WarehouseAccessService,
  type AccessUser,
  type WarehouseScope,
} from '../warehouses/warehouse-access.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { RequestQuantityEditDto } from './dto/request-quantity-edit.dto';
import { TransferBatchDto } from './dto/transfer-batch.dto';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { PreviewPlacementDto } from './dto/preview-placement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

const SNAPSHOT_EXTENSIONS = ['.xlsx', '.csv'];

type AuthedRequest = Request & { user: AccessUser };

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UseInterceptors(IdempotencyInterceptor)
@Controller('movements')
export class MovementsController {
  constructor(
    private readonly service: MovementsService,
    private readonly access: WarehouseAccessService,
  ) {}

  /**
   * Alcance de depósitos del usuario para las consultas. El `warehouseId` del
   * query es el depósito activo del frontend (una preferencia), nunca una
   * autorización: si no tiene acceso, esto lanza 403.
   */
  private async scopeOf(req: AuthedRequest, warehouseId?: string): Promise<WarehouseScope> {
    const { warehouseIds } = await this.access.resolveQueryScope(req.user, warehouseId);
    return warehouseIds;
  }

  @Post()
  @Idempotent()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'create')
  create(@Body() dto: CreateMovementDto, @Req() req: AuthedRequest) {
    return this.service.create(dto, req.user.userId, req.user.role);
  }

  /** Crea un documento logístico (remito) multi-producto/multi-lote con código RLNE/RLNS. */
  @Post('documents')
  @Idempotent()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'create')
  createDocument(@Body() dto: CreateDocumentDto, @Req() req: AuthedRequest) {
    return this.service.createDocument(dto, req.user.userId, req.user.role);
  }

  /**
   * Vista previa de cómo van a quedar armadas las pilas antes de confirmar
   * una entrada — no reserva nada, no escribe nada.
   */
  @Post('preview-placement')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'create')
  previewPlacement(@Body() dto: PreviewPlacementDto, @Req() req: AuthedRequest) {
    return this.service.previewPlacement(dto, req.user);
  }

  /**
   * Snapshot de stock inicial CON lotes reales (código de lote de proveedor,
   * lote SAP, vencimiento). Si un código no existe en el catálogo, se crea el
   * producto automáticamente (apilable por defecto). `commit=false` (default)
   * solo calcula y devuelve el resultado.
   */
  @Post('stock-snapshot/from-lots')
  @Roles('ADMIN')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'stock', maxCount: 1 }],
      {
        storage: memoryStorage(),
        limits: { fileSize: 20 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          if (!SNAPSHOT_EXTENSIONS.includes(ext)) {
            cb(new BadRequestException('Formato no soportado. Usá un archivo .xlsx o .csv.'), false);
            return;
          }
          cb(null, true);
        },
      },
    ),
  )
  stockSnapshotFromLots(
    @UploadedFiles() files: { stock?: Express.Multer.File[] },
    @Query('commit') commit: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    const stock = files.stock?.[0];
    if (!stock) throw new BadRequestException('Se requiere el archivo de stock.');
    return this.service.stockSnapshotFromLotList(stock.buffer, req.user.userId, commit === 'true');
  }

  /**
   * Revierte los ajustes creados por el snapshot de stock inicial (identificados
   * por `adjustmentCategory: 'CARGA_INICIAL'`). `commit=false` solo lista qué se
   * revertiría, sin tocar nada.
   */
  @Post('stock-snapshot/revert')
  @Roles('ADMIN')
  revertStockSnapshot(@Query('commit') commit: string) {
    return this.service.revertStockSnapshot(commit === 'true');
  }

  /** Transferencia multi-producto: N pallets de una ubicación a otra en una sola transacción. */
  @Post('transfer-batch')
  @Idempotent()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'create')
  createTransferBatch(@Body() dto: TransferBatchDto, @Req() req: AuthedRequest) {
    return this.service.createTransferBatch(dto, req.user.userId, req.user.role);
  }

  /** Lista documentos logísticos (remitos) — es la Bitácora. */
  @Get('documents')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('bitacora', 'read')
  async findDocuments(
    @Query() query: { type?: string; from?: string; to?: string; search?: string; warehouseId?: string },
    @Req() req: AuthedRequest,
  ) {
    return this.service.findDocuments(query, await this.scopeOf(req, query.warehouseId));
  }

  /** Documento enriquecido para impresión (nombres de producto, lote, depósito y pallets). */
  @Get('documents/:id/print')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('bitacora', 'read')
  findDocumentForPrint(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findDocumentForPrint(id, req.user);
  }

  /**
   * CHECKLIST DE RECEPCIÓN DE INSUMOS — solo para Entradas (RLNE).
   * Devuelve todo resuelto para imprimir: el frontend no rearma relaciones
   * entre movimientos, lotes y pallets.
   */
  @Get('documents/:id/checklist')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('bitacora', 'read')
  findDocumentChecklist(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findDocumentChecklist(id, req.user);
  }

  /** Detalle de un documento: cabecera + líneas (movimientos) + detalle por palet. */
  @Get('documents/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('bitacora', 'read')
  findDocument(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findDocument(id, req.user);
  }

  /**
   * Solicita la anulación automática de un movimiento.
   * Genera un AdjustmentRequest compensatorio en PENDIENTE_APROBACION.
   * El MANAGER aprueba el ajuste → stock se corrige y el movimiento queda VOIDED.
   */
  @Post(':id/void')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'update')
  requestVoid(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.requestVoid(id, req.user.userId, req.user.role);
  }

  /** Edita metadatos de cualquier movimiento con trazabilidad completa. */
  @Patch(':id/edit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'update')
  editMetadata(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegularizeMovementDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.editMetadata(id, dto, req.user.userId, req.user.role);
  }

  @Patch(':id/regularize')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('movements', 'approve')
  regularize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegularizeMovementDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.regularize(id, dto, req.user.userId, req.user.role);
  }

  /** Desglose por lote (cantidades y pallets actuales) — usado por el editor de ajustes. */
  @Get(':id/lots')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('movements', 'read')
  getLotsBreakdown(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.getLotsBreakdown(id, req.user);
  }

  /**
   * Corrección de lotes/cantidades/pallets de una entrada posteada.
   * Renombres de lote se aplican directo (auditados); las diferencias de cantidad
   * generan solicitudes RLAI/RLAO en PENDIENTE_APROBACION (stock intacto hasta aprobar).
   */
  @Post(':id/request-quantity-edit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @RequirePermission('movements', 'update')
  requestQuantityEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestQuantityEditDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.requestQuantityEdit(id, dto, req.user.userId, req.user.role);
  }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('movements', 'read')
  async findAll(@Query() query: MovementsQueryDto, @Req() req: AuthedRequest) {
    return this.service.findAll(query, await this.scopeOf(req, query.warehouseId));
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('movements', 'read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.findOne(id, req.user);
  }
}
