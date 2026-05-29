import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Pallet } from './entities/pallet.entity';
import { CreatePalletDto } from './dto/create-pallet.dto';
import { UpdatePalletDto } from './dto/update-pallet.dto';
import { Lot } from '../lots/entities/lot.entity';
import { Location } from '../locations/entities/location.entity';

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

  findAll(lotId?: string, status?: string) {
    const where: Record<string, unknown> = {};
    if (lotId) where.lotId = lotId;
    if (status) where.status = status;
    return this.palletRepo.find({ where, order: { code: 'ASC' } });
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

    // FIX 3: si cambió la cantidad, reconciliar lot.stockActual
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

  async remove(id: string) {
    const pallet = await this.findOne(id);
    await this.palletRepo.remove(pallet);
    return { deleted: true };
  }

  /**
   * Full movement history for a single pallet.
   * Joins movement_details → movements → products / locations (from/to) / warehouses.
   * Falls back to searching movements.palletId for legacy single-pallet movements.
   */
  async history(id: string) {
    const pallet = await this.findOne(id); // throws 404 if not found

    // Events from movement_details (multi-pallet movements)
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
        -- from location
        l_from.id     AS "fromLocationId",
        l_from.code   AS "fromLocationCode",
        w_from.name   AS "fromWarehouseName",
        -- to location (or current location for ENTRY)
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

    // Legacy events directly on movements (movements without details)
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

    // Merge and sort chronologically, deduplicate by movementId
    const seen = new Set<string>();
    const events = [...detailEvents, ...directEvents]
      .filter((e) => {
        if (seen.has(e.movementId)) return false;
        seen.add(e.movementId);
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calcular saldo acumulado (remainingAfter) por evento
    const INCREASE_TYPES = ['ENTRY', 'ADJUSTMENT_IN'];
    const NEUTRAL_TYPES  = ['TRANSFER'];  // mueve ubicación, no cantidad
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
        remainingAfter: Math.max(0, running),   // ← saldo en el pallet después de este evento
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
