import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import * as XLSX from 'xlsx';
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { AdjustmentRequest } from '../adjustments/entities/adjustment-request.entity';
import { AdjustmentRequestLine } from '../adjustments/entities/adjustment-request-line.entity';
import { UploadsService } from '../uploads/uploads.service';
import { RegularizeMovementDto } from './dto/regularize-movement.dto';
import { RequestQuantityEditDto } from './dto/request-quantity-edit.dto';
import { TransferBatchDto } from './dto/transfer-batch.dto';
import { MovementsQueryDto } from './dto/movements-query.dto';
import { PreviewPlacementDto } from './dto/preview-placement.dto';
import { Movement, MovementType } from './entities/movement.entity';
import { MovementDetail } from './entities/movement-detail.entity';
import { LogisticsDocument } from './entities/logistics-document.entity';
import { RegularizationLog } from './entities/regularization-log.entity';
import { DocumentSequenceService } from './document-sequence.service';
import { Product } from '../products/entities/product.entity';
import { Location } from '../locations/entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { User } from '../users/entities/user.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Lot } from '../lots/entities/lot.entity';
import { normalizeLotCode } from '../lots/lots.service';
import { Pallet } from '../pallets/entities/pallet.entity';
import { DeepPartial } from 'typeorm/common/DeepPartial';
import { EventsGateway } from '../events/events.gateway';
import { CacheService } from '../cache/cache.service';
import { roundQuantity } from '../../common/quantity';
import {
  businessToday,
  endOfBusinessDay,
  formatBusinessDate,
  parseBusinessDate,
  parseExcelDateCell,
} from '../../common/date';
import { PilasService, PlacementItem } from '../pilas/pilas.service';

