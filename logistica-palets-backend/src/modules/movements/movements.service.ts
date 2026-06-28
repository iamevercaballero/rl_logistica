import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { AdjustmentRequest } from '../adjustments/entities/adjustment-request.entity';
import { AdjustmentRequestLine } from '../adjustments/entities/adjustment-request-line.entity';
import { UploadsService } from '../uploads/uploads.service';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { RequestQuantityEditDto } from './dto/request-quantity-edit.dto';
import { TransferBatchDto } from './dto/transfer-batch.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { Movement, MovementType } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { LogisticsDocument } from './entities/logistics-document.entity';
import { RegularizationLog } from './entities/regularization-log.entity';
import { DocumentSequenceService } from './document-sequence.service';
import { Product } from '../products/entities/product.entity';
import { Location } from '../locations/entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Lot } from '../lots/entities/lot.entity';
import { normalizeLotCode } from '../lots/lots.service';
import { Pallet } from '../pallets/entities/pallet.entity';
import { DeepPartial } from 'typeorm/common/DeepPartial';
import { EventsGateway } from '../events/events.gateway';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class MovementsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventsGateway,
    private readonly cache: CacheService,
    private readonly sequences: DocumentSequenceService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Solicita la anulación de un movimiento ENTRY, EXIT, ADJUSTMENT_IN o ADJUSTMENT_OUT.
   * Genera automáticamente un AdjustmentRequest con la transacción compensatoria exacta
   * y lo deja en PENDIENTE_APROBACION para que el MANAGER apruebe.
   *
   * Al aprobar: stock se corrige y el movimiento original queda VOIDED.
   */
  async requestVoid(id: string, userId: string) {
    // ── 1. Cargar movimiento y sus detalles ──────────────────
    const movement = await this.dataSource.getRepository(Movement).findOne({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento no encontrado.');
    if (movement.voidStatus !== 'NONE') {
      throw new BadRequestException(
        movement.voidStatus === 'VOID_PENDING'
          ? 'Este movimiento ya tiene una solicitud de anulación pendiente de aprobación.'
          : 'Este movimiento ya fue anulado.',
      );
    }
    if (movement.type === 'TRANSFER') {
      throw new BadRequestException('Las transferencias no pueden anularse automáticamente. Usá el Ajuste de Inventario.');
    }

    const details = await this.dataSource.getRepository(MovementDetail).find({ where: { movementId: id } });

    // ── 2. Determinar tipo compensatorio ─────────────────────
    const isIncrease = ['ENTRY', 'ADJUSTMENT_IN'].includes(movement.type);
    const compensatingType = isIncrease ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';

    // ── 3. Verificar integridad de pallets (ENTRY: ¿ya salieron?) ───
    const warnings: string[] = [];
    if (isIncrease && details.length > 0) {
      const palletIds = details.map((d) => d.palletId).filter(Boolean) as string[];
      if (palletIds.length > 0) {
        const pallets = await this.dataSource.getRepository(Pallet).findByIds(palletIds);
        const consumed = pallets.filter((p) => p.status === 'EXITED');
        const partial = pallets.filter((p) => p.status === 'PARTIAL');
        if (consumed.length > 0) warnings.push(`${consumed.length} pallet(s) ya fueron despachados completamente.`);
        if (partial.length > 0) warnings.push(`${partial.length} pallet(s) tienen salidas parciales.`);
      }
    }

    // ── 4. Construir items compensatorios ────────────────────
    let palletItems: Array<{ palletId?: string; lotCode?: string; quantity: number; fechaVencimiento?: string; fechaFabricacion?: string; sapLot?: string }>;

    if (details.length > 0) {
      if (isIncrease) {
        // ENTRY void → ADJUSTMENT_OUT usando los palletIds originales
        palletItems = details
          .filter((d) => d.palletId && d.quantity > 0)
          .map((d) => ({ palletId: d.palletId!, quantity: d.quantity }));
      } else {
        // EXIT void → ADJUSTMENT_IN usando los lotes originales
        const lotIds = [...new Set(details.map((d) => d.lotId).filter(Boolean))] as string[];
        const lots = lotIds.length > 0
          ? await this.dataSource.getRepository(Lot).findByIds(lotIds)
          : [];
        const lotMap = Object.fromEntries(lots.map((l) => [l.id, l]));
        palletItems = details
          .filter((d) => d.lotId && d.quantity > 0)
          .map((d) => {
            const lot = lotMap[d.lotId!];
            return {
              lotCode: lot?.lotCode ?? `LOT-VOID-${d.lotId?.slice(0, 8)}`,
              quantity: d.quantity,
              fechaVencimiento: lot?.fechaVencimiento ?? undefined,
              fechaFabricacion: lot?.fechaFabricacion ?? undefined,
              sapLot: lot?.sapLot ?? undefined,
            };
          });
      }
    } else {
      // Movimiento sin detalles de pallets (solo cantidad global)
      if (isIncrease) {
        // Sin palletId disponible → solo reducción de stock por cantidad
        palletItems = [{ quantity: movement.quantity }];
      } else {
        // EXIT sin detalle → ADJUSTMENT_IN con lote si existe, sino solo cantidad
        const lot = movement.lotId
          ? await this.dataSource.getRepository(Lot).findOne({ where: { id: movement.lotId } })
          : null;
        palletItems = [{
          lotCode: lot?.lotCode ?? `LOT-VOID-${id.slice(0, 8)}`,
          quantity: movement.quantity,
          fechaVencimiento: lot?.fechaVencimiento ?? undefined,
          sapLot: lot?.sapLot ?? undefined,
        }];
      }
    }

    if (palletItems.length === 0 || palletItems.every((i) => i.quantity === 0)) {
      throw new BadRequestException('No se pudo determinar la cantidad a compensar. Revisá el movimiento.');
    }

    // ── 5. Crear AdjustmentRequest en una transacción ────────
    const result = await this.dataSource.transaction(async (manager) => {
      const code = await this.sequences.nextCode(manager, compensatingType);

      const request = manager.create(AdjustmentRequest, {
        code,
        type: compensatingType,
        status: 'PENDIENTE_APROBACION',
        reason: 'DIFERENCIA_INVENTARIO',
        notes: `Anulación automática de ${movement.type} del ${new Date(movement.date).toLocaleDateString('es-PY')}${movement.documentNumber ? ` · MIC/Fac/Rem. ${movement.documentNumber}` : ''}`,
        warehouseId: movement.warehouseId ?? null,
        locationId: movement.locationId ?? null,
        originalMovementId: id,
        createdById: userId,
        totalLines: 1,
        totalQuantity: palletItems.reduce((s, i) => s + i.quantity, 0),
      });
      await manager.save(request);

      const line = manager.create(AdjustmentRequestLine, {
        requestId: request.id,
        productId: movement.productId,
        palletItemsJson: JSON.stringify(palletItems),
        totalQuantity: palletItems.reduce((s, i) => s + i.quantity, 0),
        locationId: movement.locationId ?? null,
      });
      await manager.save(line);

      // Marcar movimiento como VOID_PENDING
      await manager.update(Movement, id, {
        voidStatus: 'VOID_PENDING',
        voidAdjRequestId: request.id,
      });

      return { requestId: request.id, code: request.code };
    });

    void this.uploads.log('MOVEMENT', id, 'ANULACION_SOLICITADA',
      `Anulación solicitada — generado ${result.code} pendiente de aprobación`,
      userId, undefined, undefined, result.code);

    return { ...result, warnings };
  }

  async create(dto: CreateMovementDto, userId: string) {
    const result = await this.dataSource.transaction((manager) =>
      this.createInTransaction(manager, dto, userId),
    );

    // Post-transaction: invalidate cache + broadcast (fire-and-forget, non-blocking)
    void Promise.all([
      this.cache.delPattern('kpis:*'),
      this.cache.delPattern('stock:*'),
    ]);
    this.events.emitMovementCreated({
      movementId: result.movementId,
      type: result.type,
      warehouseId: result.warehouseId,
    });
    this.events.emitStockUpdated({ warehouseId: result.warehouseId });

    return { movementId: result.movementId, stockImpact: result.stockImpact };
  }

  /**
   * Transferencia multi-producto: mueve los pallets seleccionados (de distintos
   * productos) de una ubicación a otra en UNA sola transacción. Genera un
   * movimiento TRANSFER por producto; si una línea falla se revierte todo.
   * El stock se descuenta desde la ubicación real de cada pallet (robusto ante
   * pallets que ya no estén físicamente en el origen indicado).
   */
  async createTransferBatch(dto: TransferBatchDto, userId: string) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Origen y destino no pueden ser la misma ubicación');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const movementIds: string[] = [];
      let totalQty = 0;
      let totalPallets = 0;

      for (const line of dto.lines) {
        const res = await this.createInTransaction(manager, {
          type: 'TRANSFER',
          date: dto.date,
          productId: line.productId,
          fromLocationId: dto.fromLocationId,
          toLocationId: dto.toLocationId,
          notes: dto.notes,
          palletItems: line.palletItems,
        }, userId);
        movementIds.push(res.movementId);
        totalQty += line.palletItems.reduce((s, i) => s + i.quantity, 0);
        totalPallets += line.palletItems.length;
      }

      return { movementIds, totalQty, totalPallets };
    });

    void Promise.all([
      this.cache.delPattern('kpis:*'),
      this.cache.delPattern('stock:*'),
    ]);
    this.events.emitStockUpdated({ warehouseId: null });

    return result;
  }

  /**
   * Procesa un único movimiento (una línea) dentro de una transacción existente.
   * Contiene el motor de stock; reutilizado por create() y createDocument().
   * @param documentId cabecera (remito) a la que pertenece la línea, si aplica.
   */
  /** Expuesto para uso desde AdjustmentsService (aprobación de ajustes). */
  async createInTransactionPublic(
    manager: EntityManager,
    dto: CreateMovementDto,
    userId: string,
    documentId?: string,
  ): Promise<{ movementId: string; stockImpact: string; type: MovementType; warehouseId: string | null }> {
    return this.createInTransaction(manager, dto, userId, documentId);
  }

  private async createInTransaction(
    manager: EntityManager,
    dto: CreateMovementDto,
    userId: string,
    documentId?: string,
  ): Promise<{ movementId: string; stockImpact: string; type: MovementType; warehouseId: string | null }> {
      const product = await manager.findOne(Product, { where: { id: dto.productId } });
      if (!product || !product.active) {
        throw new NotFoundException('Material inexistente o inactivo');
      }

      // Validaciones previas al procesamiento
      const isEntry = ['ENTRY', 'ADJUSTMENT_IN'].includes(dto.type);
      const isAdjustment = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'].includes(dto.type);

      if (dto.isProvisional && !isEntry) {
        throw new BadRequestException('Solo las entradas pueden marcarse como provisorias');
      }
      if (dto.isProvisional && !dto.notes?.trim()) {
        throw new BadRequestException('Las entradas provisorias requieren una observación obligatoria');
      }
      if (isAdjustment && !dto.adjustmentReason) {
        throw new BadRequestException('Los ajustes requieren un motivo obligatorio');
      }

      const totalQty = dto.palletItems?.length
        ? dto.palletItems.reduce((s, i) => s + i.quantity, 0)
        : (dto.quantity ?? 0);

      if (totalQty <= 0) throw new BadRequestException('La cantidad debe ser mayor a cero');

      this.validateBusinessRules({ ...dto, quantity: totalQty });

      const resolved = await this.resolveLocationsAndWarehouses(manager, dto);
      await this.ensureExplicitWarehouseConsistency(manager, dto, resolved);

      const isIncrease = ['ENTRY', 'ADJUSTMENT_IN'].includes(dto.type);
      // EXIT sin palletItems usa auto-FEFO: stock se reduce palet a palet después de guardar el movimiento
      let useAutoFefo = false;

      if (dto.palletItems?.length) {
        // ENTRY/ADJUSTMENT_IN: aumentar stock total ahora con ubicación del formulario.
        // EXIT/ADJUSTMENT_OUT: reducir palet a palet en el loop (por ubicación real del palet).
        // TRANSFER: reducir/aumentar palet a palet en el loop.
        if (isEntry) {
          await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
        }
      } else {
        switch (dto.type) {
          case 'ENTRY':
          case 'ADJUSTMENT_IN':
            await this.applyIncrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
            break;
          case 'EXIT':
            // Sin palletItems: asignación FEFO automática post-guardado
            useAutoFefo = true;
            break;
          case 'ADJUSTMENT_OUT':
            await this.applyDecrease(manager, dto.productId, resolved.warehouseId, resolved.locationId, totalQty);
            break;
          case 'TRANSFER':
            await this.applyDecrease(manager, dto.productId, resolved.fromWarehouseId, dto.fromLocationId ?? null, totalQty);
            await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, dto.toLocationId ?? null, totalQty);
            break;
        }
      }

      const movementData: DeepPartial<Movement> = {
        type: dto.type,
        date: dto.date ? new Date(dto.date) : new Date(),
        productId: dto.productId,
        quantity: totalQty,
        pallets: dto.pallets ?? undefined,
        warehouseId: resolved.warehouseId ?? undefined,
        locationId: resolved.locationId ?? undefined,
        fromWarehouseId: resolved.fromWarehouseId ?? undefined,
        fromLocationId: dto.fromLocationId ?? undefined,
        toWarehouseId: resolved.toWarehouseId ?? undefined,
        toLocationId: dto.toLocationId ?? undefined,
        documentNumber: dto.documentNumber?.trim() || undefined,
        supplier: dto.supplier?.trim() || undefined,
        carrier: dto.carrier?.trim() || undefined,
        driver: dto.driver?.trim() || undefined,
        destination: dto.destination?.trim() || undefined,
        notes: dto.notes?.trim() || undefined,
        palletId: dto.palletId ?? undefined,
        lotId: dto.lotId ?? undefined,
        documentId: documentId ?? undefined,
        createdById: userId,
        encargadoRecepcionId: dto.encargadoRecepcionId ?? undefined,
        status: dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
        adjustmentReason: dto.adjustmentReason ?? undefined,
        adjustmentCategory: dto.adjustmentCategory ?? undefined,
      };

      const movement = manager.create(Movement, movementData);
      await manager.save(movement);

      // EXIT sin palletItems: asignación FEFO automática (busca y descuenta palets en orden de vencimiento)
      if (useAutoFefo) {
        await this.autoFefoExit(manager, dto.productId, resolved.locationId, resolved.warehouseId, totalQty, movement.id);
      }

      // Loop palet a palet
      if (dto.palletItems?.length) {
        for (const item of dto.palletItems) {
          let resolvedLotId: string | undefined;
          let resolvedPalletId: string | undefined = item.palletId;
          // locationId para MovementDetail — ubicación física del palet en este movimiento
          let detailLocationId: string | null = null;

          if (item.palletId) {
            // Lock pesimista: evita que dos despachos concurrentes resten del mismo palet.
            const pallet = await manager.getRepository(Pallet).findOne({ where: { id: item.palletId }, lock: { mode: 'pessimistic_write' } });
            if (!pallet) throw new NotFoundException(`Palet no encontrado: ${item.palletId}`);
            if (pallet.status === 'EXITED') throw new BadRequestException(`El palet ${pallet.code} ya fue despachado`);
            resolvedLotId = pallet.lotId;
            // Para EXIT/TRANSFER: la ubicación de origen es donde estaba el palet
            detailLocationId = pallet.currentLocationId ?? null;

            if (dto.type === 'EXIT' || dto.type === 'ADJUSTMENT_OUT') {
              // Verificar que el lote no esté pendiente de regularización
              const palletLot = await manager.getRepository(Lot).findOne({ where: { id: pallet.lotId } });
              if (palletLot?.status === 'PENDING_REGULARIZATION') {
                throw new BadRequestException(
                  `El lote "${palletLot.lotCode}" está pendiente de regularización. Regularizá el lote antes de despachar.`,
                );
              }

              // Reducir stock desde la ubicación real del palet
              const stockLocationId: string | null = pallet.currentLocationId ?? null;
              let stockWarehouseId: string | null = null;
              if (stockLocationId) {
                const loc = await manager.findOne(Location, { where: { id: stockLocationId } });
                stockWarehouseId = loc?.warehouse?.id ?? null;
              }
              await this.applyDecrease(manager, dto.productId, stockWarehouseId, stockLocationId, item.quantity);

              // Salida parcial: reducir cantidad del pallet.
              // - llega a 0  → EXITED (despachado completo)
              // - queda saldo → PARTIAL (salida parcial), salvo que esté BLOCKED/DAMAGED
              pallet.quantity = Math.max(0, pallet.quantity - item.quantity);
              if (pallet.quantity === 0) {
                pallet.status = 'EXITED';
                pallet.exitedAt = new Date();
              } else if (pallet.status === 'AVAILABLE' || pallet.status === 'PARTIAL') {
                pallet.status = 'PARTIAL';
              }

            } else if (dto.type === 'TRANSFER') {
              // Transferencia: reducir desde ubicación actual del palet, aumentar en destino
              const fromLocationId: string | null = pallet.currentLocationId ?? null;
              let fromWarehouseId: string | null = null;
              if (fromLocationId) {
                const loc = await manager.findOne(Location, { where: { id: fromLocationId } });
                fromWarehouseId = loc?.warehouse?.id ?? null;
              }
              await this.applyDecrease(manager, dto.productId, fromWarehouseId, fromLocationId, item.quantity);
              await this.applyIncrease(manager, dto.productId, resolved.toWarehouseId, dto.toLocationId ?? null, item.quantity);
              pallet.currentLocationId = dto.toLocationId ?? null;
            }

            await manager.save(pallet);

          } else if (item.lotCode) {
            // ENTRADA: crear/encontrar lote y registrar nuevo palet
            const lot = await this.findOrCreateLot(
              manager, dto.productId, item.lotCode,
              item.fechaVencimiento, item.proveedor,
              item.fechaFabricacion, item.sapLot,
              dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
            );
            resolvedLotId = lot.id;
            const existingCount = await manager.getRepository(Pallet).count({ where: { lotId: lot.id } });
            const pallet = manager.getRepository(Pallet).create({
              code: `${lot.lotCode}-P${existingCount + 1}`,
              lotId: lot.id,
              quantity: item.quantity,
              currentLocationId: resolved.locationId ?? null,
              status: 'AVAILABLE',
            });
            const savedPallet = await manager.save(pallet);
            resolvedPalletId = savedPallet.id;
            // Para ENTRADA: la ubicación de destino es donde queda el palet
            detailLocationId = resolved.locationId ?? null;
          }

          if (resolvedLotId) {
            const detail = manager.create(MovementDetail, {
              movementId: movement.id,
              lotId: resolvedLotId,
              palletId: resolvedPalletId ?? undefined,
              quantity: item.quantity,
              locationId: detailLocationId ?? undefined,  // ← FIX 1: guardar ubicación física
            });
            await manager.save(detail);
            // TRANSFER only moves pallets between locations; lot.stockActual must NOT change
            if (dto.type !== 'TRANSFER') {
              await this.updateLotStock(manager, resolvedLotId, isIncrease ? item.quantity : -item.quantity);
            }
          }
        }

        // FIX 2: registrar cantidad real de palets afectados en el movimiento
        if (!dto.pallets) {
          movement.pallets = dto.palletItems.length;
          await manager.save(movement);
        }

      } else if (dto.lotId) {
        await this.updateLotStock(manager, dto.lotId, isIncrease ? totalQty : -totalQty);
      }

      return {
        movementId: movement.id,
        stockImpact: this.describeImpact(dto.type),
        type: dto.type,
        warehouseId: resolved.warehouseId ?? null,
      };
  }

  /**
   * Crea un documento logístico (remito) con múltiples líneas (producto+lote+pallets)
   * en UNA sola transacción. Genera el código interno RLNE/RLNS y vincula cada
   * movimiento a la cabecera. Si una línea falla, se revierte TODO el documento.
   */
  async createDocument(dto: CreateDocumentDto, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const docDate = dto.date ? new Date(dto.date) : new Date();
      const code = await this.sequences.nextCode(manager, dto.type, docDate);

      const document = manager.create(LogisticsDocument, {
        code,
        type: dto.type,
        status: 'APROBADO',
        date: docDate,
        documentNumber: dto.documentNumber?.trim() || null,
        supplier: dto.supplier?.trim() || null,
        destination: dto.destination?.trim() || null,
        warehouseId: dto.warehouseId ?? null,
        carrier: dto.carrier?.trim() || null,
        driver: dto.driver?.trim() || null,
        vehiclePlate: dto.vehiclePlate?.trim() || null,
        encargadoId: dto.encargadoId ?? null,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      });
      await manager.save(document);

      let totalQuantity = 0;
      const movementIds: string[] = [];

      for (const line of dto.lines) {
        // Cada línea es un movimiento mono-producto que hereda la cabecera del documento.
        const lineDto: CreateMovementDto = {
          type: dto.type,
          date: dto.date,
          productId: line.productId,
          quantity: line.quantity,
          pallets: line.pallets,
          warehouseId: dto.warehouseId,
          locationId: line.locationId,
          documentNumber: dto.documentNumber,
          supplier: dto.supplier,
          carrier: dto.carrier,
          driver: dto.driver,
          destination: dto.destination,
          notes: dto.notes,
          lotId: line.lotId,
          encargadoRecepcionId: dto.encargadoId,
          isProvisional: dto.isProvisional,
          palletItems: line.palletItems,
        };

        const res = await this.createInTransaction(manager, lineDto, userId, document.id);
        movementIds.push(res.movementId);
        totalQuantity += line.palletItems?.length
          ? line.palletItems.reduce((s, i) => s + i.quantity, 0)
          : (line.quantity ?? 0);
      }

      document.totalLines = dto.lines.length;
      document.totalQuantity = totalQuantity;
      await manager.save(document);

      return {
        documentId: document.id,
        code: document.code,
        type: dto.type,
        warehouseId: dto.warehouseId ?? null,
        movementIds,
      };
    });

    // Post-transaction: invalidar cache + broadcast (una sola vez por documento)
    void Promise.all([
      this.cache.delPattern('kpis:*'),
      this.cache.delPattern('stock:*'),
    ]);
    this.events.emitStockUpdated({ warehouseId: result.warehouseId });

    void this.uploads.log('DOCUMENT', result.documentId, 'CREADO',
      `Remito ${result.code} creado con ${result.movementIds.length} línea(s)`,
      undefined, undefined, undefined, result.code);

    return {
      documentId: result.documentId,
      code: result.code,
      movementIds: result.movementIds,
      stockImpact: this.describeImpact(result.type),
    };
  }

  /** Lista documentos logísticos (remitos) con filtros básicos. */
  async findDocuments(query: { type?: string; from?: string; to?: string; search?: string }) {
    const qb = this.dataSource
      .getRepository(LogisticsDocument)
      .createQueryBuilder('d')
      .orderBy('d.createdAt', 'DESC')
      .take(200);

    if (query.type) qb.andWhere('d.type = :type', { type: query.type });
    if (query.from) qb.andWhere('d.date >= :from', { from: this.toStartDate(query.from) });
    if (query.to) qb.andWhere('d.date <= :to', { to: this.toEndDate(query.to) });
    if (query.search) {
      qb.andWhere('(d.code ILIKE :s OR d.documentNumber ILIKE :s OR d.supplier ILIKE :s OR d.destination ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    return qb.getMany();
  }

  /** Detalle de un documento: cabecera + sus movimientos (líneas) + detalles por palet. */
  async findDocument(id: string) {
    const document = await this.dataSource.getRepository(LogisticsDocument).findOne({ where: { id } });
    if (!document) throw new NotFoundException('Documento no encontrado');

    const movements = await this.dataSource
      .getRepository(Movement)
      .find({ where: { documentId: id }, order: { createdAt: 'ASC' } });

    const movementIds = movements.map((m) => m.id);
    const details = movementIds.length
      ? await this.dataSource
          .getRepository(MovementDetail)
          .createQueryBuilder('md')
          .where('md.movementId IN (:...ids)', { ids: movementIds })
          .getMany()
      : [];

    return { document, movements, details };
  }

  /** Documento enriquecido para impresión: incluye nombres de producto, lote, depósito y pallets. */
  async findDocumentForPrint(id: string) {
    const { document, movements, details } = await this.findDocument(id);

    const productIds = [...new Set(movements.map((m) => m.productId).filter(Boolean))] as string[];
    const lotIds = [...new Set([
      ...movements.map((m) => m.lotId).filter(Boolean),
      ...details.map((d) => d.lotId).filter(Boolean),
    ])] as string[];
    const warehouseIds = [...new Set([
      document.warehouseId,
      ...movements.flatMap((m) => [m.warehouseId, m.toWarehouseId, m.fromWarehouseId]).filter(Boolean),
    ].filter((v): v is string => !!v))];
    const palletIds = [...new Set(details.map((d) => d.palletId).filter(Boolean))] as string[];

    const [products, lots, warehouses, pallets] = await Promise.all([
      productIds.length ? this.dataSource.getRepository(Product).findByIds(productIds) : Promise.resolve([] as Product[]),
      lotIds.length ? this.dataSource.getRepository(Lot).findByIds(lotIds) : Promise.resolve([] as Lot[]),
      warehouseIds.length ? this.dataSource.getRepository(Warehouse).findByIds(warehouseIds) : Promise.resolve([] as Warehouse[]),
      palletIds.length ? this.dataSource.getRepository(Pallet).findByIds(palletIds) : Promise.resolve([] as Pallet[]),
    ]);

    return { document, movements, details, products, lots, warehouses, pallets };
  }

  /**
   * Edita metadatos de cualquier movimiento (sin importar su estado).
   * Propaga cambios de lote (fechas, SAP, proveedor) a los lotes vinculados.
   * Cada campo modificado queda registrado en regularization_logs con el motivo.
   */
  async editMetadata(id: string, dto: RegularizeMovementDto, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const movement = await manager.findOne(Movement, { where: { id } });
      if (!movement) throw new NotFoundException('Movimiento no encontrado');

      const logs: DeepPartial<RegularizationLog>[] = [];

      const movementStringFields = [
        'documentNumber', 'supplier', 'carrier', 'driver', 'destination', 'notes',
      ] as const;

      for (const field of movementStringFields) {
        const newVal = dto[field]?.trim() ?? null;
        if (newVal === null) continue;
        const oldVal = (movement[field] as string | undefined) ?? null;
        if (newVal !== oldVal) {
          logs.push({ movementId: id, field, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
          (movement as unknown as Record<string, unknown>)[field] = newVal || null;
        }
      }

      // Propagar cambios a los lotes asociados
      const details = await manager.getRepository(MovementDetail).find({ where: { movementId: id } });
      const detailLotIds = details.map((d) => d.lotId).filter(Boolean) as string[];
      // Incluir movement.lotId para movimientos bulk (sin palletItems) que no generan MovementDetail
      const lotIds = [...new Set([...detailLotIds, ...(movement.lotId ? [movement.lotId] : [])])];

      if (lotIds.length > 0) {
        const lots = await manager.getRepository(Lot).find({ where: lotIds.map((lotId) => ({ id: lotId })) });
        const lotDateFields = ['fechaVencimiento', 'fechaFabricacion'] as const;
        const lotStringFields = ['sapLot', 'proveedor'] as const;

        for (const lot of lots) {
          let lotChanged = false;

          for (const field of lotStringFields) {
            const newVal = dto[field]?.trim() ?? null;
            if (newVal === null) continue;
            const oldVal = lot[field] ?? null;
            if (newVal !== oldVal) {
              logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
              lot[field] = newVal;
              lotChanged = true;
            }
          }

          for (const field of lotDateFields) {
            const newVal = dto[field] ?? null;
            if (newVal === null) continue;
            const oldVal = lot[field] ?? null;
            if (newVal !== oldVal) {
              logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
              lot[field] = newVal;
              lotChanged = true;
            }
          }

          if (lotChanged) await manager.save(Lot, lot);
        }
      }

      await manager.save(movement);
      for (const log of logs) {
        await manager.save(manager.create(RegularizationLog, log));
      }

      return { edited: true, changes: logs.length };
    });

    void Promise.all([
      this.cache.delPattern('kpis:*'),
      this.cache.delPattern('stock:*'),
    ]);

    return result;
  }

  /** Desglose por lote de un movimiento: cantidades y estado actual de sus pallets (para edición). */
  async getLotsBreakdown(id: string) {
    const movement = await this.dataSource.getRepository(Movement).findOne({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');

    const details = await this.dataSource.getRepository(MovementDetail).find({ where: { movementId: id } });
    const lotIds = [...new Set([
      ...details.map((d) => d.lotId).filter(Boolean) as string[],
      ...(movement.lotId ? [movement.lotId] : []),
    ])];
    const palletIds = [...new Set(details.map((d) => d.palletId).filter(Boolean))] as string[];

    const [lots, pallets] = await Promise.all([
      lotIds.length ? this.dataSource.getRepository(Lot).findByIds(lotIds) : Promise.resolve([] as Lot[]),
      palletIds.length ? this.dataSource.getRepository(Pallet).findByIds(palletIds) : Promise.resolve([] as Pallet[]),
    ]);
    const palletMap = Object.fromEntries(pallets.map((p) => [p.id, p]));

    const breakdown = lots.map((lot) => {
      const lotDetails = details.filter((d) => d.lotId === lot.id);
      const quantity = lotDetails.length
        ? lotDetails.reduce((s, d) => s + d.quantity, 0)
        : movement.quantity; // movimiento bulk con lotId directo, sin detalles
      const lotPallets = lotDetails
        .filter((d) => d.palletId && palletMap[d.palletId])
        .map((d) => {
          const p = palletMap[d.palletId!];
          return {
            id: p.id,
            code: p.code,
            status: p.status,
            quantityInMovement: d.quantity,
            currentQuantity: p.quantity,
          };
        });
      // Máximo descontable hoy: lo que queda físicamente en los pallets de este movimiento
      const availableQty = lotPallets
        .filter((p) => p.status !== 'EXITED')
        .reduce((s, p) => s + p.currentQuantity, 0);
      return {
        lotId: lot.id,
        lotCode: lot.lotCode,
        sapLot: lot.sapLot ?? null,
        fechaVencimiento: lot.fechaVencimiento ?? null,
        fechaFabricacion: lot.fechaFabricacion ?? null,
        proveedor: lot.proveedor ?? null,
        quantity,
        availableQty,
        pallets: lotPallets,
      };
    });

    return { movementId: id, type: movement.type, quantity: movement.quantity, lots: breakdown };
  }

  /**
   * Solicita la corrección de lotes/cantidades/pallets de una ENTRADA ya posteada.
   * - Renombres de código de lote se aplican directo (sin impacto de stock) y quedan
   *   auditados en regularization_logs; los códigos de pallets derivados se renombran en cascada.
   * - Las diferencias de cantidad generan AdjustmentRequest (RLAI/RLAO) en PENDIENTE_APROBACION:
   *   el stock NO cambia hasta que el MANAGER apruebe. A diferencia de la anulación,
   *   NO se setea originalMovementId (el movimiento original no se marca VOIDED).
   */
  async requestQuantityEdit(id: string, dto: RequestQuantityEditDto, userId: string) {
    const movement = await this.dataSource.getRepository(Movement).findOne({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    if (movement.type !== 'ENTRY') {
      throw new BadRequestException('La corrección de cantidades solo está disponible para entradas.');
    }
    if (movement.voidStatus !== 'NONE') {
      throw new BadRequestException('El movimiento tiene una anulación en curso o ya fue anulado.');
    }

    const details = await this.dataSource.getRepository(MovementDetail).find({ where: { movementId: id } });
    const movementLotIds = new Set([
      ...details.map((d) => d.lotId).filter(Boolean) as string[],
      ...(movement.lotId ? [movement.lotId] : []),
    ]);
    const lots = dto.lots.length
      ? await this.dataSource.getRepository(Lot).findByIds(dto.lots.map((l) => l.lotId))
      : [];
    const lotMap = Object.fromEntries(lots.map((l) => [l.id, l]));
    const palletIds = [...new Set(details.map((d) => d.palletId).filter(Boolean))] as string[];
    const pallets = palletIds.length
      ? await this.dataSource.getRepository(Pallet).findByIds(palletIds)
      : [];
    const palletMap = Object.fromEntries(pallets.map((p) => [p.id, p]));

    type IncreaseItem = {
      lotCode: string; quantity: number;
      fechaVencimiento?: string; fechaFabricacion?: string; sapLot?: string; proveedor?: string;
    };
    type LotField = 'sapLot' | 'proveedor' | 'fechaVencimiento' | 'fechaFabricacion';
    const renames: Array<{ lot: Lot; newCode: string }> = [];
    const fieldUpdates: Array<{ lot: Lot; field: LotField; oldValue: string | null; newValue: string }> = [];
    const increaseItems: IncreaseItem[] = [];
    const decreaseItems: Array<{ palletId: string; quantity: number }> = [];
    const warnings: string[] = [];

    for (const edit of dto.lots) {
      const lot = lotMap[edit.lotId];
      if (!lot) throw new NotFoundException(`Lote no encontrado: ${edit.lotId}`);
      if (!movementLotIds.has(lot.id)) {
        throw new BadRequestException(`El lote ${lot.lotCode} no pertenece a este movimiento.`);
      }

      // ── Renombre de código de lote ──
      const newCode = edit.newLotCode ? normalizeLotCode(edit.newLotCode) : undefined;
      if (newCode && newCode !== lot.lotCode) {
        const collision = await this.dataSource
          .getRepository(Lot)
          .findOne({ where: { productId: lot.productId, lotCode: newCode } });
        if (collision && collision.id !== lot.id) {
          throw new BadRequestException(`Ya existe otro lote "${newCode}" para este producto.`);
        }
        renames.push({ lot, newCode });
      }

      // ── Datos del lote (sapLot, fechas, proveedor) — directo, auditado ──
      const lotFieldEdits: Array<[LotField, string | undefined]> = [
        ['sapLot', edit.sapLot],
        ['proveedor', edit.proveedor],
        ['fechaVencimiento', edit.fechaVencimiento],
        ['fechaFabricacion', edit.fechaFabricacion],
      ];
      for (const [field, raw] of lotFieldEdits) {
        const newVal = raw?.trim();
        if (!newVal) continue;
        const oldVal = lot[field] ?? null;
        if (newVal !== oldVal) {
          fieldUpdates.push({ lot, field, oldValue: oldVal, newValue: newVal });
        }
      }

      // ── Reducciones por pallet (newQuantity ≤ cantidad actual) ──
      const lotDetails = details.filter((d) => d.lotId === lot.id);
      const lotPalletIds = new Set(lotDetails.map((d) => d.palletId).filter(Boolean) as string[]);
      for (const pe of edit.palletEdits ?? []) {
        const pallet = palletMap[pe.palletId];
        if (!pallet || !lotPalletIds.has(pe.palletId)) {
          throw new BadRequestException(`El pallet indicado no pertenece al lote ${lot.lotCode} de este movimiento.`);
        }
        if (pallet.status === 'EXITED') {
          warnings.push(`El pallet ${pallet.code} ya fue despachado — no se modifica.`);
          continue;
        }
        if (pe.newQuantity > pallet.quantity) {
          throw new BadRequestException(
            `El pallet ${pallet.code} tiene ${pallet.quantity} unid. — solo se puede reducir. ` +
            `Para sumar unidades usá "Agregar pallets nuevos" del lote.`,
          );
        }
        const take = pallet.quantity - pe.newQuantity;
        if (take > 0) decreaseItems.push({ palletId: pallet.id, quantity: take });
      }

      // ── Agregado de unidades → pallets nuevos al aprobar ──
      if (edit.addQuantity && edit.addQuantity > 0) {
        const effectiveCode = newCode || lot.lotCode;
        const count = Math.max(1, edit.addPalletCount ?? 1);
        const base = Math.floor(edit.addQuantity / count);
        const rem = edit.addQuantity % count;
        for (let i = 0; i < count; i++) {
          const qty = i < rem ? base + 1 : base;
          if (qty <= 0) continue;
          increaseItems.push({
            lotCode: effectiveCode,
            quantity: qty,
            fechaVencimiento: edit.fechaVencimiento?.trim() || lot.fechaVencimiento || undefined,
            fechaFabricacion: edit.fechaFabricacion?.trim() || lot.fechaFabricacion || undefined,
            sapLot: edit.sapLot?.trim() || lot.sapLot || undefined,
            proveedor: edit.proveedor?.trim() || lot.proveedor || undefined,
          });
        }
      }
    }

    if (renames.length === 0 && fieldUpdates.length === 0 && increaseItems.length === 0 && decreaseItems.length === 0) {
      throw new BadRequestException('No hay cambios para aplicar.');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      // 1. Renombres directos: lote + cascada a códigos de pallets + auditoría
      for (const { lot, newCode } of renames) {
        const oldCode = lot.lotCode;
        const lotPallets = await manager.getRepository(Pallet).find({ where: { lotId: lot.id } });
        const toRename = lotPallets.filter((p) => p.code.startsWith(`${oldCode}-P`));
        // pallet.code es único globalmente: verificar que los nuevos códigos estén libres
        const newCodes = toRename.map((p) => `${newCode}${p.code.slice(oldCode.length)}`);
        if (newCodes.length > 0) {
          const taken = await manager.getRepository(Pallet).find({ where: { code: In(newCodes) } });
          if (taken.length > 0) {
            throw new BadRequestException(
              `No se puede renombrar a "${newCode}": el código de pallet ${taken[0].code} ya existe en otro lote.`,
            );
          }
        }
        for (const p of toRename) {
          p.code = `${newCode}${p.code.slice(oldCode.length)}`;
          await manager.save(p);
        }
        lot.lotCode = newCode;
        await manager.save(Lot, lot);
        await manager.save(manager.create(RegularizationLog, {
          movementId: id,
          field: `lot.${oldCode}.lotCode`,
          oldValue: oldCode,
          newValue: newCode,
          changedById: userId,
          reason: dto.reason,
        }));
      }

      // 2. Datos del lote (sapLot, fechas, proveedor) — directo + auditoría
      for (const fu of fieldUpdates) {
        (fu.lot as unknown as Record<string, unknown>)[fu.field] = fu.newValue;
        await manager.save(Lot, fu.lot);
        await manager.save(manager.create(RegularizationLog, {
          movementId: id,
          field: `lot.${fu.lot.lotCode}.${fu.field}`,
          oldValue: fu.oldValue,
          newValue: fu.newValue,
          changedById: userId,
          reason: dto.reason,
        }));
      }

      // 3. Solicitudes de ajuste por los deltas — pendientes de aprobación
      const requests: Array<{ requestId: string; code: string; type: string; totalQuantity: number }> = [];
      const createRequest = async (
        type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT',
        items: Array<{ quantity: number }>,
      ) => {
        const code = await this.sequences.nextCode(manager, type);
        const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
        const request = manager.create(AdjustmentRequest, {
          code,
          type,
          status: 'PENDIENTE_APROBACION',
          reason: 'DIFERENCIA_INVENTARIO',
          notes: `Corrección de cantidad de ENTRADA del ${new Date(movement.date).toLocaleDateString('es-PY')}` +
            `${movement.documentNumber ? ` · MIC/Fac/Rem. ${movement.documentNumber}` : ''} — ${dto.reason}`,
          warehouseId: movement.warehouseId ?? null,
          locationId: movement.locationId ?? null,
          createdById: userId,
          totalLines: 1,
          totalQuantity,
        });
        await manager.save(request);
        const line = manager.create(AdjustmentRequestLine, {
          requestId: request.id,
          productId: movement.productId,
          palletItemsJson: JSON.stringify(items),
          totalQuantity,
          locationId: movement.locationId ?? null,
        });
        await manager.save(line);
        requests.push({ requestId: request.id, code, type, totalQuantity });
      };

      if (increaseItems.length > 0) await createRequest('ADJUSTMENT_IN', increaseItems);
      if (decreaseItems.length > 0) await createRequest('ADJUSTMENT_OUT', decreaseItems);

      return { renamed: renames.length, lotFieldChanges: fieldUpdates.length, requests };
    });

    // Bitácora del movimiento
    const parts: string[] = [];
    if (result.renamed > 0) parts.push(`${result.renamed} lote(s) renombrado(s)`);
    if (result.lotFieldChanges > 0) parts.push(`${result.lotFieldChanges} dato(s) de lote actualizado(s)`);
    for (const r of result.requests) {
      parts.push(`${r.code} (${r.type === 'ADJUSTMENT_IN' ? '+' : '−'}${r.totalQuantity} unid.) pendiente de aprobación`);
    }
    void this.uploads.log(
      'MOVEMENT', id,
      result.requests.length > 0 ? 'ENVIADO_APROBACION' : 'EDITADO',
      `Corrección de lotes/cantidades — ${parts.join(' · ')}`,
      userId,
    );

    if (result.renamed > 0 || result.lotFieldChanges > 0) {
      void Promise.all([
        this.cache.delPattern('kpis:*'),
        this.cache.delPattern('stock:*'),
      ]);
    }

    return { ...result, warnings };
  }

  async regularize(id: string, dto: RegularizeMovementDto, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const movement = await manager.findOne(Movement, { where: { id } });
      if (!movement) throw new NotFoundException('Movimiento no encontrado');
      if (movement.status !== 'PENDING_REGULARIZATION') {
        throw new BadRequestException('El movimiento no está pendiente de regularización');
      }

      const logs: DeepPartial<RegularizationLog>[] = [];

      const movementStringFields = [
        'documentNumber', 'supplier', 'carrier', 'driver', 'destination', 'notes',
      ] as const;

      for (const field of movementStringFields) {
        const newVal = dto[field]?.trim() ?? null;
        if (newVal === null) continue;
        const oldVal = (movement[field] as string | undefined) ?? null;
        if (newVal !== oldVal) {
          logs.push({ movementId: id, field, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
          (movement as unknown as Record<string, unknown>)[field] = newVal || null;
        }
      }

      // Actualizar lotes asociados vía MovementDetail
      const details = await manager.getRepository(MovementDetail).find({ where: { movementId: id } });
      const detailLotIds = details.map((d) => d.lotId).filter(Boolean) as string[];
      // Incluir movement.lotId para movimientos bulk (sin palletItems) que no generan MovementDetail
      const lotIds = [...new Set([...detailLotIds, ...(movement.lotId ? [movement.lotId] : [])])];

      if (lotIds.length > 0) {
        const lots = await manager.getRepository(Lot).find({ where: lotIds.map((lotId) => ({ id: lotId })) });
        const lotDateFields = ['fechaVencimiento', 'fechaFabricacion'] as const;
        const lotStringFields = ['sapLot', 'proveedor'] as const;

        for (const lot of lots) {
          let lotChanged = false;

          for (const field of lotStringFields) {
            const newVal = dto[field]?.trim() ?? null;
            if (newVal === null) continue;
            const oldVal = lot[field] ?? null;
            if (newVal !== oldVal) {
              logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
              lot[field] = newVal;
              lotChanged = true;
            }
          }

          for (const field of lotDateFields) {
            const newVal = dto[field] ?? null;
            if (newVal === null) continue;
            const oldVal = lot[field] ?? null;
            if (newVal !== oldVal) {
              logs.push({ movementId: id, field: `lot.${lot.lotCode}.${field}`, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
              lot[field] = newVal;
              lotChanged = true;
            }
          }

          if (lotChanged) {
            lot.status = 'NORMAL';
            await manager.save(Lot, lot);
          }
        }
      }

      movement.status = 'NORMAL';
      await manager.save(movement);

      for (const log of logs) {
        await manager.save(manager.create(RegularizationLog, log));
      }

      return { regularized: true, changes: logs.length };
    });

    // Regularization changes pending count → invalidate kpis cache
    void this.cache.delPattern('kpis:*');

    return result;
  }

  async findAll(query: MovementsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const qb = this.dataSource
      .getRepository(Movement)
      .createQueryBuilder('movement')
      .leftJoin('products', 'product', 'product.id = movement."productId"')
      .leftJoin('warehouses', 'warehouse', 'warehouse.id = movement."warehouseId"')
      .leftJoin('locations', 'location', 'location.id = movement."locationId"')
      .leftJoin('warehouses', 'fromWarehouse', 'fromWarehouse.id = movement."fromWarehouseId"')
      .leftJoin('locations', 'fromLocation', 'fromLocation.id = movement."fromLocationId"')
      .leftJoin('warehouses', 'toWarehouse', 'toWarehouse.id = movement."toWarehouseId"')
      .leftJoin('locations', 'toLocation', 'toLocation.id = movement."toLocationId"')
      .leftJoin('users', 'encargado', 'encargado.id = movement."encargadoRecepcionId"')
      .leftJoin('lots', 'lot', 'lot.id = movement."lotId"')
      // Agregación de lotes desde movement_details: para movimientos con palletItems
      // que no tienen lotId único, devolvemos los lotes/SAP concatenados.
      .leftJoin(
        (sq) =>
          sq
            .from('movement_details', 'md')
            .innerJoin('lots', 'dl', 'dl.id = md."lotId"')
            .select('md."movementId"', 'movementId')
            .addSelect('STRING_AGG(DISTINCT dl."lotCode", \', \' ORDER BY dl."lotCode")', 'lotCodes')
            .addSelect('STRING_AGG(DISTINCT dl."sapLot", \', \' ORDER BY dl."sapLot")', 'sapLots')
            .addSelect('COUNT(DISTINCT dl.id)', 'lotCount')
            .groupBy('md."movementId"'),
        'dl_agg',
        'dl_agg."movementId" = movement.id',
      )
      .select([
        'movement.id AS id',
        'movement.type AS type',
        'movement.date AS date',
        'movement.quantity AS quantity',
        'movement.pallets AS pallets',
        'movement.documentNumber AS "documentNumber"',
        'movement.supplier AS supplier',
        'movement.carrier AS carrier',
        'movement.driver AS driver',
        'movement.destination AS destination',
        'movement.notes AS notes',
        'movement.status AS status',
        'movement."adjustmentReason" AS "adjustmentReason"',
        'movement."adjustmentCategory" AS "adjustmentCategory"',
        'movement.createdById AS "createdById"',
        'movement.lotId AS "lotId"',
        'COALESCE(lot."lotCode", dl_agg."lotCodes") AS "lotCode"',
        'COALESCE(lot."sapLot", dl_agg."sapLots") AS "sapLot"',
        'COALESCE(dl_agg."lotCount", CASE WHEN lot.id IS NOT NULL THEN 1 ELSE 0 END) AS "lotCount"',
        'product.id AS "productId"',
        'product.code AS "productCode"',
        'product.description AS "productDescription"',
        'product."unitOfMeasure" AS "unitOfMeasure"',
        'warehouse.id AS "warehouseId"',
        'warehouse.name AS "warehouseName"',
        'location.id AS "locationId"',
        'location.code AS "locationCode"',
        'fromWarehouse.id AS "fromWarehouseId"',
        'fromWarehouse.name AS "fromWarehouseName"',
        'fromLocation.id AS "fromLocationId"',
        'fromLocation.code AS "fromLocationCode"',
        'toWarehouse.id AS "toWarehouseId"',
        'toWarehouse.name AS "toWarehouseName"',
        'toLocation.id AS "toLocationId"',
        'toLocation.code AS "toLocationCode"',
        'encargado.id AS "encargadoId"',
        'encargado.username AS "encargadoUsername"',
        'encargado."fullName" AS "encargadoFullName"',
      ])
      .orderBy('movement.date', 'DESC');

    if (query.warehouseId) {
      qb.andWhere(
        '(movement."warehouseId" = :warehouseId OR movement."fromWarehouseId" = :warehouseId OR movement."toWarehouseId" = :warehouseId)',
        { warehouseId: query.warehouseId },
      );
    }
    if (query.locationId) {
      qb.andWhere(
        '(movement."locationId" = :locationId OR movement."fromLocationId" = :locationId OR movement."toLocationId" = :locationId)',
        { locationId: query.locationId },
      );
    }
    if (query.productId) qb.andWhere('movement."productId" = :productId', { productId: query.productId });
    if (query.type) qb.andWhere('movement.type = :type', { type: query.type });
    if (query.status) qb.andWhere('movement.status = :status', { status: query.status });
    if (query.dateFrom) qb.andWhere('movement.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    if (query.dateTo) qb.andWhere('movement.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(
          LOWER(COALESCE(movement."documentNumber", '')) LIKE :search
          OR LOWER(COALESCE(movement.supplier, '')) LIKE :search
          OR LOWER(COALESCE(movement.destination, '')) LIKE :search
          OR LOWER(COALESCE(movement.notes, '')) LIKE :search
          OR LOWER(COALESCE(product.code, '')) LIKE :search
          OR LOWER(COALESCE(product.description, '')) LIKE :search
          OR LOWER(COALESCE(lot."lotCode", '')) LIKE :search
          OR LOWER(COALESCE(dl_agg."lotCodes", '')) LIKE :search
        )`,
        { search },
      );
    }

    const [data, totalRow] = await Promise.all([
      qb.clone().offset((page - 1) * limit).limit(limit).getRawMany(),
      qb.clone().select('COUNT(movement.id)', 'total').orderBy().getRawOne(),
    ]);

    return {
      data: data.map((row) => this.mapMovementRow(row)),
      meta: {
        page,
        limit,
        total: this.parseNumber(totalRow?.total),
        totalPages: Math.max(1, Math.ceil(this.parseNumber(totalRow?.total) / limit)),
      },
    };
  }

  async findOne(id: string) {
    const qb = this.dataSource
      .getRepository(Movement)
      .createQueryBuilder('movement')
      .leftJoin('products', 'product', 'product.id = movement."productId"')
      .leftJoin('warehouses', 'warehouse', 'warehouse.id = movement."warehouseId"')
      .leftJoin('locations', 'location', 'location.id = movement."locationId"')
      .leftJoin('warehouses', 'fromWarehouse', 'fromWarehouse.id = movement."fromWarehouseId"')
      .leftJoin('locations', 'fromLocation', 'fromLocation.id = movement."fromLocationId"')
      .leftJoin('warehouses', 'toWarehouse', 'toWarehouse.id = movement."toWarehouseId"')
      .leftJoin('locations', 'toLocation', 'toLocation.id = movement."toLocationId"')
      .leftJoin('users', 'encargado', 'encargado.id = movement."encargadoRecepcionId"')
      .leftJoin('lots', 'lot', 'lot.id = movement."lotId"')
      .leftJoin(
        (sq) =>
          sq
            .from('movement_details', 'md')
            .innerJoin('lots', 'dl', 'dl.id = md."lotId"')
            .select('md."movementId"', 'movementId')
            .addSelect('STRING_AGG(DISTINCT dl."lotCode", \', \' ORDER BY dl."lotCode")', 'lotCodes')
            .addSelect('STRING_AGG(DISTINCT dl."sapLot", \', \' ORDER BY dl."sapLot")', 'sapLots')
            .addSelect('COUNT(DISTINCT dl.id)', 'lotCount')
            .groupBy('md."movementId"'),
        'dl_agg',
        'dl_agg."movementId" = movement.id',
      )
      .select([
        'movement.id AS id',
        'movement.type AS type',
        'movement.date AS date',
        'movement.quantity AS quantity',
        'movement.pallets AS pallets',
        'movement.documentNumber AS "documentNumber"',
        'movement.supplier AS supplier',
        'movement.carrier AS carrier',
        'movement.driver AS driver',
        'movement.destination AS destination',
        'movement.notes AS notes',
        'movement.status AS status',
        'movement."adjustmentReason" AS "adjustmentReason"',
        'movement."adjustmentCategory" AS "adjustmentCategory"',
        'movement.createdById AS "createdById"',
        'movement.createdAt AS "createdAt"',
        'movement.palletId AS "palletId"',
        'movement.lotId AS "lotId"',
        'COALESCE(lot."lotCode", dl_agg."lotCodes") AS "lotCode"',
        'COALESCE(lot."sapLot", dl_agg."sapLots") AS "sapLot"',
        'COALESCE(dl_agg."lotCount", CASE WHEN lot.id IS NOT NULL THEN 1 ELSE 0 END) AS "lotCount"',
        'product.id AS "productId"',
        'product.code AS "productCode"',
        'product.description AS "productDescription"',
        'product."unitOfMeasure" AS "unitOfMeasure"',
        'warehouse.id AS "warehouseId"',
        'warehouse.name AS "warehouseName"',
        'location.id AS "locationId"',
        'location.code AS "locationCode"',
        'fromWarehouse.id AS "fromWarehouseId"',
        'fromWarehouse.name AS "fromWarehouseName"',
        'fromLocation.id AS "fromLocationId"',
        'fromLocation.code AS "fromLocationCode"',
        'toWarehouse.id AS "toWarehouseId"',
        'toWarehouse.name AS "toWarehouseName"',
        'toLocation.id AS "toLocationId"',
        'toLocation.code AS "toLocationCode"',
        'encargado.id AS "encargadoId"',
        'encargado.username AS "encargadoUsername"',
        'encargado."fullName" AS "encargadoFullName"',
      ])
      .where('movement.id = :id', { id });

    const movement = await qb.getRawOne();
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    return this.mapMovementRow(movement);
  }

  // ─── Privados ────────────────────────────────────────────────────────────────

  private validateBusinessRules(dto: CreateMovementDto & { quantity: number }) {
    if (dto.quantity <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    if (dto.type === 'TRANSFER' && (!dto.fromLocationId || !dto.toLocationId)) {
      throw new BadRequestException('TRANSFER requiere ubicación origen y destino');
    }

    if (dto.type === 'TRANSFER' && dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Origen y destino no pueden ser la misma ubicación');
    }
  }

  private async resolveLocationsAndWarehouses(manager: EntityManager, dto: CreateMovementDto) {
    const location = dto.locationId ? await this.findLocation(manager, dto.locationId) : null;
    const fromLocation = dto.fromLocationId ? await this.findLocation(manager, dto.fromLocationId) : null;
    const toLocation = dto.toLocationId ? await this.findLocation(manager, dto.toLocationId) : null;

    return {
      warehouseId: location?.warehouse.id ?? dto.warehouseId ?? null,
      locationId: location?.id ?? null,
      fromWarehouseId: fromLocation?.warehouse.id ?? null,
      toWarehouseId: toLocation?.warehouse.id ?? null,
    };
  }

  private async ensureExplicitWarehouseConsistency(
    manager: EntityManager,
    dto: CreateMovementDto,
    resolved: { warehouseId: string | null; locationId: string | null },
  ) {
    if (!dto.warehouseId) return;

    const warehouse = await manager.findOne(Warehouse, { where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('Depósito inexistente');

    if (resolved.locationId && resolved.warehouseId && dto.warehouseId !== resolved.warehouseId) {
      throw new BadRequestException('La ubicación no pertenece al depósito indicado');
    }
  }

  private async findLocation(manager: EntityManager, id: string) {
    const location = await manager.findOne(Location, { where: { id } });
    if (!location || !location.active) {
      throw new NotFoundException(`Ubicación inexistente o inactiva: ${id}`);
    }
    return location;
  }

  private async applyIncrease(
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null, quantity: number,
  ) {
    const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
    stock.currentQuantity += quantity;
    stock.updatedAt = new Date();
    await manager.save(stock);
  }

  private async applyDecrease(
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null, quantity: number,
  ) {
    const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
    if (stock.currentQuantity < quantity) {
      throw new BadRequestException('Stock insuficiente para completar la operación');
    }
    stock.currentQuantity -= quantity;
    stock.updatedAt = new Date();
    await manager.save(stock);
  }

  /**
   * Obtiene (con lock pesimista) o crea la fila de stock de una celda
   * (producto+depósito+ubicación). El lock serializa el read-modify-write
   * concurrente sobre una celda EXISTENTE → evita lost updates / sobreventa
   * (el caso de alta frecuencia: dos salidas del mismo producto/ubicación).
   *
   * Para una celda NUEVA el caller setea la cantidad y guarda. La carrera
   * create-create (dos entradas simultáneas de una celda inexistente) la cubre
   * el índice único `uq_stock_cell`: la segunda inserción falla con 23505 y la
   * operación se reintenta, en vez de quedar dos filas divergentes en silencio.
   *
   * Requiere estar dentro de una transacción (manager transaccional).
   */
  private async findOrCreateStock(
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null,
  ) {
    const repository = manager.getRepository(Stock);
    const existing = await repository.findOne({
      where: { productId, warehouseId: warehouseId ?? IsNull(), locationId: locationId ?? IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) return existing;
    return repository.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
  }

  private async findOrCreateLot(
    manager: EntityManager,
    productId: string,
    lotCode: string,
    fechaVencimiento?: string,
    proveedor?: string,
    fechaFabricacion?: string,
    sapLot?: string,
    status = 'NORMAL',
  ): Promise<Lot> {
    const repo = manager.getRepository(Lot);
    lotCode = normalizeLotCode(lotCode);
    let lot = await repo.findOne({ where: { productId, lotCode } });
    if (!lot) {
      lot = repo.create({
        productId, lotCode,
        fechaVencimiento: fechaVencimiento ?? null,
        fechaFabricacion: fechaFabricacion ?? null,
        proveedor: proveedor ?? null,
        sapLot: sapLot ?? null,
        stockActual: 0,
        status,
      });
      lot = await repo.save(lot);
    } else {
      let changed = false;
      if (fechaVencimiento && !lot.fechaVencimiento) { lot.fechaVencimiento = fechaVencimiento; changed = true; }
      if (proveedor && !lot.proveedor) { lot.proveedor = proveedor; changed = true; }
      if (fechaFabricacion && !lot.fechaFabricacion) { lot.fechaFabricacion = fechaFabricacion; changed = true; }
      if (sapLot && !lot.sapLot) { lot.sapLot = sapLot; changed = true; }
      if (changed) lot = await repo.save(lot);
    }
    return lot;
  }

  private async updateLotStock(manager: EntityManager, lotId: string, delta: number) {
    const repo = manager.getRepository(Lot);
    // Lock pesimista vía QueryBuilder: dos movimientos que tocan el mismo lote se
    // serializan. Se usa QB (no findOne) porque Lot tiene un @ManyToOne(Product)
    // eager y FOR UPDATE no puede aplicarse al lado nullable de un outer join.
    const lot = await repo
      .createQueryBuilder('lot')
      .setLock('pessimistic_write')
      .where('lot.id = :id', { id: lotId })
      .getOne();
    if (lot) {
      lot.stockActual = Math.max(0, lot.stockActual + delta);
      await repo.save(lot);
    }
  }

  private parseNumber(value: unknown) { return Number(value) || 0; }

  private toStartDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
    return new Date(value);
  }

  private toEndDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`);
    return new Date(value);
  }

  private mapMovementRow(row: Record<string, unknown>) {
    return {
      id: row.id, type: row.type, date: row.date,
      status: row.status ?? 'NORMAL',
      adjustmentReason: row.adjustmentReason ?? null,
      adjustmentCategory: row.adjustmentCategory ?? null,
      quantity: this.parseNumber(row.quantity),
      pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
      documentNumber: row.documentNumber, supplier: row.supplier, carrier: row.carrier,
      driver: row.driver, destination: row.destination, notes: row.notes,
      createdById: row.createdById, createdAt: row.createdAt ?? row.date,
      palletId: row.palletId, lotId: row.lotId, lotCode: row.lotCode ?? null, sapLot: row.sapLot ?? null,
      lotCount: this.parseNumber(row.lotCount),
      encargado: row.encargadoId ? { id: row.encargadoId, username: row.encargadoUsername, fullName: row.encargadoFullName } : null,
      material: {
        id: row.productId, code: row.productCode,
        description: row.productDescription, unitOfMeasure: row.unitOfMeasure,
      },
      warehouse: row.warehouseId ? { id: row.warehouseId, name: row.warehouseName } : null,
      location: row.locationId ? { id: row.locationId, code: row.locationCode } : null,
      from: row.fromLocationId || row.fromWarehouseId
        ? { warehouseId: row.fromWarehouseId, warehouseName: row.fromWarehouseName, locationId: row.fromLocationId, locationCode: row.fromLocationCode }
        : null,
      to: row.toLocationId || row.toWarehouseId
        ? { warehouseId: row.toWarehouseId, warehouseName: row.toWarehouseName, locationId: row.toLocationId, locationCode: row.toLocationCode }
        : null,
    };
  }

  private async autoFefoExit(
    manager: EntityManager,
    productId: string,
    locationId: string | null,
    warehouseId: string | null,
    quantity: number,
    movementId: string,
  ): Promise<void> {
    const palletRepo = manager.getRepository(Pallet);

    const qb = palletRepo
      .createQueryBuilder('pallet')
      .innerJoin('lots', 'lot', 'lot.id = pallet."lotId"')
      // AVAILABLE y PARTIAL: el auto-FEFO también consume de pallets ya abiertos
      // (los más viejos), no solo de los intactos. Excluye BLOCKED/DAMAGED/EXITED/EMPTY.
      .where('pallet.status IN (:...statuses)', { statuses: ['AVAILABLE', 'PARTIAL'] })
      .andWhere('pallet.quantity > 0')
      .andWhere('lot."productId" = :productId', { productId })
      .andWhere("lot.status != 'PENDING_REGULARIZATION'")
      .orderBy("COALESCE(lot.\"fechaVencimiento\", '9999-12-31')", 'ASC')
      .addOrderBy('pallet."createdAt"', 'ASC');

    if (locationId) {
      qb.andWhere('pallet."currentLocationId" = :locationId', { locationId });
    } else if (warehouseId) {
      qb.innerJoin('locations', 'loc', 'loc.id = pallet."currentLocationId"')
        .andWhere('loc."warehouseId" = :warehouseId', { warehouseId });
    }

    // Selección FEFO sin lock (solo para ordenar candidatos). El lock se toma
    // por-palet adentro del loop, en orden FEFO consistente → sin deadlock.
    const candidates = await qb.getMany();

    let remaining = quantity;
    for (const candidate of candidates) {
      if (remaining <= 0) break;

      // Re-leer con lock pesimista y revalidar: otra salida concurrente pudo
      // haber tomado este palet entre la selección y este punto.
      const pallet = await palletRepo.findOne({ where: { id: candidate.id }, lock: { mode: 'pessimistic_write' } });
      if (!pallet || pallet.quantity <= 0 || pallet.status === 'EXITED' || pallet.status === 'EMPTY') continue;

      const take = Math.min(pallet.quantity, remaining);

      const stockLocationId: string | null = pallet.currentLocationId ?? null;
      let stockWarehouseId: string | null = null;
      if (stockLocationId) {
        const loc = await manager.findOne(Location, { where: { id: stockLocationId } });
        stockWarehouseId = loc?.warehouse?.id ?? null;
      }
      await this.applyDecrease(manager, productId, stockWarehouseId, stockLocationId, take);

      pallet.quantity -= take;
      if (pallet.quantity === 0) {
        pallet.status = 'EXITED';
        pallet.exitedAt = new Date();
      } else if (pallet.status === 'AVAILABLE' || pallet.status === 'PARTIAL') {
        pallet.status = 'PARTIAL';
      }
      await manager.save(pallet);

      const detail = manager.create(MovementDetail, {
        movementId,
        lotId: pallet.lotId,
        palletId: pallet.id,
        quantity: take,
        locationId: pallet.currentLocationId ?? undefined,  // FIX 4: ubicación física del palet
      });
      await manager.save(detail);

      await this.updateLotStock(manager, pallet.lotId, -take);
      remaining -= take;
    }

    if (remaining > 0) {
      throw new BadRequestException(
        `Stock insuficiente: se pueden despachar ${quantity - remaining} de ${quantity} unidades solicitadas`,
      );
    }
  }

  private describeImpact(type: MovementType) {
    if (type === 'TRANSFER') return 'Actualiza ubicación del palet';
    if (type === 'EXIT' || type === 'ADJUSTMENT_OUT') return 'Resta stock';
    return 'Suma stock';
  }
}
