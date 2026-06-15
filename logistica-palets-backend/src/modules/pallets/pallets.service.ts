import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Pallet } from './entities/pallet.entity';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { Lot } from '../lots/entities/lot.entity';
import { Location } from '../locations/entities/location.entity';
import { Stock } from '../stocks/entities/stock.entity';
import { Movement } from '../movements/entities/movement.entity';
import { MovementDetail } from '../movements/entities/movement-detail.entity';

export interface EnrichedPallet {
  id: string;
  code: string;
  lotId: string;
  quantity: number;
  currentLocationId: string | null;
  status: string;
  createdAt: Date;
  exitedAt: Date | null;
  lotCode: string;
  fechaVencimiento: string | null;
  productId: string;
  productCode: string;
  productDescription: string;
  locationCode: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
}

@Injectable()
export class PalletsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Pallet) private readonly palletRepo: Repository<Pallet>,
    @InjectRepository(Lot) private readonly lotRepo: Repository<Lot>,
    @InjectRepository(Location) private readonly locationRepo: Repository<Location>,
  ) {}

  async create(dto: CreatePalletDto) {
    const exists = await this.palletRepo.findOne({ where: { code: dto.code } });
    if (exists) throw new BadRequestException('Ya existe un pallet con ese código');

    const lot = await this.lotRepo.findOne({ where: { id: dto.lotId } });
    if (!lot) throw new NotFoundException('Lote no encontrado');

    if (dto.currentLocationId) {
      const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
      if (!loc) throw new NotFoundException('Ubicación no encontrada');
    }

    const pallet = this.palletRepo.create({
      code: dto.code,
      lotId: dto.lotId,
      quantity: dto.quantity,
      currentLocationId: dto.currentLocationId ?? null,
      status: dto.status ?? 'AVAILABLE',
    });

    return this.palletRepo.save(pallet);
  }

  async findAll(filters: {
    lotId?: string;
    status?: string;
    productId?: string;
    locationId?: string;
    search?: string;
  } = {}): Promise<EnrichedPallet[]> {
    const { lotId, status, productId, locationId, search } = filters;

    // Construir el WHERE dinámicamente: solo se agregan condiciones de los
    // filtros presentes. Así nunca se pasa un parámetro NULL con tipo ambiguo
    // (PostgreSQL: "could not determine data type of parameter").
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (lotId) {
      params.push(lotId);
      conditions.push(`p."lotId"::text = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }
    if (productId) {
      params.push(productId);
      conditions.push(`l."productId"::text = $${params.length}`);
    }
    if (locationId) {
      params.push(locationId);
      conditions.push(`p."currentLocationId"::text = $${params.length}`);
    }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      const i = params.length;
      conditions.push(
        `(p.code ILIKE $${i} OR pr.code ILIKE $${i} OR pr.description ILIKE $${i} OR l."lotCode" ILIKE $${i})`,
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    return this.dataSource.query<EnrichedPallet[]>(
      `
      SELECT
        p.id,
        p.code,
        p."lotId",
        p.quantity,
        p."currentLocationId",
        p.status,
        p."createdAt",
        p."exitedAt",
        l."lotCode",
        l."fechaVencimiento",
        l."productId",
        pr.code              AS "productCode",
        pr.description       AS "productDescription",
        loc.code             AS "locationCode",
        w.id                 AS "warehouseId",
        w.name               AS "warehouseName"
      FROM pallets p
      JOIN lots     l   ON l.id  = p."lotId"
      JOIN products pr  ON pr.id = l."productId"
      LEFT JOIN locations  loc ON loc.id = p."currentLocationId"
      LEFT JOIN warehouses w   ON w.id   = loc."warehouseId"
      ${whereClause}
      ORDER BY p.code ASC
      `,
      params,
    );
  }

  async kpis() {
    const rows = await this.dataSource.query<{ status: string; cnt: string }[]>(
      `SELECT status, COUNT(*)::int AS cnt FROM pallets GROUP BY status`,
    );
    const [noLoc] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*)::int AS cnt FROM pallets WHERE "currentLocationId" IS NULL AND status <> 'EXITED'`,
    );
    const by: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      by[r.status] = Number(r.cnt);
      total += Number(r.cnt);
    }
    return {
      total,
      available:  by['AVAILABLE']  ?? 0,
      partial:    by['PARTIAL']    ?? 0,
      blocked:    by['BLOCKED']    ?? 0,
      damaged:    by['DAMAGED']    ?? 0,
      inTransit:  by['IN_TRANSIT'] ?? 0,
      exited:     by['EXITED']     ?? 0,
      empty:      by['EMPTY']      ?? 0,
      noLocation: Number(noLoc?.cnt ?? 0),
    };
  }

  /**
   * Reconcilia el estado de los pallets existentes según su cantidad y su
   * historial de movimientos. Idempotente y seguro:
   *  - Solo toca pallets en estado AVAILABLE (nunca BLOCKED/DAMAGED/IN_TRANSIT/EXITED).
   *  - quantity = 0           → EXITED + exitedAt
   *  - quantity > 0 con salida → PARTIAL (existe un EXIT/ADJUSTMENT_OUT previo del pallet)
   */
  async reconcileStatuses() {
    return this.dataSource.transaction(async (em) => {
      // 1) AVAILABLE con cantidad agotada → EXITED
      const exitedRows = await em.query<{ id: string }[]>(
        `
        UPDATE pallets
        SET status = 'EXITED',
            "exitedAt" = COALESCE("exitedAt", CURRENT_TIMESTAMP)
        WHERE status = 'AVAILABLE' AND quantity <= 0
        RETURNING id
        `,
      );

      // 2) AVAILABLE con saldo y con al menos una salida registrada → PARTIAL
      const partialRows = await em.query<{ id: string }[]>(
        `
        UPDATE pallets p
        SET status = 'PARTIAL'
        WHERE p.status = 'AVAILABLE'
          AND p.quantity > 0
          AND EXISTS (
            SELECT 1
            FROM movement_details md
            JOIN movements m ON m.id = md."movementId"
            WHERE md."palletId" = p.id
              AND m.type IN ('EXIT', 'ADJUSTMENT_OUT')
          )
        RETURNING p.id
        `,
      );

      return {
        exited: Array.isArray(exitedRows) ? exitedRows.length : 0,
        partial: Array.isArray(partialRows) ? partialRows.length : 0,
      };
    });
  }

  async findOne(id: string) {
    const pallet = await this.palletRepo.findOne({ where: { id } });
    if (!pallet) throw new NotFoundException('Pallet no encontrado');
    return pallet;
  }

  async update(id: string, dto: UpdatePalletDto) {
    const pallet = await this.findOne(id);

    if (dto.currentLocationId) {
      const loc = await this.locationRepo.findOne({ where: { id: dto.currentLocationId } });
      if (!loc) throw new NotFoundException('Ubicación no encontrada');
    }

    const previousQuantity = pallet.quantity;
    Object.assign(pallet, dto);
    const saved = await this.palletRepo.save(pallet);

    if (dto.quantity !== undefined && dto.quantity !== previousQuantity) {
      const delta = dto.quantity - previousQuantity;
      const lot = await this.lotRepo.findOne({ where: { id: saved.lotId } });
      if (lot) {
        lot.stockActual = Math.max(0, lot.stockActual + delta);
        await this.lotRepo.save(lot);
      }
    }

    return saved;
  }

  async quickTransfer(palletId: string, toLocationId: string, userId: string) {
    const pallet = await this.palletRepo.findOne({ where: { id: palletId } });
    if (!pallet) throw new NotFoundException('Pallet no encontrado');
    if (pallet.status === 'EXITED')
      throw new BadRequestException('No se puede transferir un pallet despachado');
    if (pallet.status === 'EMPTY')
      throw new BadRequestException('No se puede transferir un pallet vacío');
    if (pallet.currentLocationId === toLocationId)
      throw new BadRequestException('El pallet ya se encuentra en esa ubicación');

    const toLoc = await this.locationRepo.findOne({
      where: { id: toLocationId },
      relations: ['warehouse'],
    });
    if (!toLoc) throw new NotFoundException('Ubicación destino no encontrada');
    if (!toLoc.active) throw new BadRequestException('La ubicación destino no está activa');

    const lot = await this.lotRepo.findOne({ where: { id: pallet.lotId } });
    if (!lot) throw new NotFoundException('Lote del pallet no encontrado');

    const fromLocationId = pallet.currentLocationId;
    const toWarehouseId: string | null = (toLoc.warehouse as unknown as { id?: string } | null)?.id ?? null;

    let fromWarehouseId: string | null = null;
    if (fromLocationId) {
      const fromLoc = await this.locationRepo.findOne({
        where: { id: fromLocationId },
        relations: ['warehouse'],
      });
      fromWarehouseId = (fromLoc?.warehouse as unknown as { id?: string } | null)?.id ?? null;
    }

    await this.dataSource.transaction(async (em) => {
      // Descontar del origen y aumentar en destino usando exactamente el mismo
      // patrón que MovementsService (findOrCreateStock + IsNull()).
      // El descuento se hace SIEMPRE — aunque el pallet esté a nivel de depósito
      // (locationId null), la fila de stock se matchea por IsNull() y se reduce.
      // Saltarlo provocaba stock duplicado (origen no descontado + destino creado).

      // 1) Decrease at source (product, fromWarehouse, fromLocation)
      const fromStock = await this.findOrCreateStock(em, lot.productId, fromWarehouseId, fromLocationId ?? null);
      fromStock.currentQuantity = Math.max(0, fromStock.currentQuantity - pallet.quantity);
      fromStock.updatedAt = new Date();
      await em.save(fromStock);

      // 2) Increase at destination (product, toWarehouse, toLocation)
      const toStock = await this.findOrCreateStock(em, lot.productId, toWarehouseId, toLocationId);
      toStock.currentQuantity += pallet.quantity;
      toStock.updatedAt = new Date();
      await em.save(toStock);

      // Update pallet location
      await em.update(Pallet, { id: palletId }, { currentLocationId: toLocationId });

      // Create TRANSFER movement record
      const movement = em.create(Movement);
      movement.type = 'TRANSFER';
      movement.productId = lot.productId;
      movement.quantity = pallet.quantity;
      movement.pallets = 1;
      movement.lotId = lot.id;
      movement.fromLocationId = fromLocationId ?? undefined;
      movement.fromWarehouseId = fromWarehouseId ?? undefined;
      movement.toLocationId = toLocationId;
      movement.toWarehouseId = toWarehouseId ?? undefined;
      movement.createdById = userId;
      movement.notes = 'Transferencia rápida desde módulo Pallets';
      movement.status = 'NORMAL';
      const savedMovement = await em.save(movement);

      // Create movement detail
      const detail = em.create(MovementDetail);
      detail.movementId = savedMovement.id;
      detail.palletId = palletId;
      detail.lotId = lot.id;
      detail.locationId = fromLocationId ?? undefined;
      detail.quantity = pallet.quantity;
      await em.save(detail);
    });

    return this.palletRepo.findOne({ where: { id: palletId } });
  }

  /**
   * Busca la fila de stock por (productId, warehouseId, locationId) usando
   * IsNull() para las columnas nulas — mismo patrón que MovementsService —
   * o crea una nueva en 0. Garantiza que origen y destino operen sobre la
   * misma fila canónica y nunca se dupliquen.
   */
  /** Obtiene (con lock pesimista) o crea la fila de stock. Mismo patrón que MovementsService. */
  private async findOrCreateStock(
    manager: EntityManager,
    productId: string,
    warehouseId: string | null,
    locationId: string | null,
  ): Promise<Stock> {
    const repo = manager.getRepository(Stock);
    const existing = await repo.findOne({
      where: {
        productId,
        warehouseId: warehouseId ?? IsNull(),
        locationId: locationId ?? IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) return existing;
    return repo.create({ productId, warehouseId, locationId, currentQuantity: 0, updatedAt: new Date() });
  }

  async remove(id: string) {
    const pallet = await this.findOne(id);
    await this.palletRepo.remove(pallet);
    return { deleted: true };
  }

  async history(id: string) {
    const pallet = await this.findOne(id);

    const detailEvents = await this.dataSource.query(
      `
      SELECT
        m.id          AS "movementId",
        m.type,
        m.date,
        md.quantity,
        m."documentNumber",
        m.supplier,
        m.carrier,
        m.driver,
        m.destination,
        m.notes,
        m.status,
        p.code        AS "productCode",
        p.description AS "productDescription",
        l_from.id     AS "fromLocationId",
        l_from.code   AS "fromLocationCode",
        w_from.name   AS "fromWarehouseName",
        l_to.id       AS "toLocationId",
        l_to.code     AS "toLocationCode",
        w_to.name     AS "toWarehouseName"
      FROM movement_details md
      JOIN movements m   ON m.id = md."movementId"
      JOIN products  p   ON p.id = m."productId"
      LEFT JOIN locations l_from ON l_from.id = md."locationId"
      LEFT JOIN warehouses w_from ON w_from.id = m."fromWarehouseId"
      LEFT JOIN locations l_to   ON l_to.id   = m."toLocationId"
      LEFT JOIN warehouses w_to  ON w_to.id   = m."toWarehouseId"
      WHERE md."palletId" = $1
      ORDER BY m.date ASC
      `,
      [id],
    );

    const directEvents = await this.dataSource.query(
      `
      SELECT
        m.id          AS "movementId",
        m.type,
        m.date,
        m.quantity,
        m."documentNumber",
        m.supplier,
        m.carrier,
        m.driver,
        m.destination,
        m.notes,
        m.status,
        p.code        AS "productCode",
        p.description AS "productDescription",
        l_from.id     AS "fromLocationId",
        l_from.code   AS "fromLocationCode",
        w_from.name   AS "fromWarehouseName",
        l_to.id       AS "toLocationId",
        l_to.code     AS "toLocationCode",
        w_to.name     AS "toWarehouseName"
      FROM movements m
      JOIN products p ON p.id = m."productId"
      LEFT JOIN locations  l_from ON l_from.id = m."fromLocationId"
      LEFT JOIN warehouses w_from ON w_from.id = m."fromWarehouseId"
      LEFT JOIN locations  l_to   ON l_to.id   = m."toLocationId"
      LEFT JOIN warehouses w_to   ON w_to.id   = m."toWarehouseId"
      WHERE m."palletId" = $1
        AND NOT EXISTS (
          SELECT 1 FROM movement_details md2
          WHERE md2."movementId" = m.id AND md2."palletId" = $1
        )
      ORDER BY m.date ASC
      `,
      [id],
    );

    const seen = new Set<string>();
    const events = [...detailEvents, ...directEvents]
      .filter((e) => {
        if (seen.has(e.movementId)) return false;
        seen.add(e.movementId);
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const INCREASE_TYPES = ['ENTRY', 'ADJUSTMENT_IN'];
    const NEUTRAL_TYPES  = ['TRANSFER'];
    let running = 0;
    const history = events.map((e) => {
      const qty = Number(e.quantity);
      if (!NEUTRAL_TYPES.includes(e.type)) {
        running += INCREASE_TYPES.includes(e.type) ? qty : -qty;
      }
      return {
        movementId: e.movementId,
        type: e.type,
        date: e.date,
        quantity: qty,
        remainingAfter: Math.max(0, running),
        documentNumber: e.documentNumber ?? null,
        supplier: e.supplier ?? null,
        carrier: e.carrier ?? null,
        driver: e.driver ?? null,
        destination: e.destination ?? null,
        notes: e.notes ?? null,
        status: e.status,
        from: e.fromLocationId
          ? { locationId: e.fromLocationId, locationCode: e.fromLocationCode, warehouseName: e.fromWarehouseName }
          : null,
        to: e.toLocationId
          ? { locationId: e.toLocationId, locationCode: e.toLocationCode, warehouseName: e.toWarehouseName }
          : null,
      };
    });

    return {
      pallet,
      product: events[0]
        ? { code: events[0].productCode, description: events[0].productDescription }
        : null,
      history,
    };
  }
}