@Injectable()
export class MovementsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventsGateway,
    private readonly cache: CacheService,
    private readonly sequences: DocumentSequenceService,
    private readonly uploads: UploadsService,
    private readonly pilas: PilasService,
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

    // ── 3. Verificar que la compensación sea aplicable ───
    // Anular una entrada implica sacar del depósito lo que entró. Si esa mercadería
    // ya salió, la compensación nunca podría aprobarse y el movimiento quedaría
    // atascado en VOID_PENDING: mejor rechazar acá con un mensaje entendible.
    const warnings: string[] = [];
    if (isIncrease && details.length > 0) {
      const palletIds = details.map((d) => d.palletId).filter(Boolean) as string[];
      if (palletIds.length > 0) {
        const pallets = await this.dataSource.getRepository(Pallet).findByIds(palletIds);
        const palletMap = Object.fromEntries(pallets.map((p) => [p.id, p]));
        const faltantes = details
          .filter((d) => d.palletId && d.quantity > 0)
          .map((d) => ({ detail: d, pallet: palletMap[d.palletId!] }))
          .filter(({ detail, pallet }) => !pallet || pallet.status === 'EXITED' || pallet.quantity < detail.quantity);

        if (faltantes.length > 0) {
          const detalle = faltantes
            .slice(0, 3)
            .map(({ detail, pallet }) =>
              `${pallet?.code ?? 'palet eliminado'} (quedan ${pallet?.quantity ?? 0} de ${detail.quantity})`)
            .join(', ');
          throw new BadRequestException(
            `No se puede anular: la mercadería de ${faltantes.length} palet(s) ya salió del depósito — ${detalle}. ` +
            `Registrá un Ajuste de Inventario en lugar de anular.`,
          );
        }

        const partial = pallets.filter((p) => p.status === 'PARTIAL');
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
        notes: `Anulación automática de ${movement.type} del ${formatBusinessDate(movement.date)}${movement.documentNumber ? ` · MIC/Fac/Rem. ${movement.documentNumber}` : ''}`,
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

  /**
   * Reintenta una vez ante una violación de índice único (23505). El caso real es
   * la carrera create-create de un lote nuevo: dos entradas simultáneas del mismo
   * `lotCode` hacen SELECT (no existe) e INSERT; con `uq_lot_product_code` la
   * segunda falla, y al reintentar ya encuentra el lote y suma sobre él.
   */
  private async withUniqueRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== '23505') throw error;
      return operation();
    }
  }

  async create(dto: CreateMovementDto, userId: string, requesterRole?: string) {
    // El encargado sale del JWT, no del payload (ver resolveEncargado).
    const effectiveDto: CreateMovementDto = {
      ...dto,
      encargadoRecepcionId: this.resolveEncargado(dto.encargadoRecepcionId, userId, requesterRole),
    };

    const result = await this.withUniqueRetry(() =>
      this.dataSource.transaction((manager) =>
        this.createInTransaction(manager, effectiveDto, userId),
      ),
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
   * El encargado del remito es el usuario logueado. El backend lo toma del JWT
   * y no del payload: si el cliente manda otro, solo se acepta cuando quien
   * opera es ADMIN o MANAGER (reasignación explícita). Un OPERATOR no puede
   * registrar un remito a nombre de otra persona.
   */
  private resolveEncargado(requestedId: string | undefined, userId: string, role?: string): string {
    if (!requestedId || requestedId === userId) return userId;
    if (role === 'ADMIN' || role === 'MANAGER') return requestedId;
    throw new ForbiddenException(
      'Solo un ADMIN o MANAGER puede asignar el remito a otro encargado.',
    );
  }

  /**
   * Vista previa de colocación: cómo van a quedar armadas las pilas para
   * `palletCount` pallets de `productId` entrando a `locationId`. No
   * confirma nada — la colocación real se decide de nuevo (y ahí sí se
   * confirma) cuando se envía la entrada.
   */
  async previewPlacement(dto: PreviewPlacementDto) {
    const items: PlacementItem[] = Array.from({ length: dto.palletCount }, (_, i) => ({
      key: String(i),
      productId: dto.productId,
    }));
    return this.pilas.placePallets(this.dataSource.manager, dto.locationId, items, { commit: false });
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

      // Ubicación real de los pallets existentes que referencian los ítems (p.ej.
      // al restaurar cantidad a un pallet ya EXITED, corrigiendo una salida): sin
      // esto, si el movimiento no trae depósito/ubicación propios —como CUALQUIER
      // salida, que nunca los pide— el aumento de stock cae en un balde sin
      // ubicación mientras el pallet físico queda con el saldo en su sector real,
      // y el localizador reporta una diferencia fantasma en esa ubicación.
      const palletIdsForLocation = [...new Set(
        (dto.palletItems ?? []).map((i) => i.palletId).filter((v): v is string => !!v),
      )];
      const palletLocationById = new Map<string, string | null>();
      if (palletIdsForLocation.length) {
        const referenced = await manager.getRepository(Pallet).find({ where: { id: In(palletIdsForLocation) } });
        for (const p of referenced) palletLocationById.set(p.id, p.currentLocationId ?? null);
      }

      // Ubicación efectiva de cada ítem: la suya propia si el gestor de pallets la
      // definió; si no, pero el ítem apunta a un pallet existente, la de ese pallet;
      // si no, la de la línea.
      const itemLocationId = (item: { locationId?: string; palletId?: string }): string | null => {
        if (item.locationId) return item.locationId;
        const palletLoc = item.palletId ? palletLocationById.get(item.palletId) : undefined;
        if (palletLoc) return palletLoc;
        return resolved.locationId ?? null;
      };

      if (dto.palletItems?.length) {
        // ENTRY/ADJUSTMENT_IN: aumentar stock ahora, **por ubicación**.
        // EXIT/ADJUSTMENT_OUT: reducir palet a palet en el loop (por ubicación real del palet).
        // TRANSFER: reducir/aumentar palet a palet en el loop.
        if (isEntry) {
          // Agrupado por celda: si el lote se reparte entre sectores, cada uno
          // recibe su parte. Una sola fila con el total dejaría stock en un
          // sector sin pallets que lo respalden (rompe Stock = Lotes = Pallets).
          const qtyByLocation = new Map<string | null, number>();
          for (const item of dto.palletItems) {
            const locId = itemLocationId(item);
            qtyByLocation.set(locId, roundQuantity((qtyByLocation.get(locId) ?? 0) + item.quantity));
          }
          for (const [locId, qty] of qtyByLocation) {
            const warehouseId = locId
              ? (await this.findLocation(manager, locId)).warehouse.id
              : resolved.warehouseId;
            await this.applyIncrease(manager, dto.productId, warehouseId, locId, qty);
          }
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
        date: parseBusinessDate(dto.date),
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
        driverDocument: dto.driverDocument?.trim() || undefined,
        destination: dto.destination?.trim() || undefined,
        documentoMaterial: dto.type === 'EXIT' ? dto.documentoMaterial?.trim() || undefined : undefined,
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

      // ENTRADA: resolver los lotes de antemano y armar el plan de pilas para
      // todo el lote de una vez — el motor de colocación necesita ver todos
      // los pallets juntos para decidir cómo se agrupan (no tiene sentido
      // llamarlo palet a palet, perdería la posibilidad de consolidar).
      const lotByItemIndex = new Map<number, Lot>();
      let placementByKey: Map<string, { pilaId: string; stackPosition: number }> | null = null;

      if (dto.type === 'ENTRY' && dto.palletItems?.length) {
        // Se agrupa por sector destino: el motor tiene que ver juntos todos los
        // pallets que van al mismo sector para poder consolidarlos en una pila
        // y para contar bien las bases contra la capacidad.
        const byLocation = new Map<string, PlacementItem[]>();
        for (let idx = 0; idx < dto.palletItems.length; idx++) {
          const item = dto.palletItems[idx];
          if (!item.lotCode) continue;
          const locId = itemLocationId(item);
          if (!locId) continue; // sin ubicación no hay pila que armar

          const lot = await this.findOrCreateLot(
            manager, dto.productId, item.lotCode,
            item.fechaVencimiento, item.proveedor,
            item.fechaFabricacion, item.sapLot,
            dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
            item.supplierLot,
          );
          lotByItemIndex.set(idx, lot);
          byLocation.set(locId, [
            ...(byLocation.get(locId) ?? []),
            { key: String(idx), productId: dto.productId, lotId: lot.id },
          ]);
        }

        if (byLocation.size > 0) {
          placementByKey = new Map();
          for (const [locId, placementItems] of byLocation) {
            const plan = await this.pilas.placePallets(manager, locId, placementItems, { commit: true });
            for (const pile of plan.piles) {
              for (const pileItem of pile.items) {
                placementByKey.set(pileItem.key, { pilaId: pile.pilaId, stackPosition: pileItem.stackPosition });
              }
            }
          }
        }
      }

      // Loop palet a palet
      if (dto.palletItems?.length) {
        for (let itemIdx = 0; itemIdx < dto.palletItems.length; itemIdx++) {
          const item = dto.palletItems[itemIdx];
          let resolvedLotId: string | undefined;
          let resolvedPalletId: string | undefined = item.palletId;
          let resolvedPilaId: string | undefined;
          // locationId para MovementDetail — ubicación física del palet en este movimiento
          let detailLocationId: string | null = null;

          if (item.palletId) {
            // Lock pesimista: evita que dos despachos concurrentes resten del mismo palet.
            const pallet = await manager.getRepository(Pallet).findOne({ where: { id: item.palletId }, lock: { mode: 'pessimistic_write' } });
            if (!pallet) throw new NotFoundException(`Palet no encontrado: ${item.palletId}`);
            // ADJUSTMENT_IN restaura cantidad a un palet existente (típicamente ya EXITED
            // por la salida que se está corrigiendo) — para el resto de los tipos, un
            // palet ya despachado no puede volver a tocarse.
            if (dto.type !== 'ADJUSTMENT_IN' && pallet.status === 'EXITED') {
              throw new BadRequestException(`El palet ${pallet.code} ya fue despachado`);
            }
            resolvedLotId = pallet.lotId;
            // Para EXIT/TRANSFER: la ubicación de origen es donde estaba el palet
            detailLocationId = pallet.currentLocationId ?? null;
            // Pila de la que sale — se evalúa después de guardar para saber si
            // su base quedó libre (solo si no queda ningún otro pallet apilado).
            const originPilaId = pallet.pilaId ?? null;

            // El palet debe pertenecer al material de la línea: si no, se descontaría
            // stock del producto A moviendo un palet del producto B.
            const palletOwner = await manager.getRepository(Lot).findOne({ where: { id: pallet.lotId } });
            if (palletOwner && palletOwner.productId !== dto.productId) {
              throw new BadRequestException(
                `El palet ${pallet.code} pertenece al lote "${palletOwner.lotCode}" de otro material.`,
              );
            }

            if (dto.type === 'EXIT' || dto.type === 'ADJUSTMENT_OUT') {
              // Verificar que el lote no esté pendiente de regularización
              const palletLot = palletOwner;
              if (palletLot?.status === 'PENDING_REGULARIZATION') {
                throw new BadRequestException(
                  `El lote "${palletLot.lotCode}" está pendiente de regularización. Regularizá el lote antes de despachar.`,
                );
              }

              // Tope por saldo del palet: sin esto el stock se descuenta por la cantidad
              // pedida mientras el palet solo baja lo que tiene, y las tres contabilidades
              // (stock / lote / palet) divergen en silencio.
              if (item.quantity > pallet.quantity) {
                throw new BadRequestException(
                  `El palet ${pallet.code} tiene ${pallet.quantity} unid. disponibles — no se pueden retirar ${item.quantity}.`,
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
              pallet.quantity = Math.max(0, roundQuantity(pallet.quantity - item.quantity));
              if (pallet.quantity === 0) {
                pallet.status = 'EXITED';
                pallet.exitedAt = new Date();
              } else if (pallet.status === 'AVAILABLE' || pallet.status === 'PARTIAL') {
                pallet.status = 'PARTIAL';
              }

            } else if (dto.type === 'TRANSFER') {
              // El palet se mueve entero: si se transfiriera solo una parte, el stock se
              // repartiría entre dos celdas mientras el palet queda en una sola, y la
              // ubicación de origen mostraría stock sin palet que lo respalde.
              if (item.quantity !== pallet.quantity) {
                throw new BadRequestException(
                  `El palet ${pallet.code} tiene ${pallet.quantity} unid. y se transfiere completo. ` +
                  `Para mover una parte, primero dividí el palet.`,
                );
              }

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

              // El palet necesita una pila en el sector destino — la de origen
              // ya no aplica (puede estar en otro Sector-Subsector entero).
              if (dto.toLocationId) {
                const destPlan = await this.pilas.placePallets(
                  manager, dto.toLocationId,
                  [{ key: 'x', productId: dto.productId, lotId: pallet.lotId }],
                  { commit: true },
                );
                const destPile = destPlan.piles[0];
                pallet.pilaId = destPile?.pilaId ?? null;
                pallet.stackPosition = destPile?.items[0]?.stackPosition ?? null;
                resolvedPilaId = pallet.pilaId ?? undefined;
              } else {
                pallet.pilaId = null;
                pallet.stackPosition = null;
              }

            } else if (dto.type === 'ADJUSTMENT_IN') {
              // Corrección de salida: devolver cantidad a un palet ya existente (posiblemente
              // EXITED). El stock agregado ya se sumó arriba (isEntry → applyIncrease con el
              // total); acá solo se sincroniza el objeto palet puntual.
              pallet.quantity += item.quantity;
              if (pallet.quantity > 0 && pallet.status === 'EXITED') {
                pallet.status = 'PARTIAL';
                pallet.exitedAt = null;
              }
            }

            await manager.save(pallet);

            // El pallet dejó su pila (salió del todo o se movió a otra): la base
            // de origen se libera únicamente si ya no queda ningún pallet vivo
            // en esa pila — sacar uno de una pila de tres no libera el lugar.
            if (originPilaId && (pallet.status === 'EXITED' || pallet.pilaId !== originPilaId)) {
              await this.pilas.releaseIfEmpty(manager, originPilaId);
            }

          } else if (item.lotCode) {
            // ENTRADA: lote ya resuelto arriba (junto con el plan de colocación).
            const lot = lotByItemIndex.get(itemIdx) ?? await this.findOrCreateLot(
              manager, dto.productId, item.lotCode,
              item.fechaVencimiento, item.proveedor,
              item.fechaFabricacion, item.sapLot,
              dto.isProvisional ? 'PENDING_REGULARIZATION' : 'NORMAL',
              item.supplierLot,
            );
            resolvedLotId = lot.id;
            const existingCount = await manager.getRepository(Pallet).count({ where: { lotId: lot.id } });
            const placement = placementByKey?.get(String(itemIdx));
            // El código incluye el material porque `pallets.code` es único global
            // y el código de lote NO lo es: los lotes SAP se numeran por fecha
            // (Z011008201), así que dos materiales recibidos el mismo día comparten
            // lote y, sin el prefijo, el segundo palet choca contra el índice único.
            const palletLocationId = itemLocationId(item);
            const pallet = manager.getRepository(Pallet).create({
              code: `${product.code}-${lot.lotCode}-P${existingCount + 1}`,
              lotId: lot.id,
              quantity: item.quantity,
              currentLocationId: palletLocationId,
              status: 'AVAILABLE',
              weightKg: item.weightKg ?? null,
              pilaId: placement?.pilaId ?? null,
              stackPosition: placement?.stackPosition ?? null,
            });
            const savedPallet = await manager.save(pallet);
            resolvedPalletId = savedPallet.id;
            resolvedPilaId = placement?.pilaId;
            // Para ENTRADA: la ubicación de destino es donde queda el palet
            detailLocationId = palletLocationId;
          } else {
            // Ni palletId (existente) ni lotCode (nuevo): sin esto no hay forma de crear
            // el lote/pallet correspondiente y el stock agregado quedaría desincronizado
            // del invariante Stock=Lote=Pallet.
            throw new BadRequestException('Cada ítem debe indicar un pallet existente (palletId) o un código de lote (lotCode).');
          }

          if (resolvedLotId) {
            const detail = manager.create(MovementDetail, {
              movementId: movement.id,
              lotId: resolvedLotId,
              palletId: resolvedPalletId ?? undefined,
              quantity: item.quantity,
              locationId: detailLocationId ?? undefined,  // ← FIX 1: guardar ubicación física
              pilaId: resolvedPilaId ?? undefined,
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
   * Resuelve el único depósito operativo del documento antes de emitir su
   * código. En ENTRADA exige el depósito elegido y valida las ubicaciones por
   * pallet. En SALIDA bloquea los pallets referenciados y deriva su depósito
   * físico de origen, rechazando explícitamente cualquier mezcla.
   */
  private async resolveDocumentWarehouse(
    manager: EntityManager,
    dto: CreateDocumentDto,
  ): Promise<Warehouse> {
    const locationIds = new Set<string>();
    const palletIds = new Set<string>();

    for (const line of dto.lines) {
      if (line.locationId) locationIds.add(line.locationId);
      for (const item of line.palletItems ?? []) {
        if (item.palletId) palletIds.add(item.palletId);
        else if (item.locationId) locationIds.add(item.locationId);
      }
    }

    if (dto.type === 'EXIT' && palletIds.size > 0) {
      const ids = [...palletIds];
      const pallets = await manager.getRepository(Pallet)
        .createQueryBuilder('pallet')
        .setLock('pessimistic_write')
        .where('pallet.id IN (:...ids)', { ids })
        .getMany();

      if (pallets.length !== ids.length) {
        throw new BadRequestException('La salida referencia uno o más pallets inexistentes');
      }
      const unlocated = pallets.find((pallet) => !pallet.currentLocationId);
      if (unlocated) {
        throw new BadRequestException(
          `No se puede determinar el depósito origen del pallet ${unlocated.code}: no tiene ubicación`,
        );
      }
      for (const pallet of pallets) locationIds.add(pallet.currentLocationId!);
    }

    const locations = locationIds.size
      ? await manager.getRepository(Location).find({ where: { id: In([...locationIds]) } })
      : [];
    if (locations.length !== locationIds.size) {
      throw new BadRequestException('El documento referencia una ubicación inexistente');
    }

    const locationWarehouseIds = new Set(locations.map((location) => location.warehouse.id));
    let warehouseId: string;

    if (dto.type === 'ENTRY') {
      if (!dto.warehouseId) {
        throw new BadRequestException('La entrada requiere un depósito');
      }
      if ([...locationWarehouseIds].some((id) => id !== dto.warehouseId)) {
        throw new BadRequestException('Todos los pallets de la entrada deben pertenecer al depósito indicado');
      }
      warehouseId = dto.warehouseId;
    } else {
      if (locationWarehouseIds.size > 1) {
        throw new BadRequestException(
          'No se puede emitir una RLNS con pallets de depósitos distintos. Separá la salida por depósito.',
        );
      }
      const derivedWarehouseId = [...locationWarehouseIds][0];
      if (dto.warehouseId && derivedWarehouseId && dto.warehouseId !== derivedWarehouseId) {
        throw new BadRequestException('El depósito indicado no coincide con el origen real de los pallets');
      }
      warehouseId = derivedWarehouseId ?? dto.warehouseId ?? '';
      if (!warehouseId) {
        throw new BadRequestException('No se pudo determinar el depósito origen de la salida');
      }
    }

    const warehouse = await manager.findOne(Warehouse, { where: { id: warehouseId } });
    if (!warehouse || !warehouse.active) {
      throw new BadRequestException('El depósito del documento no existe o está inactivo');
    }
    if (!warehouse.documentCode || !/^\d{2}$/.test(warehouse.documentCode)) {
      throw new BadRequestException(
        `El depósito ${warehouse.name} no tiene configurado un código documental de 2 dígitos`,
      );
    }
    return warehouse;
  }

  /**
   * Crea un documento logístico (remito) con múltiples líneas (producto+lote+pallets)
   * en UNA sola transacción. Genera el código interno RLNE/RLNS y vincula cada
   * movimiento a la cabecera. Si una línea falla, se revierte TODO el documento.
   */
  async createDocument(dto: CreateDocumentDto, userId: string, requesterRole?: string) {
    if (dto.type !== 'EXIT' && dto.documentoMaterial?.trim()) {
      throw new BadRequestException('Documento Material solo corresponde a una Salida');
    }
    const encargadoId = this.resolveEncargado(dto.encargadoId, userId, requesterRole);

    const result = await this.withUniqueRetry(() => this.dataSource.transaction(async (manager) => {
      const docDate = parseBusinessDate(dto.date);
      const warehouse = await this.resolveDocumentWarehouse(manager, dto);
      const users = await manager.getRepository(User).find({
        where: { id: In([...new Set([userId, encargadoId])]) },
      });
      const createdBy = users.find((user) => user.id === userId);
      const encargado = users.find((user) => user.id === encargadoId);
      if (!createdBy) throw new NotFoundException('Usuario creador inexistente');
      if (!encargado) throw new NotFoundException('Usuario encargado inexistente');

      const code = await this.sequences.nextCode(manager, dto.type, docDate, {
        warehouseId: warehouse.id,
        documentCode: warehouse.documentCode!,
      });

      const document = manager.create(LogisticsDocument, {
        code,
        type: dto.type,
        status: 'APROBADO',
        date: docDate,
        documentNumber: dto.type === 'ENTRY' ? dto.documentNumber?.trim() || null : null,
        supplier: dto.supplier?.trim() || null,
        destination: dto.destination?.trim() || null,
        documentoMaterial: dto.type === 'EXIT' ? dto.documentoMaterial?.trim() || null : null,
        warehouseId: warehouse.id,
        warehouseNameSnapshot: warehouse.name,
        warehouseDocumentCodeSnapshot: warehouse.documentCode,
        carrier: dto.carrier?.trim() || null,
        driver: dto.driver?.trim() || null,
        driverDocument: dto.driverDocument?.trim() || null,
        vehiclePlate: dto.vehiclePlate?.trim() || null,
        encargadoId,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        createdByUsernameSnapshot: createdBy.username,
        createdByFullNameSnapshot: createdBy.fullName?.trim() || null,
        encargadoUsernameSnapshot: encargado.username,
        encargadoFullNameSnapshot: encargado.fullName?.trim() || null,
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
          warehouseId: warehouse.id,
          locationId: line.locationId,
          documentNumber: dto.type === 'ENTRY' ? dto.documentNumber : undefined,
          supplier: dto.supplier,
          carrier: dto.carrier,
          driver: dto.driver,
          driverDocument: dto.driverDocument,
          destination: dto.destination,
          documentoMaterial: dto.type === 'EXIT' ? dto.documentoMaterial : undefined,
          notes: dto.notes,
          lotId: line.lotId,
          encargadoRecepcionId: encargadoId,
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
        warehouseId: warehouse.id,
        movementIds,
      };
    }));

    // Post-transaction: invalidar cache + broadcast (una sola vez por documento)
    void Promise.all([
      this.cache.delPattern('kpis:*'),
      this.cache.delPattern('stock:*'),
    ]);
    this.events.emitStockUpdated({ warehouseId: result.warehouseId });

    void this.uploads.log('DOCUMENT', result.documentId, 'CREADO',
      `Remito ${result.code} creado con ${result.movementIds.length} línea(s)`,
      userId, undefined, undefined, result.code);

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
      qb.andWhere('(d.code ILIKE :s OR d.documentNumber ILIKE :s OR d.supplier ILIKE :s OR d.destination ILIKE :s OR d."documentoMaterial" ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    const documents = await qb.getMany();
    if (documents.length === 0) return documents.map((d) => ({ ...d, voidedLines: 0 }));

    // El status del documento (APROBADO, etc.) no cambia si una de sus líneas se
    // anula después — sigue siendo un remito válido como instancia. `voidedLines`
    // es la señal aparte para no mostrarlo como 100% intacto sin serlo.
    const voidCounts = await this.dataSource
      .createQueryBuilder()
      .from('movements', 'm')
      .select('m."documentId"', 'documentId')
      .addSelect('COUNT(*)', 'voided')
      .where('m."documentId" IN (:...ids)', { ids: documents.map((d) => d.id) })
      .andWhere('m."voidStatus" <> :none', { none: 'NONE' })
      .groupBy('m."documentId"')
      .getRawMany<{ documentId: string; voided: string }>();
    const voidedByDoc = new Map(voidCounts.map((c) => [c.documentId, Number(c.voided)]));

    return documents.map((d) => ({ ...d, voidedLines: voidedByDoc.get(d.id) ?? 0 }));
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

  /**
   * Documento enriquecido para impresión. La cabecera usa snapshots guardados
   * al emitir; las consultas vivas son únicamente fallback para documentos
   * históricos anteriores a la migración de snapshots.
   */
  async findDocumentForPrint(id: string) {
    const { document, movements, details } = await this.findDocument(id);

    const productIds = [...new Set(movements.map((m) => m.productId).filter(Boolean))] as string[];
    const lotIds = [...new Set([
      ...movements.map((m) => m.lotId).filter(Boolean),
      ...details.map((d) => d.lotId).filter(Boolean),
    ])] as string[];
    const palletIds = [...new Set(details.map((d) => d.palletId).filter(Boolean))] as string[];

    const detailLocationIds = [...new Set(details.map((d) => d.locationId).filter(Boolean))] as string[];
    const locations = detailLocationIds.length
      ? await this.dataSource.getRepository(Location).findByIds(detailLocationIds)
      : [];

    const warehouseIds = [...new Set([
      document.warehouseId,
      ...movements.flatMap((m) => [m.warehouseId, m.toWarehouseId, m.fromWarehouseId]).filter(Boolean),
      ...locations.map((l) => l.warehouse?.id),
    ].filter((v): v is string => !!v))];

    const userIds = [...new Set([document.createdById, document.encargadoId].filter((value): value is string => !!value))];

    const [products, lots, warehouses, pallets, users] = await Promise.all([
      productIds.length ? this.dataSource.getRepository(Product).findByIds(productIds) : Promise.resolve([] as Product[]),
      lotIds.length ? this.dataSource.getRepository(Lot).findByIds(lotIds) : Promise.resolve([] as Lot[]),
      warehouseIds.length ? this.dataSource.getRepository(Warehouse).findByIds(warehouseIds) : Promise.resolve([] as Warehouse[]),
      palletIds.length ? this.dataSource.getRepository(Pallet).findByIds(palletIds) : Promise.resolve([] as Pallet[]),
      userIds.length ? this.dataSource.getRepository(User).findByIds(userIds) : Promise.resolve([] as User[]),
    ]);

    const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const userMap = new Map(users.map((user) => [user.id, user]));

    const liveDocumentWarehouse = document.warehouseId
      ? warehouseMap.get(document.warehouseId)
      : undefined;
    const historicalLocationWarehouses = [...new Map(
      locations
        .map((location) => location.warehouse)
        .filter(Boolean)
        .map((warehouse) => [warehouse.id, warehouse]),
    ).values()];

    const warehouse = document.warehouseNameSnapshot
      ? {
          id: document.warehouseId ?? null,
          name: document.warehouseNameSnapshot,
          documentCode: document.warehouseDocumentCodeSnapshot ?? null,
        }
      : liveDocumentWarehouse
        ? {
            id: liveDocumentWarehouse.id,
            name: liveDocumentWarehouse.name,
            documentCode: liveDocumentWarehouse.documentCode ?? null,
          }
        : historicalLocationWarehouses.length > 0
          ? {
              id: historicalLocationWarehouses.length === 1 ? historicalLocationWarehouses[0].id : null,
              name: historicalLocationWarehouses.map((item) => item.name).join(', '),
              documentCode: historicalLocationWarehouses.length === 1
                ? (historicalLocationWarehouses[0].documentCode ?? null)
                : null,
            }
          : null;

    const liveCreatedBy = userMap.get(document.createdById);
    const createdBy = document.createdByUsernameSnapshot
      ? {
          id: document.createdById,
          username: document.createdByUsernameSnapshot,
          fullName: document.createdByFullNameSnapshot ?? null,
        }
      : {
          id: document.createdById,
          username: liveCreatedBy?.username ?? '—',
          fullName: liveCreatedBy?.fullName ?? null,
        };

    const liveEncargado = document.encargadoId ? userMap.get(document.encargadoId) : undefined;
    const encargado = document.encargadoId
      ? document.encargadoUsernameSnapshot
        ? {
            id: document.encargadoId,
            username: document.encargadoUsernameSnapshot,
            fullName: document.encargadoFullNameSnapshot ?? null,
          }
        : {
            id: document.encargadoId,
            username: liveEncargado?.username ?? '—',
            fullName: liveEncargado?.fullName ?? null,
          }
      : null;

    const logistics = {
      carrier: document.carrier ?? null,
      driver: document.driver ?? null,
      driverDocument: document.driverDocument ?? null,
      vehiclePlate: document.vehiclePlate ?? null,
    };

    return {
      document,
      warehouse,
      createdBy,
      encargado,
      logistics,
      movements,
      details,
      products,
      lots,
      warehouses,
      pallets,
      locations,
    };
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
      if (movement.type !== 'EXIT' && dto.documentoMaterial !== undefined) {
        throw new BadRequestException('Documento Material solo corresponde a una Salida');
      }

      const logs: DeepPartial<RegularizationLog>[] = [];

      const movementStringFields = [
        'documentNumber', 'supplier', 'carrier', 'driver', 'destination', 'documentoMaterial', 'notes',
      ] as const;

      let documentoMaterialChanged = false;
      let documentoMaterialValue: string | null = movement.documentoMaterial?.trim() || null;

      for (const field of movementStringFields) {
        if (dto[field] === undefined) continue;
        const newVal = dto[field]?.trim() || null;
        const oldRaw = movement[field] as string | null | undefined;
        const oldVal = oldRaw?.trim() || null;
        if (newVal !== oldVal) {
          logs.push({ movementId: id, field, oldValue: oldVal, newValue: newVal, changedById: userId, reason: dto.reason });
          (movement as unknown as Record<string, unknown>)[field] = newVal;
          if (field === 'documentoMaterial') {
            documentoMaterialChanged = true;
            documentoMaterialValue = newVal;
          }
        }
      }

      // Documento Material es de cabecera: mantener iguales todas las líneas
      // de una RLNS multi-producto y el snapshot de logistics_documents.
      if (documentoMaterialChanged && movement.documentId) {
        const siblings = await manager.find(Movement, { where: { documentId: movement.documentId } });
        for (const sibling of siblings) {
          if (sibling.id === movement.id) continue;
          const siblingOld = sibling.documentoMaterial?.trim() || null;
          if (siblingOld === documentoMaterialValue) continue;
          sibling.documentoMaterial = documentoMaterialValue;
          await manager.save(sibling);
          logs.push({
            movementId: sibling.id,
            field: 'documentoMaterial',
            oldValue: siblingOld,
            newValue: documentoMaterialValue,
            changedById: userId,
            reason: dto.reason,
          });
        }

        const document = await manager.findOne(LogisticsDocument, { where: { id: movement.documentId } });
        if (document) {
          document.documentoMaterial = documentoMaterialValue;
          document.updatedAt = new Date();
          await manager.save(document);
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
            weightKg: p.weightKg ?? null,
            locationId: p.currentLocationId ?? null,
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
   * Solicita la corrección de lotes/cantidades/pallets de una ENTRADA o SALIDA ya posteada.
   * - Renombres de código de lote se aplican directo (sin impacto de stock) y quedan
   *   auditados en regularization_logs; los códigos de pallets derivados se renombran en cascada.
   * - Las diferencias de cantidad generan AdjustmentRequest (RLAI/RLAO) en PENDIENTE_APROBACION:
   *   el stock NO cambia hasta que el MANAGER apruebe. A diferencia de la anulación,
   *   NO se setea originalMovementId (el movimiento original no se marca VOIDED).
   * - ENTRY: la cantidad por pallet se compara contra el saldo actual del pallet (solo se
   *   puede reducir; para sumar existe "agregar pallets nuevos").
   * - EXIT: la cantidad por pallet se compara contra lo que ESA salida registró para ese
   *   pallet (MovementDetail.quantity), no contra el saldo actual — son ejes distintos.
   *   Reducir lo que salió devuelve stock al pallet (ADJUSTMENT_IN); aumentar saca más
   *   (ADJUSTMENT_OUT). No existe "agregar pallets nuevos" para salidas.
   */
  async requestQuantityEdit(id: string, dto: RequestQuantityEditDto, userId: string) {
    const movement = await this.dataSource.getRepository(Movement).findOne({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento no encontrado');
    if (!['ENTRY', 'EXIT'].includes(movement.type)) {
      throw new BadRequestException('La corrección de cantidades solo está disponible para entradas y salidas.');
    }
    const isExit = movement.type === 'EXIT';
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
    /** Cambios de peso por pallet — dato descriptivo, se aplica directo y auditado. */
    const weightUpdates: Array<{ pallet: Pallet; oldValue: number | null; newValue: number }> = [];
    const increaseItems: IncreaseItem[] = [];
    const decreaseItems: Array<{ palletId: string; quantity: number }> = [];
    // Solo EXIT: devolver stock a un pallet ya existente (posiblemente EXITED) — ver
    // la rama ADJUSTMENT_IN + palletId en createInTransactionPublic.
    const restoreItems: Array<{ palletId: string; quantity: number }> = [];
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

      // ── Corrección por pallet ──
      const lotDetails = details.filter((d) => d.lotId === lot.id);
      const lotPalletIds = new Set(lotDetails.map((d) => d.palletId).filter(Boolean) as string[]);
      for (const pe of edit.palletEdits ?? []) {
        const pallet = palletMap[pe.palletId];
        if (!pallet || !lotPalletIds.has(pe.palletId)) {
          throw new BadRequestException(`El pallet indicado no pertenece al lote ${lot.lotCode} de este movimiento.`);
        }

        if (isExit) {
          // La cantidad nueva se compara contra lo que ESTA salida registró para este
          // pallet — no contra el saldo actual (son ejes distintos, ver comentario del método).
          const detail = lotDetails.find((d) => d.palletId === pe.palletId);
          const takenInThisExit = detail?.quantity ?? 0;
          if (pe.newQuantity < 0) {
            throw new BadRequestException(`Cantidad inválida en el pallet ${pallet.code}.`);
          }
          if (pe.newQuantity > takenInThisExit) {
            // Se despachó más de lo registrado: sacar la diferencia del pallet (debe alcanzar el saldo).
            const extra = pe.newQuantity - takenInThisExit;
            if (extra > pallet.quantity) {
              throw new BadRequestException(
                `El pallet ${pallet.code} solo tiene ${pallet.quantity} unid. disponibles — no se puede sacar ${extra} más.`,
              );
            }
            if (extra > 0) decreaseItems.push({ palletId: pallet.id, quantity: extra });
          } else if (pe.newQuantity < takenInThisExit) {
            // Se despachó menos de lo registrado: devolver la diferencia al pallet.
            const giveBack = takenInThisExit - pe.newQuantity;
            if (giveBack > 0) restoreItems.push({ palletId: pallet.id, quantity: giveBack });
          }
        } else {
          // ENTRY: solo se puede reducir el saldo actual del pallet.
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

        // El peso no mueve stock: se aplica directo (auditado), sin aprobación.
        if (pe.weightKg !== undefined) {
          const oldWeight = pallet.weightKg ?? null;
          if (oldWeight !== pe.weightKg) {
            weightUpdates.push({ pallet, oldValue: oldWeight, newValue: pe.weightKg });
          }
        }
      }

      // ── Agregado de unidades → pallets nuevos al aprobar (solo ENTRY) ──
      if (isExit && edit.addQuantity && edit.addQuantity > 0) {
        throw new BadRequestException('No se pueden agregar pallets nuevos al corregir una salida.');
      }
      if (!isExit && edit.addQuantity && edit.addQuantity > 0) {
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

    if (
      renames.length === 0 && fieldUpdates.length === 0 && weightUpdates.length === 0 &&
      increaseItems.length === 0 && decreaseItems.length === 0 && restoreItems.length === 0
    ) {
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

      // 2b. Peso por pallet: descriptivo, se aplica directo y queda auditado.
      for (const wu of weightUpdates) {
        wu.pallet.weightKg = wu.newValue;
        await manager.save(Pallet, wu.pallet);
        await manager.save(manager.create(RegularizationLog, {
          movementId: id,
          field: `pallet.${wu.pallet.code}.weightKg`,
          oldValue: wu.oldValue != null ? String(wu.oldValue) : null,
          newValue: String(wu.newValue),
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
          notes: `Corrección de cantidad de ${isExit ? 'SALIDA' : 'ENTRADA'} del ${formatBusinessDate(movement.date)}` +
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
      if (restoreItems.length > 0) await createRequest('ADJUSTMENT_IN', restoreItems);
      if (decreaseItems.length > 0) await createRequest('ADJUSTMENT_OUT', decreaseItems);

      return {
        renamed: renames.length,
        lotFieldChanges: fieldUpdates.length,
        weightChanges: weightUpdates.length,
        requests,
      };
    });

    // Bitácora del movimiento
    const parts: string[] = [];
    if (result.renamed > 0) parts.push(`${result.renamed} lote(s) renombrado(s)`);
    if (result.lotFieldChanges > 0) parts.push(`${result.lotFieldChanges} dato(s) de lote actualizado(s)`);
    if (result.weightChanges > 0) parts.push(`${result.weightChanges} peso(s) de pallet actualizado(s)`);
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

          // Regularizar el movimiento libera SIEMPRE sus lotes: el caso normal es que
          // solo llegue el remito definitivo (campos del movimiento) sin tocar datos del
          // lote, y hasta acá eso dejaba el lote bloqueado sin vía para desbloquearlo.
          if (lot.status === 'PENDING_REGULARIZATION') {
            logs.push({
              movementId: id, field: `lot.${lot.lotCode}.status`,
              oldValue: 'PENDING_REGULARIZATION', newValue: 'NORMAL',
              changedById: userId, reason: dto.reason,
            });
            lot.status = 'NORMAL';
            lotChanged = true;
          }

          if (lotChanged) {
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
        'movement.documentoMaterial AS "documentoMaterial"',
        'movement.notes AS notes',
        'movement.status AS status',
        'movement."voidStatus" AS "voidStatus"',
        'movement."voidAdjRequestId" AS "voidAdjRequestId"',
        'movement."adjustmentReason" AS "adjustmentReason"',
        'movement."adjustmentCategory" AS "adjustmentCategory"',
        'movement.createdById AS "createdById"',
        'movement.createdAt AS "createdAt"',
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
      .orderBy('movement.date', 'DESC')
      .addOrderBy('movement.createdAt', 'DESC');

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
    if (query.type?.length) qb.andWhere('movement.type IN (:...types)', { types: query.type });
    if (query.status) qb.andWhere('movement.status = :status', { status: query.status });
    if (query.documentoMaterialStatus === 'PENDING') {
      qb.andWhere('movement.type = :documentoMaterialType', { documentoMaterialType: 'EXIT' });
      qb.andWhere('NULLIF(TRIM(movement."documentoMaterial"), \'\') IS NULL');
    } else if (query.documentoMaterialStatus === 'COMPLETED') {
      qb.andWhere('movement.type = :documentoMaterialType', { documentoMaterialType: 'EXIT' });
      qb.andWhere('NULLIF(TRIM(movement."documentoMaterial"), \'\') IS NOT NULL');
    }
    if (query.dateFrom) qb.andWhere('movement.date >= :dateFrom', { dateFrom: this.toStartDate(query.dateFrom) });
    if (query.dateTo) qb.andWhere('movement.date <= :dateTo', { dateTo: this.toEndDate(query.dateTo) });
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(
          LOWER(COALESCE(movement."documentNumber", '')) LIKE :search
          OR LOWER(COALESCE(movement.supplier, '')) LIKE :search
          OR LOWER(COALESCE(movement.destination, '')) LIKE :search
          OR LOWER(COALESCE(movement."documentoMaterial", '')) LIKE :search
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
        'movement.documentoMaterial AS "documentoMaterial"',
        'movement.notes AS notes',
        'movement.status AS status',
        'movement."voidStatus" AS "voidStatus"',
        'movement."voidAdjRequestId" AS "voidAdjRequestId"',
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

    if (dto.type !== 'EXIT' && dto.documentoMaterial?.trim()) {
      throw new BadRequestException('Documento Material solo corresponde a una Salida');
    }

    // Fecha de vencimiento obligatoria en toda entrada — salvo las provisorias
    // (carga inicial con datos incompletos), que se completan después al
    // regularizar. Se valida acá, no solo en el formulario, para que no se
    // pueda saltear pegándole directo a la API.
    if (dto.type === 'ENTRY' && !dto.isProvisional && dto.palletItems?.length) {
      const missing = dto.palletItems.find((i) => i.lotCode && !i.fechaVencimiento);
      if (missing) {
        throw new BadRequestException(
          `Falta la fecha de vencimiento del lote "${missing.lotCode}" — es obligatoria para registrar una entrada.`,
        );
      }
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
    stock.currentQuantity = roundQuantity(stock.currentQuantity + quantity);
    stock.updatedAt = new Date();
    await manager.save(stock);
  }

  private async applyDecrease(
    manager: EntityManager, productId: string, warehouseId: string | null, locationId: string | null, quantity: number,
  ) {
    const stock = await this.findOrCreateStock(manager, productId, warehouseId, locationId);
    // Comparación redondeada: sin esto, un residuo de coma flotante
    // (p.ej. 1244.0999999999999 < 1244.1) rechazaría una salida válida.
    if (roundQuantity(stock.currentQuantity - quantity) < 0) {
      throw new BadRequestException('Stock insuficiente para completar la operación');
    }
    stock.currentQuantity = roundQuantity(stock.currentQuantity - quantity);
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
    supplierLot?: string,
  ): Promise<Lot> {
    const repo = manager.getRepository(Lot);
    lotCode = normalizeLotCode(lotCode);
    // El formulario de Entrada no tiene un campo propio para "lote proveedor" —
    // por defecto es el mismo código de lote que se cargó. `supplierLot` sigue
    // existiendo aparte por si algún día se necesita distinguirlo (el caller que
    // lo pase explícito gana).
    const effectiveSupplierLot = supplierLot ?? lotCode;
    let lot = await repo.findOne({ where: { productId, lotCode } });
    if (!lot) {
      lot = repo.create({
        productId, lotCode,
        fechaVencimiento: fechaVencimiento ?? null,
        fechaFabricacion: fechaFabricacion ?? null,
        proveedor: proveedor ?? null,
        sapLot: sapLot ?? null,
        supplierLot: effectiveSupplierLot,
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
      if (!lot.supplierLot) { lot.supplierLot = effectiveSupplierLot; changed = true; }
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
      lot.stockActual = Math.max(0, roundQuantity(lot.stockActual + delta));
      await repo.save(lot);
    }
  }

  private parseNumber(value: unknown) { return Number(value) || 0; }

  // value es un día calendario elegido por el usuario en un filtro: se ancla
  // a medianoche en Asunción (no UTC), igual que se guardan los timestamps
  // reales vía parseBusinessDate — anclar en UTC desalineaba el rango hasta
  // ~4hs contra los movimientos guardados cerca del cierre del día.
  private toStartDate(value: string) {
    return parseBusinessDate(value);
  }

  private toEndDate(value: string) {
    return endOfBusinessDay(value);
  }

  private mapMovementRow(row: Record<string, unknown>) {
    return {
      id: row.id, type: row.type, date: row.date,
      status: row.status ?? 'NORMAL',
      voidStatus: row.voidStatus ?? 'NONE',
      voidAdjRequestId: row.voidAdjRequestId ?? null,
      adjustmentReason: row.adjustmentReason ?? null,
      adjustmentCategory: row.adjustmentCategory ?? null,
      quantity: this.parseNumber(row.quantity),
      pallets: row.pallets === null || row.pallets === undefined ? null : this.parseNumber(row.pallets),
      documentNumber: row.documentNumber, supplier: row.supplier, carrier: row.carrier,
      driver: row.driver, destination: row.destination,
      documentoMaterial: row.documentoMaterial, notes: row.notes,
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

      const originPilaId = pallet.pilaId ?? null;
      pallet.quantity = roundQuantity(pallet.quantity - take);
      if (pallet.quantity === 0) {
        pallet.status = 'EXITED';
        pallet.exitedAt = new Date();
      } else if (pallet.status === 'AVAILABLE' || pallet.status === 'PARTIAL') {
        pallet.status = 'PARTIAL';
      }
      await manager.save(pallet);

      // Mismo criterio que la salida manual: la base se libera solo cuando la
      // pila se queda sin ningún pallet vivo.
      if (originPilaId && pallet.status === 'EXITED') {
        await this.pilas.releaseIfEmpty(manager, originPilaId);
      }

      const detail = manager.create(MovementDetail, {
        movementId,
        lotId: pallet.lotId,
        palletId: pallet.id,
        quantity: take,
        locationId: pallet.currentLocationId ?? undefined,  // FIX 4: ubicación física del palet
      });
      await manager.save(detail);

      await this.updateLotStock(manager, pallet.lotId, -take);
      // Redondeo obligado: sin esto el residuo de coma flotante deja `remaining`
      // en ~1e-13 y la salida completa se rechaza como "stock insuficiente".
      remaining = roundQuantity(remaining - take);
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

  /**
   * Carga inicial de inventario desde el Excel del cliente. Cada fila es un lote
   * de un material, con su cantidad, vencimiento y lote de proveedor.
   *
   * Reglas de identidad (las que definen si dos filas son el mismo lote):
   *  - La clave del lote es (material, lote interno). El lote interno viaja en
   *    `lotCode`, que es donde vive el índice único `uq_lot_product_code`.
   *  - El lote del proveedor es sólo trazabilidad: puede repetirse entre lotes
   *    internos distintos y NUNCA fusiona filas. Un mismo envío del proveedor
   *    suele partirse en varios lotes internos con vencimientos distintos, así
   *    que agrupar por él perdería stock y mezclaría fechas.
   *
   * El archivo no trae palets ni ubicaciones, así que cada lote genera un palet
   * lógico en una ubicación temporal (`STOCK-INICIAL`) pendiente de ubicar. Eso
   * mantiene la igualdad Stock = Lotes = Palets desde el primer día.
   */
  async stockSnapshotFromLotList(buffer: Buffer, userId: string, commit: boolean): Promise<StockLotSnapshotResult> {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException('No se pudo leer el archivo de stock. Verificá que sea un Excel/CSV válido.');
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new BadRequestException('El archivo de stock no contiene hojas con datos.');
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });

    const CODE_ALIASES = ['codigo', 'codigo material'];
    const DESC_ALIASES = ['material', 'descripcion'];
    const UM_ALIASES = ['umb', 'um', 'unidad de medida'];
    const QTY_ALIASES = ['stock lu', 'stock', 'cantidad'];
    const FECHA_VTO_ALIASES = ['fecha de vto', 'fecha vencimiento', 'fecha de vencimiento'];
    const SUPPLIER_LOT_ALIASES = ['lote de proveedor', 'lote proveedor'];
    const LOT_ALIASES = ['lote', 'lote interno', 'lote sap'];

    const normalize = (value: string): string =>
      value.normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '').trim().toLowerCase();

    /**
     * Acepta decimales con coma o punto. Si aparecen ambos separadores, la coma
     * es de miles ("1,234.56"); si aparece sólo la coma, es decimal ("1234,56").
     */
    const parseQty = (value: unknown): number | null => {
      let str = String(value ?? '').replace(/\s/g, '');
      if (!str) return null;
      const hasComma = str.includes(',');
      const hasDot = str.includes('.');
      if (hasComma && hasDot) str = str.replace(/,/g, '');
      else if (hasComma) str = str.replace(',', '.');
      str = str.replace(/[^0-9.\-]/g, '');
      if (!str) return null;
      const n = parseFloat(str);
      return Number.isFinite(n) ? roundQuantity(n) : null;
    };

    const parseDate = parseExcelDateCell;

    const rowIssues: StockSnapshotRowIssue[] = [];
    const addIssue = (severity: 'ERROR' | 'WARNING', row: number, reason: string, code?: string) => {
      rowIssues.push({ file: 'STOCK', severity, row, code, reason });
    };

    type Group = { description: string; unitOfMeasure: string; lots: StockLotItem[] };
    type ParsedRow = {
      rowNumber: number; code: string; description: string; unitOfMeasure: string;
      qty: number; fechaVencimiento: string | null; lotCode: string; sapLot: string;
    };
    const groups = new Map<string, Group>();
    const hoy = businessToday();

    // ── Pasada 1: parseo y validaciones de fila ──────────────────────────────
    const parsed: ParsedRow[] = [];

    raw.forEach((entry, index) => {
      const rowNumber = index + 2; // fila 1 = encabezado
      let code = '';
      let description = '';
      let unitOfMeasure = '';
      let qty: number | null = null;
      let fechaVencimiento: string | null | undefined;
      let lotCode = '';
      let sapLot = '';

      for (const [header, value] of Object.entries(entry)) {
        const norm = normalize(header);
        if (CODE_ALIASES.includes(norm)) code = String(value ?? '').trim().toUpperCase();
        // El lote del proveedor es el que identifica al lote — misma convención
        // que usa el operador al registrar una entrada.
        else if (SUPPLIER_LOT_ALIASES.includes(norm)) lotCode = normalizeLotCode(String(value ?? ''));
        else if (LOT_ALIASES.includes(norm)) sapLot = String(value ?? '').trim().toUpperCase();
        else if (UM_ALIASES.includes(norm)) unitOfMeasure = String(value ?? '').trim().toUpperCase();
        else if (QTY_ALIASES.includes(norm)) qty = parseQty(value);
        else if (FECHA_VTO_ALIASES.includes(norm)) fechaVencimiento = parseDate(value);
        else if (DESC_ALIASES.includes(norm)) description = String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
      }

      // ── Errores: la fila no se puede importar ──────────────────────────────
      if (!code) return addIssue('ERROR', rowNumber, 'Código de material vacío');
      if (!/\d/.test(code)) return addIssue('ERROR', rowNumber, 'Código de material inválido (no contiene dígitos)', code);
      if (!lotCode) return addIssue('ERROR', rowNumber, 'Lote de proveedor vacío — es la clave del lote', code);
      if (qty === null) return addIssue('ERROR', rowNumber, 'Cantidad no numérica', code);
      if (qty <= 0) return addIssue('ERROR', rowNumber, `Cantidad inválida (${qty}): debe ser mayor a cero`, code);

      // ── Advertencias: la fila se importa igual ────────────────────────────
      if (fechaVencimiento === null) {
        addIssue('WARNING', rowNumber, 'Fecha de vencimiento inválida — el lote se importa sin vencimiento', code);
      } else if (fechaVencimiento === undefined) {
        addIssue('WARNING', rowNumber, 'Sin fecha de vencimiento — el lote no participará del orden FEFO por fecha', code);
      } else if (fechaVencimiento < hoy) {
        addIssue('WARNING', rowNumber, `Lote ya vencido (${fechaVencimiento})`, code);
      }

      parsed.push({
        rowNumber, code, description, unitOfMeasure,
        qty, fechaVencimiento: fechaVencimiento ?? null, lotCode, sapLot,
      });
    });

    // ── Pasada 2: resolver filas que comparten (material, lote de proveedor) ──
    // La clave del lote es (material, lotCode), así que dos filas con el mismo
    // par son el mismo lote. Se resuelven según el vencimiento:
    //   · misma fecha  → es el mismo lote partido en varias filas: se suman.
    //   · fechas distintas → no hay forma de saber cuál corresponde al lote, y
    //     elegir una arbitrariamente haría que FEFO despache con la fecha
    //     equivocada. Ninguna de esas filas se importa; se reportan como error.
    const byLot = new Map<string, ParsedRow[]>();
    for (const row of parsed) {
      const key = `${row.code}|${row.lotCode}`;
      byLot.set(key, [...(byLot.get(key) ?? []), row]);
    }

    let validRecords = 0;
    for (const rows of byLot.values()) {
      const { code, lotCode } = rows[0];
      const fechas = [...new Set(rows.map((r) => r.fechaVencimiento ?? '(sin fecha)'))];

      if (rows.length > 1 && fechas.length > 1) {
        const detalle = rows.map((r) => `fila ${r.rowNumber}: ${r.fechaVencimiento ?? 'sin fecha'} (${r.qty})`).join(', ');
        for (const r of rows) {
          addIssue(
            'ERROR', r.rowNumber,
            `Lote de proveedor "${lotCode}" repetido para este material con ${fechas.length} vencimientos distintos ` +
            `— ${detalle}. No se puede determinar cuál corresponde al lote: ninguna de estas filas se importa.`,
            code,
          );
        }
        continue;
      }

      if (rows.length > 1) {
        addIssue(
          'WARNING', rows[0].rowNumber,
          `Lote de proveedor "${lotCode}" repetido en ${rows.length} filas (${rows.map((r) => r.rowNumber).join(', ')}) ` +
          `con el mismo vencimiento — se suman las cantidades en un solo lote.`,
          code,
        );
      }

      const first = rows[0];
      const group = groups.get(code) ?? { description: first.description, unitOfMeasure: first.unitOfMeasure, lots: [] };
      if (!group.description && first.description) group.description = first.description;
      if (!group.unitOfMeasure && first.unitOfMeasure) group.unitOfMeasure = first.unitOfMeasure;

      group.lots.push({
        lotCode,
        sapLot: rows.find((r) => r.sapLot)?.sapLot || undefined,
        quantity: roundQuantity(rows.reduce((s, r) => s + r.qty, 0)),
        fechaVencimiento: first.fechaVencimiento,
        row: first.rowNumber,
      });
      groups.set(code, group);
      validRecords += rows.length;
    }

    const products = await this.dataSource.getRepository(Product).find();
    const productByCode = new Map(products.map((p) => [p.code.trim().toUpperCase(), p] as const));

    const stockRows = await this.dataSource.getRepository(Stock).find();
    const stockByProduct = new Map<string, number>();
    for (const s of stockRows) {
      stockByProduct.set(s.productId, (stockByProduct.get(s.productId) ?? 0) + s.currentQuantity);
    }

    const results: StockLotSnapshotProductResult[] = [];
    const summary = {
      adjusted: 0,
      newProducts: 0,
      skippedInactive: 0,
      skippedAlreadyHasStock: 0,
      skippedNonPositive: 0,
      errors: 0,
    };

    // Ubicación temporal donde aterriza todo el stock inicial hasta que se
    // ubique físicamente. Se resuelve una sola vez, y sólo si hay algo que cargar.
    const initialLocationId = commit && groups.size > 0
      ? await this.findOrCreateInitialStockLocation()
      : null;

    for (const [code, group] of groups) {
      const net = roundQuantity(group.lots.reduce((s, l) => s + l.quantity, 0));
      const base: Omit<StockLotSnapshotProductResult, 'status'> = {
        code,
        description: group.description,
        unitOfMeasure: group.unitOfMeasure || undefined,
        isNewProduct: !productByCode.has(code),
        lots: group.lots,
        net,
      };

      let product = productByCode.get(code);
      if (!product) {
        if (!group.description) {
          summary.errors++;
          results.push({ ...base, status: 'ERROR', error: 'Producto nuevo sin descripción — no se puede crear' });
          continue;
        }
        if (!commit) {
          summary.adjusted++;
          summary.newProducts++;
          results.push({ ...base, status: 'WOULD_ADJUST' });
          continue;
        }
        try {
          const created = await this.dataSource.getRepository(Product).save(
            this.dataSource.getRepository(Product).create({
              code,
              description: group.description,
              unitOfMeasure: group.unitOfMeasure || undefined,
              active: true,
              stackable: true,
            }),
          );
          product = created;
          productByCode.set(code, created);
        } catch (err) {
          summary.errors++;
          results.push({ ...base, status: 'ERROR', error: `No se pudo crear el producto: ${err instanceof Error ? err.message : String(err)}` });
          continue;
        }
      } else if (!product.active) {
        summary.skippedInactive++;
        results.push({ ...base, status: 'SKIPPED_INACTIVE' });
        continue;
      } else if ((stockByProduct.get(product.id) ?? 0) !== 0) {
        summary.skippedAlreadyHasStock++;
        results.push({ ...base, status: 'SKIPPED_ALREADY_HAS_STOCK' });
        continue;
      }

      if (net <= 0) {
        summary.skippedNonPositive++;
        results.push({ ...base, status: 'SKIPPED_NON_POSITIVE' });
        continue;
      }

      if (!commit) {
        summary.adjusted++;
        results.push({ ...base, status: 'WOULD_ADJUST' });
        continue;
      }

      try {
        const createdMovement = await this.create(
          {
            type: 'ADJUSTMENT_IN',
            productId: product.id,
            locationId: initialLocationId ?? undefined,
            adjustmentReason: 'DIFERENCIA_INVENTARIO',
            adjustmentCategory: 'CARGA_INICIAL',
            notes: 'Carga inicial de inventario por lote (import automático)',
            palletItems: group.lots.map((l) => ({
              lotCode: l.lotCode,
              quantity: l.quantity,
              fechaVencimiento: l.fechaVencimiento ?? undefined,
              sapLot: l.sapLot,
            })),
          },
          userId,
        );
        summary.adjusted++;
        if (base.isNewProduct) summary.newProducts++;
        results.push({ ...base, status: 'ADJUSTED', movementId: createdMovement.movementId, productCreated: base.isNewProduct });
      } catch (err) {
        summary.errors++;
        results.push({ ...base, status: 'ERROR', error: err instanceof Error ? err.message : String(err) });
      }
    }

    const importedProducts = results
      .filter((r) => r.status === 'ADJUSTED')
      .map((r) => productByCode.get(r.code)?.id)
      .filter((id): id is string => !!id);

    return {
      committed: commit,
      sourceRows: raw.length,
      totals: {
        materials: groups.size,
        lots: [...groups.values()].reduce((s, g) => s + g.lots.length, 0),
        records: validRecords,
        warnings: rowIssues.filter((i) => i.severity === 'WARNING').length,
        errors: rowIssues.filter((i) => i.severity === 'ERROR').length,
      },
      rowIssues,
      products: results,
      summary,
      integrity: commit && importedProducts.length > 0
        ? await this.checkInventoryConsistency(importedProducts)
        : undefined,
    };
  }

  /**
   * Ubicación donde aterriza el stock de la carga inicial: el archivo del cliente
   * no trae ubicaciones, y dejar el stock sin ubicar (locationId null) lo vuelve
   * invisible en el mapa del depósito. Con una ubicación temporal explícita el
   * pendiente de ubicar es consultable y se puede vaciar con transferencias.
   */
  private async findOrCreateInitialStockLocation(): Promise<string> {
    const locationRepo = this.dataSource.getRepository(Location);
    const existing = await locationRepo.findOne({ where: { code: INITIAL_STOCK_LOCATION_CODE } });
    if (existing) return existing.id;

    const warehouses = await this.dataSource.getRepository(Warehouse).find({ where: { active: true } });
    if (warehouses.length === 0) {
      throw new BadRequestException(
        'No hay ningún depósito activo. Creá el depósito antes de cargar el inventario inicial.',
      );
    }

    const created = locationRepo.create({
      code: INITIAL_STOCK_LOCATION_CODE,
      type: 'TEMPORAL',
      zone: 'RECEPCION',
      capacityPallets: null,
      warehouse: warehouses[0],
      active: true,
    });
    return (await locationRepo.save(created)).id;
  }

  /**
   * Verifica la invariante del inventario: para cada producto, el stock total
   * debe coincidir con la suma de sus lotes y con la suma de sus palets activos.
   * Se corre después de la carga para que una divergencia salga a la luz en el
   * momento, y no semanas después como una diferencia inexplicable.
   */
  private async checkInventoryConsistency(productIds: string[]): Promise<StockConsistencyReport> {
    const sum = (rows: { productid: string; total: string }[]) =>
      new Map(rows.map((r) => [r.productid, roundQuantity(Number(r.total))] as const));

    const stockRows = await this.dataSource.query(
      `SELECT "productId" AS productid, COALESCE(SUM("currentQuantity"), 0) AS total
       FROM stocks WHERE "productId" = ANY($1) GROUP BY "productId"`,
      [productIds],
    );
    const lotRows = await this.dataSource.query(
      `SELECT "productId" AS productid, COALESCE(SUM("stockActual"), 0) AS total
       FROM lots WHERE "productId" = ANY($1) GROUP BY "productId"`,
      [productIds],
    );
    const palletRows = await this.dataSource.query(
      `SELECT l."productId" AS productid, COALESCE(SUM(p.quantity), 0) AS total
       FROM pallets p JOIN lots l ON l.id = p."lotId"
       WHERE l."productId" = ANY($1) AND p.status <> 'EXITED'
       GROUP BY l."productId"`,
      [productIds],
    );

    const stockByProduct = sum(stockRows);
    const lotsByProduct = sum(lotRows);
    const palletsByProduct = sum(palletRows);

    const mismatches = productIds
      .map((id) => ({
        productId: id,
        stock: stockByProduct.get(id) ?? 0,
        lots: lotsByProduct.get(id) ?? 0,
        pallets: palletsByProduct.get(id) ?? 0,
      }))
      .filter((r) => r.stock !== r.lots || r.stock !== r.pallets);

    const total = (m: Map<string, number>) => roundQuantity([...m.values()].reduce((s, v) => s + v, 0));
    return {
      stockTotal: total(stockByProduct),
      lotsTotal: total(lotsByProduct),
      palletsTotal: total(palletsByProduct),
      consistent: mismatches.length === 0,
      mismatches: mismatches.slice(0, 50),
    };
  }

  /**
   * Revierte los ajustes creados por `stockSnapshotFromLotList` (identificados
   * por `adjustmentCategory: 'CARGA_INICIAL'`): descuenta el stock que sumaron,
   * borra lotes/pallets asociados y los movimientos. No toca productos,
   * ubicaciones ni ningún otro dato. `commit=false` solo lista qué se revertiría.
   */
  async revertStockSnapshot(commit: boolean): Promise<StockSnapshotRevertResult> {
    const movements = await this.dataSource.getRepository(Movement).find({
      where: { type: 'ADJUSTMENT_IN', adjustmentCategory: 'CARGA_INICIAL' },
      order: { createdAt: 'ASC' },
    });

    const products = await this.dataSource.getRepository(Product).find();
    const productById = new Map(products.map((p) => [p.id, p] as const));

    const items: StockSnapshotRevertItem[] = [];

    for (const movement of movements) {
      const product = productById.get(movement.productId);
      const base = {
        movementId: movement.id,
        code: product?.code ?? movement.productId,
        description: product?.description ?? '',
        quantity: movement.quantity,
      };

      if (!commit) {
        items.push({ ...base, reverted: false });
        continue;
      }

      try {
        await this.dataSource.transaction(async (manager) => {
          // Deshacer lotes/pallets creados por el snapshot con lotes (si los hay).
          const details = await manager.getRepository(MovementDetail).find({ where: { movementId: movement.id } });
          for (const detail of details) {
            if (detail.palletId) await manager.delete(Pallet, detail.palletId);
            if (detail.lotId) {
              const lot = await manager.getRepository(Lot).findOne({ where: { id: detail.lotId } });
              if (lot) {
                const remaining = lot.stockActual - detail.quantity;
                if (remaining <= 0) await manager.delete(Lot, lot.id);
                else {
                  lot.stockActual = remaining;
                  await manager.save(lot);
                }
              }
            }
          }
          if (details.length) await manager.delete(MovementDetail, { movementId: movement.id });

          await this.applyDecrease(manager, movement.productId, movement.warehouseId ?? null, movement.locationId ?? null, movement.quantity);
          await manager.delete(Movement, movement.id);
        });
        items.push({ ...base, reverted: true });
      } catch (err) {
        items.push({ ...base, reverted: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (commit) {
      void Promise.all([this.cache.delPattern('kpis:*'), this.cache.delPattern('stock:*')]);
      this.events.emitStockUpdated({ warehouseId: null });
    }

    return {
      committed: commit,
      totalFound: movements.length,
      totalReverted: items.filter((i) => i.reverted).length,
      items,
    };
  }

}

export interface StockSnapshotRowIssue {
  file: 'ENTRADA' | 'SALIDA' | 'STOCK';
  /** ERROR = la fila no se importa; WARNING = se importa pero requiere revisión. */
  severity: 'ERROR' | 'WARNING';
  row: number;
  code?: string;
  reason: string;
}

export type StockSnapshotProductStatus =
  | 'ADJUSTED'
  | 'WOULD_ADJUST'
  | 'SKIPPED_NOT_FOUND'
  | 'SKIPPED_INACTIVE'
  | 'SKIPPED_ALREADY_HAS_STOCK'
  | 'SKIPPED_NON_POSITIVE'
  | 'ERROR';

export interface StockSnapshotRevertItem {
  movementId: string;
  code: string;
  description: string;
  quantity: number;
  reverted: boolean;
  error?: string;
}

export interface StockSnapshotRevertResult {
  committed: boolean;
  totalFound: number;
  totalReverted: number;
  items: StockSnapshotRevertItem[];
}

/** Código de la ubicación temporal donde entra el stock inicial sin ubicar. */
export const INITIAL_STOCK_LOCATION_CODE = 'STOCK-INICIAL';

export interface StockLotItem {
  /** Lote del proveedor — junto con el material forma la clave única del lote. */
  lotCode: string;
  /** Lote SAP del origen — informativo, se comparte entre lotes del mismo día. */
  sapLot?: string;
  quantity: number;
  fechaVencimiento?: string | null;
  /** Fila del Excel de origen, para poder rastrear el dato. */
  row: number;
}

export interface StockConsistencyReport {
  stockTotal: number;
  lotsTotal: number;
  palletsTotal: number;
  consistent: boolean;
  mismatches: { productId: string; stock: number; lots: number; pallets: number }[];
}

export interface StockLotSnapshotProductResult {
  code: string;
  description: string;
  unitOfMeasure?: string;
  isNewProduct: boolean;
  lots: StockLotItem[];
  net: number;
  status: StockSnapshotProductStatus;
  movementId?: string;
  productCreated?: boolean;
  error?: string;
}

export interface StockLotSnapshotResult {
  committed: boolean;
  /** Filas de datos leídas del archivo (sin contar el encabezado). */
  sourceRows: number;
  /** Cifras de la previsualización. */
  totals: {
    materials: number;
    lots: number;
    records: number;
    warnings: number;
    errors: number;
  };
  rowIssues: StockSnapshotRowIssue[];
  products: StockLotSnapshotProductResult[];
  /** Verificación Stock = Lotes = Palets. Sólo presente tras confirmar la carga. */
  integrity?: StockConsistencyReport;
  summary: {
    adjusted: number;
    newProducts: number;
    skippedInactive: number;
    skippedAlreadyHasStock: number;
    skippedNonPositive: number;
    errors: number;
  };
}
