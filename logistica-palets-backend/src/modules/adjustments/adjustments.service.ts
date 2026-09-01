import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
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
import { endOfBusinessDay, parseBusinessDate } from '../../common/date';
import { sumQuantities } from '../../common/quantity';
import {
  WarehouseAccessService,
  type AccessUser,
  type WarehouseScope,
} from '../warehouses/warehouse-access.service';
import { CacheService } from '../cache/cache.service';
import { EventsGateway } from '../events/events.gateway';
import { PermissionsService } from '../permissions/permissions.service';
import { User, type UserRole } from '../users/entities/user.entity';

/**
 * Roles que pueden aprobar un ajuste. Tiene que coincidir con el `@Roles` del
 * controlador: el permiso fino `adjustments.approve` se evalúa después, pero el
 * rol es un filtro previo que ese permiso no puede saltear.
 */
export const APPROVER_ROLES: UserRole[] = ['ADMIN', 'MANAGER'];


@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly movementsService: MovementsService,
    private readonly sequences: DocumentSequenceService,
    private readonly uploads: UploadsService,
    private readonly cache: CacheService,
    private readonly events: EventsGateway,
    private readonly access: WarehouseAccessService,
    private readonly permissions: PermissionsService,
  ) {}

  // ─────────────────────────────────────────────────────────
  //  SEGREGACIÓN DE FUNCIONES
  // ─────────────────────────────────────────────────────────

  /**
   * Otros usuarios que podrían aprobar esta solicitud, además de `excludeUserId`.
   *
   * Cuenta como aprobador disponible sólo quien cumple las tres condiciones que
   * el propio endpoint exige: está activo, su rol está entre los que aprueban y
   * conserva el permiso fino `adjustments.approve` —que un override por usuario
   * puede haberle quitado—, y tiene acceso al depósito de la solicitud.
   *
   * Sobre lo último: hoy ADMIN y MANAGER tienen los dos alcance global, así que
   * el depósito nunca termina acotando el conjunto y esa rama no se ejecuta. Se
   * deja igual porque el día que MANAGER pase a estar acotado por asignaciones
   * —evolución natural en multi-depósito— sin ella este método contaría de más:
   * bloquearía a un aprobador único diciéndole que le pida la firma a alguien
   * que en realidad no puede aprobar ese ajuste. `adjustment-segregation.spec.ts`
   * fija el supuesto para que ese cambio de política falle acá y no en silencio.
   */
  private async otherEligibleApprovers(
    excludeUserId: string,
    warehouseId: string | null,
  ): Promise<{ id: string; username: string }[]> {
    const candidatos = await this.dataSource.getRepository(User).find({
      where: { active: true, role: In(APPROVER_ROLES) },
      select: { id: true, username: true, role: true },
    });
    const otros = candidatos.filter((u) => u.id !== excludeUserId);
    if (otros.length === 0) return [];

    // Los roles de alcance global no necesitan asignación; al resto se le
    // consultan las suyas en un solo viaje en vez de uno por usuario.
    const locales = otros.filter((u) => !this.access.hasGlobalScope(u.role));
    const asignaciones = locales.length
      ? await this.access.listAssignmentsForUsers(locales.map((u) => u.id))
      : new Map<string, string[]>();

    const habilitados: { id: string; username: string }[] = [];
    for (const u of otros) {
      if (!this.access.hasGlobalScope(u.role)) {
        // Una solicitud sin depósito sólo la operan los roles globales — mismo
        // criterio que `assertRequestAccess`.
        if (!warehouseId) continue;
        if (!(asignaciones.get(u.id) ?? []).includes(warehouseId)) continue;
      }
      if (!(await this.permissions.hasPermission(u.id, u.role, 'adjustments', 'approve'))) continue;
      habilitados.push({ id: u.id, username: u.username });
    }
    return habilitados;
  }

  /**
   * Motivo por el que `userId` no puede aprobar esta solicitud, o `null` si sí puede.
   *
   * Quien crea un ajuste no lo aprueba: es la operación que corrige stock sin un
   * documento físico detrás, así que es justo donde el control cruzado sirve.
   *
   * La excepción es automática y deliberada: si no existe **ningún otro** usuario
   * habilitado para aprobar esta solicitud, bloquear no agregaría control —no hay
   * segunda firma posible— y dejaría al depósito sin poder ajustar ni anular nada.
   * En ese caso se aprueba y queda registrado como `AUTOAPROBADO` en la bitácora.
   * El control se reactiva solo en cuanto exista un segundo aprobador, sin que
   * haya nada que configurar ni que acordarse de apagar.
   */
  private async approvalBlockedReason(
    request: { createdById: string; warehouseId?: string | null },
    userId: string,
  ): Promise<string | null> {
    if (request.createdById !== userId) return null;
    const otros = await this.otherEligibleApprovers(userId, request.warehouseId ?? null);
    if (otros.length === 0) return null;
    return (
      'No podés aprobar una solicitud que creaste vos. ' +
      `Puede aprobarla: ${otros.map((u) => u.username).join(', ')}.`
    );
  }

  // ─────────────────────────────────────────────────────────
  //  SECUENCIAS (delegadas a DocumentSequenceService)
  // ─────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────
  //  CREAR BORRADOR
  // ─────────────────────────────────────────────────────────

  /**
   * Acceso al depósito de una solicitud existente. Una solicitud sin depósito
   * (historia previa al multi-depósito) solo la operan los roles globales.
   */
  /**
   * Invalida solo la caché del depósito afectado. Las claves llevan el alcance
   * completo, así que un ajuste en el 02 no borra lo cacheado del 01. Las
   * claves de alcance global (`all`) sí se borran: contienen a todos.
   */
  private invalidateWarehouseCaches(warehouseId: string | null): void {
    const patterns = ['kpis:warehouse:all:*', 'stock:warehouse:all:*'];
    if (warehouseId) {
      patterns.push(`kpis:warehouse:*${warehouseId}*`, `stock:warehouse:*${warehouseId}*`);
    }
    void Promise.all(patterns.map((pattern) => this.cache.delPattern(pattern)));
  }

  private async assertRequestAccess(user: AccessUser, requestId: string): Promise<void> {
    const row = await this.dataSource
      .getRepository(AdjustmentRequest)
      .findOne({ where: { id: requestId }, select: { id: true, warehouseId: true } });
    if (!row) throw new NotFoundException('Solicitud de ajuste no encontrada.');
    if (!row.warehouseId) {
      if (this.access.hasGlobalScope(user.role)) return;
      throw new ForbiddenException('La solicitud no tiene depósito asignado: no podés operarla.');
    }
    await this.access.assertWarehouseAccess(user, row.warehouseId);
  }

  async createDraft(dto: CreateAdjustmentDto, userId: string, requesterRole?: string) {
    // El deposito del ajuste sale de la ubicacion cuando la hay; el del payload
    // es solo un fallback. Se valida antes de crear nada.
    const user: AccessUser = { userId, role: requesterRole ?? '' };
    const warehouseId = dto.locationId
      ? await this.access.assertEntityAccess(user, 'location', dto.locationId)
      : dto.warehouseId ?? null;
    if (warehouseId) await this.access.assertWritableWarehouse(user, warehouseId);

    const result = await this.dataSource.transaction(async (manager) => {
      const code = await this.sequences.nextCode(manager, dto.type);

      const request = manager.create(AdjustmentRequest, {
        code,
        type: dto.type,
        status: 'BORRADOR',
        reason: dto.reason.trim(),
        adjustmentCategory: dto.adjustmentCategory?.trim() || null,
        warehouseId: warehouseId || null,
        locationId: dto.locationId || null,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      });
      await manager.save(request);

      const lines = await this.saveLines(manager, request.id, dto.lines, warehouseId ?? undefined, dto.locationId);

      request.totalLines = lines.length;
      request.totalQuantity = sumQuantities(lines.map((l) => l.totalQuantity));
      await manager.save(request);

      await this.uploads.log({
        entityType: 'ADJUSTMENT', entityId: request.id, eventType: 'CREADO',
        description: `Solicitud ${request.code} creada como borrador — motivo: ${dto.reason}`,
        userId, entityCode: request.code, manager,
      });

      return { requestId: request.id, code: request.code };
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  EDITAR BORRADOR
  // ─────────────────────────────────────────────────────────

  async updateDraft(id: string, dto: UpdateAdjustmentDto, _userId: string, requesterRole?: string) {
    await this.assertRequestAccess({ userId: _userId, role: requesterRole ?? '' }, id);
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
        req.totalQuantity = sumQuantities(lines.map((l) => l.totalQuantity));
      }

      req.updatedAt = new Date();
      await manager.save(req);
      return { requestId: req.id, code: req.code };
    });
  }

  // ─────────────────────────────────────────────────────────
  //  ENVIAR A APROBACIÓN
  // ─────────────────────────────────────────────────────────

  async submitForApproval(id: string, userId: string, requesterRole?: string) {
    await this.assertRequestAccess({ userId: userId, role: requesterRole ?? '' }, id);
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

      await this.uploads.log({
        entityType: 'ADJUSTMENT', entityId: req.id, eventType: 'ENVIADO_APROBACION',
        description: `Solicitud ${req.code} enviada para aprobación`,
        userId, entityCode: req.code, manager,
      });

      return { requestId: req.id, code: req.code, status: req.status };
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  APROBAR → postea stock
  // ─────────────────────────────────────────────────────────

  async approve(id: string, userId: string, requesterRole?: string) {
    await this.assertRequestAccess({ userId: userId, role: requesterRole ?? '' }, id);
    // Obtener request y líneas FUERA de la transacción para leer
    const req = await this.dataSource.getRepository(AdjustmentRequest).findOne({ where: { id } });
    if (!req) throw new NotFoundException('Solicitud de ajuste no encontrada.');
    if (req.status !== 'PENDIENTE_APROBACION') {
      throw new BadRequestException('Solo se pueden aprobar solicitudes en estado PENDIENTE_APROBACION.');
    }

    // Segregación de funciones. Se evalúa antes de abrir la transacción para no
    // sostener el lock mientras se consultan usuarios y permisos; `createdById`
    // no lo modifica ningún endpoint, así que no hay carrera que cubrir.
    const motivo = await this.approvalBlockedReason(req, userId);
    if (motivo) throw new ForbiddenException(motivo);
    const autoaprobacion = req.createdById === userId;

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

      await this.uploads.log({
        entityType: 'ADJUSTMENT', entityId: id, eventType: 'APROBADO',
        description: `Solicitud ${locked.code} aprobada — stock actualizado (${movementIds.length} movimiento(s))`,
        userId, entityCode: locked.code, manager,
      });

      // La excepción a la segregación queda explícita en la bitácora, con su
      // propio tipo de evento: un ajuste aprobado por quien lo creó tiene que
      // poder encontrarse buscando, no leyendo descripciones una por una.
      if (autoaprobacion) {
        await this.uploads.log({
          entityType: 'ADJUSTMENT', entityId: id, eventType: 'AUTOAPROBADO',
          description:
            `Aprobada por su propio creador — no hay ningún otro usuario habilitado para aprobar ` +
            `${locked.warehouseId ? 'en este depósito' : 'solicitudes sin depósito asignado'}`,
          userId, entityCode: locked.code, manager,
        });
      }

      // Cierra el ciclo en la bitácora del movimiento original: hasta acá solo
      // constaba la solicitud (ANULACION_SOLICITADA); sin este evento, quien mira
      // la bitácora del movimiento nunca se entera de que la anulación se confirmó.
      if (locked.originalMovementId) {
        await this.uploads.log({
          entityType: 'MOVEMENT', entityId: locked.originalMovementId, eventType: 'ANULADO',
          description: `Anulación confirmada — aprobada como ${locked.code}`,
          userId, entityCode: locked.code, manager,
        });
      }

      return { requestId: id, code: locked.code, movementIds, originalMovementId: locked.originalMovementId ?? null };
    });

    // Invalidar caché del depósito afectado y emitir el evento con su id: un
    // ajuste en el depósito 02 no debe recalcular ni refrescar el 01.
    this.invalidateWarehouseCaches(req.warehouseId ?? null);
    this.events.emitStockUpdated({ warehouseId: req.warehouseId ?? null });

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  RECHAZAR → vuelve a BORRADOR
  // ─────────────────────────────────────────────────────────

  async reject(id: string, dto: RejectAdjustmentDto, userId: string, requesterRole?: string) {
    await this.assertRequestAccess({ userId: userId, role: requesterRole ?? '' }, id);
    const result = await this.dataSource.transaction(async (manager) => {
      const req = await this.findOrFail(manager, id);
      if (req.status !== 'PENDIENTE_APROBACION') {
        throw new BadRequestException('Solo se pueden rechazar solicitudes en estado PENDIENTE_APROBACION.');
      }
      req.status = 'BORRADOR';
      req.rejectReason = dto.rejectReason.trim();
      req.updatedAt = new Date();
      await manager.save(req);

      await this.uploads.log({
        entityType: 'ADJUSTMENT', entityId: id, eventType: 'RECHAZADO',
        description: `Solicitud rechazada — vuelve a borrador. Motivo: ${dto.rejectReason}`,
        userId, entityCode: req.code, manager,
      });

      return { requestId: req.id, code: req.code, status: req.status };
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  ANULAR
  // ─────────────────────────────────────────────────────────

  async cancel(id: string, userId: string, requesterRole?: string) {
    await this.assertRequestAccess({ userId: userId, role: requesterRole ?? '' }, id);
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

      // El movimiento queda operable de nuevo — sin este evento, su bitácora se
      // quedaría en "anulación solicitada" para siempre aunque en los hechos se
      // haya cancelado y el movimiento siga vigente.
      if (req.originalMovementId) {
        await this.uploads.log({
          entityType: 'MOVEMENT', entityId: req.originalMovementId, eventType: 'RECHAZADO',
          description: `Anulación cancelada (${req.code}) — el movimiento sigue vigente`,
          userId, entityCode: req.code, manager,
        });
      }

      return { requestId: req.id, code: req.code, originalMovementId: req.originalMovementId ?? null };
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────
  //  CONSULTAS
  // ─────────────────────────────────────────────────────────

  async findAll(query: AdjustmentQueryDto, scope: WarehouseScope = null, user?: AccessUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.dataSource
      .getRepository(AdjustmentRequest)
      .createQueryBuilder('r')
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (scope) qb.andWhere('r.warehouseId IN (:...scopeIds)', { scopeIds: scope });
    if (query.type) qb.andWhere('r.type = :type', { type: query.type });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    // from/to son días calendario elegidos en el filtro: se anclan a
    // Asunción, igual que se guardan los timestamps reales (antes `from`
    // anclaba en UTC y `to` en la zona implícita del proceso — ni siquiera
    // coincidían entre sí).
    if (query.from) qb.andWhere('r.createdAt >= :from', { from: parseBusinessDate(query.from) });
    if (query.to) qb.andWhere('r.createdAt <= :to', { to: endOfBusinessDay(query.to) });
    if (query.search) {
      qb.andWhere(
        '(r.code ILIKE :s OR r.reason ILIKE :s OR r.notes ILIKE :s OR r.adjustmentCategory ILIKE :s)',
        { s: `%${query.search}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();

    // Marca las solicitudes que quien consulta no podría aprobar por segregación
    // de funciones, para que el frontend deshabilite el botón con el motivo a la
    // vista en vez de dejar que falle con un 403.
    //
    // Sólo se calcula para las pendientes que creó el propio usuario, que es el
    // único caso donde la respuesta no es evidente, y el resultado se memoiza por
    // depósito: en la carga habitual de la pantalla no cuesta ninguna consulta
    // extra, y cuando cuesta es una sola.
    const propias = new Set(
      user
        ? data.filter((r) => r.status === 'PENDIENTE_APROBACION' && r.createdById === user.userId)
        : [],
    );
    const motivoPorDeposito = new Map<string, string | null>();
    for (const req of propias) {
      const clave = req.warehouseId ?? '';
      if (!motivoPorDeposito.has(clave)) {
        motivoPorDeposito.set(clave, await this.approvalBlockedReason(req, user!.userId));
      }
    }

    return {
      data: data.map((r) => ({
        ...r,
        approvalBlockedReason: propias.has(r) ? motivoPorDeposito.get(r.warehouseId ?? '') ?? null : null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, user?: AccessUser) {
    const request = await this.dataSource
      .getRepository(AdjustmentRequest)
      .findOne({ where: { id } });
    if (!request) throw new NotFoundException('Solicitud de ajuste no encontrada.');
    if (user && request.warehouseId) {
      await this.access.assertWarehouseAccess(user, request.warehouseId);
    }

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
      const totalQuantity = sumQuantities(line.palletItems.map((i) => Number(i.quantity) || 0));
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
