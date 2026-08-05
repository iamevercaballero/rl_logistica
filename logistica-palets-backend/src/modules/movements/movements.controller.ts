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
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { RequestQuantityEditDto } from './dto/request-quantity-edit.dto';
import { TransferBatchDto } from './dto/transfer-batch.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { PreviewPlacementDto } from './dto/preview-placement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

const SNAPSHOT_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

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

  /**
   * Vista previa de cómo van a quedar armadas las pilas antes de confirmar
   * una entrada — no reserva nada, no escribe nada.
   */
  @Post('preview-placement')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  previewPlacement(@Body() dto: PreviewPlacementDto) {
    return this.service.previewPlacement(dto);
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
            cb(new BadRequestException('Formato no soportado. Usá un archivo .xlsx, .xls o .csv.'), false);
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
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createTransferBatch(@Body() dto: TransferBatchDto, @Req() req: Request & { user: { userId: string } }) {
    return this.service.createTransferBatch(dto, req.user.userId);
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
  findDocumentForPrint(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findDocumentForPrint(id);
  }

  /** Detalle de un documento: cabecera + líneas (movimientos) + detalle por palet. */
  @Get('documents/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findDocument(@Param('id', ParseUUIDPipe) id: string) {
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
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.requestVoid(id, req.user.userId);
  }

  /** Edita metadatos de cualquier movimiento con trazabilidad completa. */
  @Patch(':id/edit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  editMetadata(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegularizeMovementDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.editMetadata(id, dto, req.user.userId);
  }

  @Patch(':id/regularize')
  @Roles('ADMIN', 'MANAGER')
  regularize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegularizeMovementDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.regularize(id, dto, req.user.userId);
  }

  /** Desglose por lote (cantidades y pallets actuales) — usado por el editor de ajustes. */
  @Get(':id/lots')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  getLotsBreakdown(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getLotsBreakdown(id);
  }

  /**
   * Corrección de lotes/cantidades/pallets de una entrada posteada.
   * Renombres de lote se aplican directo (auditados); las diferencias de cantidad
   * generan solicitudes RLAI/RLAO en PENDIENTE_APROBACION (stock intacto hasta aprobar).
   */
  @Post(':id/request-quantity-edit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  requestQuantityEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestQuantityEditDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.requestQuantityEdit(id, dto, req.user.userId);
  }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query() query: MovementsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }
}
