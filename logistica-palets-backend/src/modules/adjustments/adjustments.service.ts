import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AdjustmentRequest } from './entities/adjustment-request.entity';
import { AdjustmentRequestLine } from './entities/adjustment-request-line.entity';
import { DocumentSequenceService } from '../movements/document-sequence.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  CreateAdjustmentDto,
  UpdateAdjustmentDto,
  RejectAdjustmentDto,
  AdjustmentQueryDto,
  AdjustmentLineDto,
} from './dto/adjustment.dto';
import { MovementsService } from '../movements/movements.service';
import { CreateMovementDto } from '../movements/dto/create-movement.dto';
import { CacheService } from '../cache/cache.service';
import { EventsGateway } from '../events/events.gateway';


@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly movementsService: MovementsService,
    private readonly sequences: DocumentSequenceService,
    private readonly uploads: UploadsService,
    private readonly cache: CacheService,
    private readonly events: EventsGateway,
  ) {}

  // ─────────────────────────────────────────────────────────
  //  SECUENCIAS (delegadas a DocumentSequenceService)
  // ─────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────
  //  CREAR BORRADOR
  // ─────────────────────────────────────────────────────────

  async createDraft(dto: CreateAdjustmentDto, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const code = await this.sequences.nextCode(manager, dto.type);

      const request = manager.create(AdjustmentRequest, {
        code,
        type: dto.type,
        status: 'BORRADOR',
        reason: dto.reason.trim(),
        adjustmentCategory: dto.adjustmentCategory?.trim() || null,
        warehouseId: dto.warehouseId || null,
        locationId: dto.locationId || null,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      });
      await manager.save(request);

      const lines = await this.saveLines(manager, request.id, dto.lines, dto.warehouseId, dto.locationId);

      request.totalLines = lines.length;
      request.totalQuantity = lines.reduce((s, l) => s + l.totalQuantity, 0);
      await manager.save(request);

      return { requestId: request.id, code: request.code };
    });

    void this.uploads.log('ADJUSTMENT', result.requestId, 'CREADO',
      `Solicitud ${result.code} creada como borrador — motivo: ${dto.reason}`,
      userId, undefined, undefined, result.code);

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  EDITAR BORRADOR
  // ─────────────────────────────────────────────────────────

  async updateDraft(id: string, dto: UpdateAdjustmentDto, _userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const req = await this.findOrFail(manager, id);
      if (req.status !== 'BORRADOR') {
        throw new BadRequestException('Solo se puede editar una solicitud en estado BORRADOR.');
      }

      if (dto.reason !== undefined) req.reason = dto.reason.trim();
      if (dto.adjustmentCategory !== undefined) req.adjustmentCategory = dto.adjustmentCategory?.trim() || null;
      if (dto.warehouseId !== undefined) req.warehouseId = dto.warehouseId || null;
      if (dto.locationId !== undefined) req.locationId = dto.locationId || null;
      if (dto.notes !== undefined) req.notes = dto.notes?.trim() || null;

      if (dto.lines) {
        // Reemplaza todas las líneas
        await manager.delete(AdjustmentRequestLine, { requestId: id });
        const lines = await this.saveLines(manager, id, dto.lines, req.warehouseId ?? undefined, req.locationId ?? undefined);
        req.totalLines = lines.length;
        req.totalQuantity = lines.reduce((s, l) => s + l.totalQuantity, 0);
      }

      req.updatedAt = new Date();
      await manager.save(req);
      return { requestId: req.id, code: req.code };
    });
  }

  // ─────────────────────────────────────────────────────────
  //  ENVIAR A APROBACIÓN
  // ─────────────────────────────────────────────────────────

  async submitForApproval(id: string, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const req = await this.findOrFail(manager, id);
      if (req.status !== 'BORRADOR') {
        throw new BadRequestException('Solo se puede enviar a aprobación un borrador.');
      }
      const lines = await manager.find(AdjustmentRequestLine, { where: { requestId: id } });
      if (lines.length === 0) {
        throw new BadRequestException('El ajuste no tiene líneas. Agregá al menos un producto.');
      }
      req.status = 'PENDIENTE_APROBACION';
      req.rejectReason = null;
      req.updatedAt = new Date();
      await manager.save(req);
      return { requestId: req.id, code: req.code, status: req.status };
    });

    void this.uploads.log('ADJUSTMENT', result.requestId, 'ENVIADO_APROBACION',
      `Solicitud ${result.code} enviada para aprobación`,
      userId, undefined, undefined, result.code);

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  APROBAR → postea stock
  // ─────────────────────────────────────────────────────────

  async approve(id: string, userId: string) {
    // Obtener request y líneas FUERA de la transacción para leer
    const req = await this.dataSource.getRepository(AdjustmentRequest).findOne({ where: { id } });
    if (!req) throw new NotFoundException('Solicitud de ajuste no encontrada.');
    if (req.status !== 'PENDIENTE_APROBACION') {
      throw new BadRequestException('Solo se pueden aprobar solicitudes en estado PENDIENTE_APROBACION.');
    }

    const lines = await this.dataSource.getRepository(AdjustmentRequestLine).find({ where: { requestId: id } });
    if (lines.length === 0) throw new BadRequestException('No hay líneas en el ajuste.');

    // Ejecutar en una sola transacción: aprobar + crear movimientos + postear stock
    const result = await this.dataSource.transaction(async (manager) => {
      // Re-leer con lock pesimista: sin él, dos aprobaciones simultáneas de la misma
      // solicitud pasan ambas el chequeo de estado y postean el stock dos veces.
      const locked = await manager.findOne(AdjustmentRequest, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'PENDIENTE_APROBACION') {
        throw new BadRequestException('El ajuste ya fue procesado por otra sesión.');
      }

      const movementIds: string[] = [];
      for (const line of lines) {
        const palletItems = JSON.parse(line.palletItemsJson) as CreateMovementDto['palletItems'];
        const lineDto: CreateMovementDto = {
          type: req.type,
          productId: line.productId,
          warehouseId: req.warehouseId ?? undefined,
          locationId: line.locationId ?? req.locationId ?? undefined,
          notes: req.notes ?? undefined,
          adjustmentReason: req.reason,
          adjustmentCategory: req.adjustmentCategory ?? undefined,
          palletItems,
        };
        const res = await this.movementsService.createInTransactionPublic(manager, lineDto, userId);
        movementIds.push(res.movementId);
      }

      locked.status = 'APROBADO';
      locked.approvedById = userId;
      locked.approvedAt = new Date();
      locked.updatedAt = new Date();
      await manager.save(locked);

      // Si este ajuste es una anulación automática, marcar el movimiento original como VOIDED
      if (locked.originalMovementId) {
        await manager.query(
          `UPDATE movements SET "voidStatus" = 'VOIDED' WHERE id = $1`,
          [locked.originalMovementId],
        );
      }

      return { requestId: id, code: locked.code, movementIds, originalMovementId: locked.originalMovementId ?? null };
    });

    // Invalidar caché y emitir evento
    void Promise.all([
      this.cache.delPattern('kpis:*'),
      this.cache.delPattern('stock:*'),
    ]);
    this.events.emitStockUpdated({ warehouseId: req.warehouseId ?? null });

    void this.uploads.log('ADJUSTMENT', id, 'APROBADO',
      `Solicitud ${result.code} aprobada — stock actualizado (${result.movementIds.length} movimiento(s))`,
      userId, undefined, undefined, result.code);

    // Cierra el ciclo en la bitácora del movimiento original: hasta acá solo
    // constaba la solicitud (ANULACION_SOLICITADA); sin este evento, quien mira
    // la bitácora del movimiento nunca se entera de que la anulación se confirmó.
    if (result.originalMovementId) {
      void this.uploads.log('MOVEMENT', result.originalMovementId, 'ANULADO',
        `Anulación confirmada — aprobada como ${result.code}`,
        userId, undefined, undefined, result.code);
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  RECHAZAR → vuelve a BORRADOR
  // ─────────────────────────────────────────────────────────

  async reject(id: string, dto: RejectAdjustmentDto, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const req = await this.findOrFail(manager, id);
      if (req.status !== 'PENDIENTE_APROBACION') {
        throw new BadRequestException('Solo se pueden rechazar solicitudes en estado PENDIENTE_APROBACION.');
      }
      req.status = 'BORRADOR';
      req.rejectReason = dto.rejectReason.trim();
      req.updatedAt = new Date();
      await manager.save(req);
      return { requestId: req.id, code: req.code, status: req.status };
    });

    void this.uploads.log('ADJUSTMENT', id, 'RECHAZADO',
      `Solicitud rechazada — vuelve a borrador. Motivo: ${dto.rejectReason}`,
      userId, undefined, undefined, result.code);

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  ANULAR
  // ─────────────────────────────────────────────────────────

  async cancel(id: string, userId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const req = await this.findOrFail(manager, id);
      if (req.status === 'APROBADO') {
        throw new ForbiddenException('No se puede anular un ajuste aprobado.');
      }
      req.status = 'RECHAZADO';
      req.updatedAt = new Date();
      await manager.save(req);

      // Si la solicitud era la compensación de una anulación, hay que liberar el
      // movimiento original: de lo contrario queda en VOID_PENDING para siempre,
      // ni anulado ni operable.
      if (req.originalMovementId) {
        await manager.query(
          `UPDATE movements SET "voidStatus" = 'NONE', "voidAdjRequestId" = NULL
           WHERE id = $1 AND "voidStatus" = 'VOID_PENDING'`,
          [req.originalMovementId],
        );
      }

      return { requestId: req.id, code: req.code, originalMovementId: req.originalMovementId ?? null };
    });

    // El movimiento queda operable de nuevo — sin este evento, su bitácora se
    // quedaría en "anulación solicitada" para siempre aunque en los hechos se
    // haya cancelado y el movimiento siga vigente.
    if (result.originalMovementId) {
      void this.uploads.log('MOVEMENT', result.originalMovementId, 'RECHAZADO',
        `Anulación cancelada (${result.code}) — el movimiento sigue vigente`,
        userId, undefined, undefined, result.code);
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  CONSULTAS
  // ─────────────────────────────────────────────────────────

  async findAll(query: AdjustmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.dataSource
      .getRepository(AdjustmentRequest)
      .createQueryBuilder('r')
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.type) qb.andWhere('r.type = :type', { type: query.type });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.from) qb.andWhere('r.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('r.createdAt <= :to', { to: new Date(query.to + 'T23:59:59') });
    if (query.search) {
      qb.andWhere(
        '(r.code ILIKE :s OR r.reason ILIKE :s OR r.notes ILIKE :s OR r.adjustmentCategory ILIKE :s)',
        { s: `%${query.search}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const request = await this.dataSource
      .getRepository(AdjustmentRequest)
      .findOne({ where: { id } });
    if (!request) throw new NotFoundException('Solicitud de ajuste no encontrada.');

    const lines = await this.dataSource
      .getRepository(AdjustmentRequestLine)
      .find({ where: { requestId: id } });

    return {
      request,
      lines: lines.map((l) => ({
        ...l,
        palletItems: JSON.parse(l.palletItemsJson),
      })),
    };
  }

  // ─────────────────────────────────────────────────────────
  //  HELPERS PRIVADOS
  // ─────────────────────────────────────────────────────────

  private async findOrFail(manager: EntityManager, id: string): Promise<AdjustmentRequest> {
    const req = await manager.findOne(AdjustmentRequest, { where: { id } });
    if (!req) throw new NotFoundException('Solicitud de ajuste no encontrada.');
    return req;
  }

  private async saveLines(
    manager: EntityManager,
    requestId: string,
    lines: AdjustmentLineDto[],
    _headerWarehouseId?: string,
    headerLocationId?: string,
  ): Promise<AdjustmentRequestLine[]> {
    const saved: AdjustmentRequestLine[] = [];
    for (const line of lines) {
      const totalQuantity = line.palletItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      const entity = manager.create(AdjustmentRequestLine, {
        requestId,
        productId: line.productId,
        palletItemsJson: JSON.stringify(line.palletItems),
        totalQuantity,
        locationId: line.locationId ?? headerLocationId ?? null,
      });
      saved.push(await manager.save(entity));
    }
    return saved;
  }
}
