import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { Product } from '../products/entities/product.entity';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { GenerateLocationsDto } from './dto/generate-locations.dto';
import { Pila } from '../pilas/entities/pila.entity';
import { PilasService } from '../pilas/pilas.service';

/** Estado de disponibilidad de una ubicación para el selector guiado. */
export type LocationAvailabilityStatus = 'FREE' | 'PARTIAL' | 'FULL' | 'BLOCKED';

/** Días de anticipación con los que una ubicación se marca "próxima a vencer". */
const EXPIRY_WARNING_DAYS = 30;

/** Los pallets EXITED/EMPTY ya no ocupan lugar físico: nunca entran al mapa. */
const LIVE_PALLET_STATUSES = `p.status NOT IN ('EXITED', 'EMPTY')`;

/** stocks.currentQuantity es numeric(14,3): comparar con tolerancia, no con ===. */
const UNIT_TOLERANCE = 0.001;

/** Máximo de filas devueltas por el localizador (una fila = un pallet). */
const SEARCH_ROW_LIMIT = 500;

/**
 * Estado visual de una celda del mapa. La precedencia es la del array
 * (INACTIVE gana sobre todo, FREE es el fallback) y la define el backend para
 * que el mapa, la leyenda y el listado de incidencias no puedan divergir.
 */
export type LocationMapState =
  | 'INACTIVE'
  | 'INCIDENT'
  | 'EXPIRING'
  | 'FULL'
  | 'PROVISIONAL'
  | 'OCCUPIED'
  | 'FREE';

/** Motivos por los que una ubicación aparece en la vista Incidencias. */
export type LocationIssue =
  | 'OVER_CAPACITY'
  | 'BLOCKED_PALLETS'
  | 'STOCK_MISMATCH'
  | 'EXPIRED'
  | 'EXPIRING'
  | 'INACTIVE_WITH_STOCK';

/** Una celda del mapa del depósito, con ocupación y diagnóstico. */
export type LocationCell = {
  id: string;
  code: string;
  type: string;
  active: boolean;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  /** @deprecated Sin uso — depósito 100% apilado en piso. */
  capacityPallets: number | null;
  /** Bases (pilas) ocupadas — la capacidad real. */
  basesUsed: number;
  capacityBases: number | null;
  warehouseId: string | null;
  warehouseName: string | null;
  /** Pallets físicamente ubicados acá (excluye EXITED/EMPTY). Informativo. */
  pallets: number;
  /** Unidades según los pallets ubicados. */
  units: number;
  /** Unidades según la tabla `stocks`. Si difiere de `units` hay descuadre. */
  stockUnits: number;
  blockedPallets: number;
  expiredPallets: number;
  expiringPallets: number;
  nearestExpiry: string | null;
  issues: LocationIssue[];
  state: LocationMapState;
};

type RawCell = Omit<LocationCell, 'issues' | 'state'>;

/** Una línea del localizador: un pallet con su lote, material y ubicación. */
export type StockSearchRow = {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  quantity: number;
  lotId: string;
  lotCode: string;
  supplierLot: string | null;
  sapLot: string | null;
  fechaVencimiento: string | null;
  lotStatus: string;
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  locationId: string | null;
  locationCode: string | null;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  level: number | null;
  position: number | null;
  locationActive: boolean | null;
  warehouseId: string | null;
  warehouseName: string | null;
  /** Documento de entrada del pallet — permite reimprimir su etiqueta. */
  entryDocumentId: string | null;
};

type LocationContentPallet = {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  quantity: number;
  createdAt: string | null;
  lotId: string;
  lotCode: string;
  supplierLot: string | null;
  sapLot: string | null;
  fechaVencimiento: string | null;
  lotStatus: string;
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  entryDocumentId: string | null;
};

type UnlocatedPallet = {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  quantity: number;
  lotCode: string;
  supplierLot: string | null;
  fechaVencimiento: string | null;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
};

type UnlocatedStock = {
  productId: string;
  productCode: string;
  productDescription: string;
  unitOfMeasure: string | null;
  warehouseName: string | null;
  quantity: number;
};

@Injectable()
export class LocationsService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Pallet)
    private readonly palletRepo: Repository<Pallet>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Pila)
    private readonly pilaRepo: Repository<Pila>,
    private readonly pilas: PilasService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateLocationDto) {
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: dto.warehouseId },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    // El código identifica la ubicación para el operario: duplicarlo dentro del mismo
    // depósito parte el stock en dos celdas indistinguibles.
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('El código de ubicación es obligatorio');

    const existing = await this.locationRepo.findOne({
      where: { code, warehouse: { id: dto.warehouseId } },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe la ubicación "${code}" en el depósito ${warehouse.name}`,
      );
    }

    const aisle = dto.aisle?.trim().toUpperCase() || null;
    const rack = dto.rack?.trim().toUpperCase() || null;
    await this.assertSubsectorFree(dto.warehouseId, aisle, rack, warehouse.name);

    const location = this.locationRepo.create({
      code,
      type: dto.type ?? 'RACK',
      zone: dto.zone ?? null,
      aisle,
      rack,
      level: dto.level ?? null,
      position: dto.position ?? null,
      capacityPallets: dto.capacityPallets ?? null,
      capacityBases: dto.capacityBases ?? null,
      defaultMaxStackLevel: dto.defaultMaxStackLevel ?? null,
      temperatureZone: dto.temperatureZone ?? 'AMBIENT',
      maxWeightKg: dto.maxWeightKg ?? null,
      maxHeightCm: dto.maxHeightCm ?? null,
      allowsStacking: dto.allowsStacking ?? true,
      warehouse,
    });

    return this.locationRepo.save(location);
  }

  /**
   * Dos ubicaciones con el mismo Sector-Subsector son celdas indistinguibles en
   * el mapa: el operario ve dos "B2" y no sabe cuál es cuál. El código único no
   * alcanza — "B-B2" y "B-B22" son códigos distintos pero pueden terminar con
   * el mismo subsector por un tipeo.
   *
   * `excludeId` permite reusar el chequeo al editar (no chocar consigo misma).
   */
  private async assertSubsectorFree(
    warehouseId: string,
    aisle: string | null,
    rack: string | null,
    warehouseName: string,
    excludeId?: string,
  ) {
    if (!aisle || !rack) return; // sin sector/subsector no hay celda que duplicar

    const qb = this.locationRepo
      .createQueryBuilder('loc')
      .where('loc."warehouseId" = :warehouseId', { warehouseId })
      .andWhere('UPPER(loc.aisle) = :aisle', { aisle })
      .andWhere('UPPER(loc.rack) = :rack', { rack });
    if (excludeId) qb.andWhere('loc.id <> :excludeId', { excludeId });

    const clash = await qb.getOne();
    if (clash) {
      throw new BadRequestException(
        `El subsector ${aisle}-${rack} ya existe en ${warehouseName} (ubicación "${clash.code}"). ` +
        `Usá otro subsector o editá la existente.`,
      );
    }
  }

  /**
   * Genera la estructura de una zona en lote: sectores × subsectores → una
   * Location (Sector-Subsector) por combinación. Todo el depósito es apilado
   * en piso — no hay racks/niveles/posiciones que generar, la capacidad real
   * la da `capacityBases` (bases/pilas), no la cantidad de Location rows.
   * Los códigos ya existentes en el depósito se saltean (idempotente).
   */
  async generate(dto: GenerateLocationsDto) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const sectors = (dto.sectors ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);

    const total = (sectors.length || 1) * dto.subsectorsPerSector;
    if (total > 2000) {
      throw new BadRequestException(
        `La estructura generaría ${total} ubicaciones (máximo 2000 por tanda). Reducí sectores o subsectores.`,
      );
    }

    const prefix = dto.codePrefix?.trim().toUpperCase() || null;
    const start = dto.subsectorStart ?? 1;
    const end = start + dto.subsectorsPerSector - 1;

    type NewLoc = { code: string; zone: string; aisle: string | null; rack: string | null };
    const wanted: NewLoc[] = [];

    if (sectors.length > 0) {
      for (const sector of sectors) {
        for (let s = start; s <= end; s++) {
          const subsector = `${sector}${s}`;
          wanted.push({
            code: [prefix, sector, subsector].filter(Boolean).join('-'),
            zone: dto.zone, aisle: sector, rack: subsector,
          });
        }
      }
    } else {
      for (let s = start; s <= end; s++) {
        wanted.push({
          code: [prefix, `S${s}`].filter(Boolean).join('-'),
          zone: dto.zone, aisle: null, rack: `S${s}`,
        });
      }
    }

    // Saltear códigos ya existentes en este depósito (idempotente)
    const existing = await this.locationRepo
      .createQueryBuilder('loc')
      .select('loc.code', 'code')
      .where('loc."warehouseId" = :wid', { wid: dto.warehouseId })
      .getRawMany<{ code: string }>();
    const existingCodes = new Set(existing.map((e) => e.code));

    const toCreate = wanted.filter((w) => !existingCodes.has(w.code));
    const entities = toCreate.map((w) =>
      this.locationRepo.create({
        code: w.code,
        type: 'PISO',
        zone: w.zone,
        aisle: w.aisle,
        rack: w.rack,
        capacityBases: dto.capacityBases ?? null,
        defaultMaxStackLevel: dto.defaultMaxStackLevel ?? null,
        warehouse,
      }),
    );
    if (entities.length > 0) {
      await this.locationRepo.save(entities, { chunk: 200 });
    }

    return {
      requested: wanted.length,
      created: entities.length,
      skipped: wanted.length - entities.length,
    };
  }

  /** Lista ubicaciones, opcionalmente acotadas a un depósito. */
  findAll(warehouseId?: string) {
    return this.locationRepo.find({
      where: warehouseId ? { warehouse: { id: warehouseId } } : {},
      relations: ['warehouse'],
    });
  }

  /**
   * Disponibilidad por Sector-Subsector para el selector guiado de Entrada/
   * Transferencia. Devuelve, por cada uno, las bases (pilas) ocupadas vs
   * capacidad y un estado: BLOCKED (inactiva), FULL (sin bases libres),
   * PARTIAL (con lugar pero con alguna base ocupada), FREE.
   */
  async availability() {
    const locations = await this.locationRepo.find({ relations: ['warehouse'] });

    // Bases (pilas) por Sector-Subsector. Las EMPTY ya liberaron su base.
    const counts = await this.pilaRepo
      .createQueryBuilder('p')
      .select('p."locationId"', 'locationId')
      .addSelect('COUNT(*)', 'bases')
      .where("p.status <> 'EMPTY'")
      .groupBy('p."locationId"')
      .getRawMany<{ locationId: string; bases: string }>();

    const basesByLoc = new Map(counts.map((c) => [c.locationId, Number(c.bases)]));

    return locations.map((loc) => {
      const occupied = basesByLoc.get(loc.id) ?? 0;
      const capacity = loc.capacityBases ?? null;
      let status: LocationAvailabilityStatus;
      if (!loc.active) status = 'BLOCKED';
      else if (capacity != null && occupied >= capacity) status = 'FULL';
      else if (occupied > 0) status = 'PARTIAL';
      else status = 'FREE';
      return {
        id: loc.id,
        code: loc.code,
        zone: loc.zone ?? null,
        aisle: loc.aisle ?? null,
        rack: loc.rack ?? null,
        warehouseId: loc.warehouse?.id ?? null,
        warehouseName: loc.warehouse?.name ?? null,
        active: loc.active,
        occupied,
        capacity,
        status,
      };
    });
  }

  /**
   * Slotting: recomienda en qué Sector-Subsector guardar un pallet de
   * `productId`. Filtra sectores factibles (temperatura, peso, altura,
   * bases libres) y los puntúa (consolidación con el mismo producto ya
   * apilado, zona de almacenamiento, bases libres). Devuelve top 3 con el
   * motivo de cada recomendación.
   *
   * La factibilidad dura (temperatura/peso/altura) reusa
   * `PilasService.feasibility()` — la misma lógica que aplica de verdad el
   * motor de colocación al confirmar una entrada; acá es solo una sugerencia
   * ligera (no reserva nada, no toma locks).
   */
  async recommend(productId: string, quantity = 1) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const locations = await this.locationRepo.find({ relations: ['warehouse'] });

    // Bases (pilas) ocupadas por Sector-Subsector. Las EMPTY ya liberaron su base.
    const baseCounts = await this.pilaRepo
      .createQueryBuilder('p')
      .select('p."locationId"', 'locationId')
      .addSelect('COUNT(*)', 'bases')
      .where("p.status <> 'EMPTY'")
      .groupBy('p."locationId"')
      .getRawMany<{ locationId: string; bases: string }>();
    const basesByLoc = new Map(baseCounts.map((c) => [c.locationId, Number(c.bases)]));

    // Sectores con una pila abierta del mismo producto (para consolidar sin abrir base nueva).
    const sameProductRows = await this.pilaRepo
      .createQueryBuilder('p')
      .select('DISTINCT p."locationId"', 'locationId')
      .where('p."productId" = :productId', { productId })
      .andWhere("p.status = 'OPEN'")
      .getRawMany<{ locationId: string }>();
    const sameProductLocs = new Set(sameProductRows.map((r) => r.locationId));

    const scored = locations
      .filter((loc) => loc.active)
      .map((loc) => {
        const basesUsed = basesByLoc.get(loc.id) ?? 0;
        const capacity = loc.capacityBases ?? null;
        const consolidates = sameProductLocs.has(loc.id);
        const reasons: string[] = [];

        // Consolidar en una pila ya abierta del mismo producto no exige base
        // nueva; si no hay dónde consolidar, hace falta lugar para una.
        const hasRoom = consolidates || capacity == null || basesUsed < capacity;
        const { feasible: tempWeightHeightOk, blockers } = this.pilas.feasibility(loc, product);
        if (!hasRoom) blockers.push('sin bases libres');
        const feasible = hasRoom && tempWeightHeightOk;

        // ── Puntaje (mayor = mejor) ──
        let score = 0;
        if (consolidates) {
          score += 50;
          reasons.push('mismo producto ya almacenado aquí');
        }
        if (loc.zone === 'ALMACENAMIENTO') {
          score += 20;
          reasons.push('zona de almacenamiento');
        }
        // Desempate suave: preferir más bases libres.
        if (capacity != null) score += Math.max(0, capacity - basesUsed);

        return { loc, occupied: basesUsed, capacity, feasible, score, reasons, blockers };
      });

    const recommendations = scored
      .filter((s) => s.feasible)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => ({
        id: s.loc.id,
        code: s.loc.code,
        zone: s.loc.zone ?? null,
        warehouseName: s.loc.warehouse?.name ?? null,
        occupied: s.occupied,
        capacity: s.capacity,
        score: s.score,
        reasons: s.reasons.length ? s.reasons : ['cumple las restricciones'],
      }));

    return {
      productId,
      quantity,
      product: {
        code: product.code,
        description: product.description,
        temperatureZone: product.temperatureZone ?? 'AMBIENT',
        fragile: product.fragile,
        rotationPolicy: product.rotationPolicy,
      },
      recommendations,
      message: recommendations.length
        ? null
        : 'No hay sectores factibles. Revisá temperatura, capacidad, peso o altura.',
    };
  }

  /* ── Localizador visual de stock ───────────────────────────────────────── */

  /**
   * Mapa del depósito con ocupación y diagnóstico por celda. Es la base de las
   * tres vistas del localizador (Buscar inventario / Ubicaciones libres /
   * Incidencias): una sola consulta que cruza ubicaciones, pallets vigentes,
   * vencimientos y la tabla `stocks`.
   */
  async map(warehouseId?: string): Promise<{
    locations: LocationCell[];
    summary: {
      totalLocations: number;
      activeLocations: number;
      freeLocations: number;
      occupiedLocations: number;
      fullLocations: number;
      incidentLocations: number;
      totalPallets: number;
      totalUnits: number;
      byZone: { zone: string; locations: number; occupied: number; free: number; pallets: number; units: number }[];
    };
  }> {
    const params: unknown[] = [EXPIRY_WARNING_DAYS];
    let whereClause = '';
    if (warehouseId) {
      params.push(warehouseId);
      whereClause = `WHERE loc."warehouseId"::text = $${params.length}`;
    }

    const rows = await this.dataSource.query<RawCell[]>(
      `
      WITH pal AS (
        SELECT
          p."currentLocationId"                                          AS "locationId",
          COUNT(*)::int                                                  AS pallets,
          COALESCE(SUM(p.quantity), 0)::float8                           AS units,
          COUNT(*) FILTER (WHERE p.status IN ('BLOCKED', 'DAMAGED'))::int AS "blockedPallets",
          COUNT(*) FILTER (
            WHERE l."fechaVencimiento" IS NOT NULL
              AND l."fechaVencimiento" < CURRENT_DATE
          )::int                                                          AS "expiredPallets",
          COUNT(*) FILTER (
            WHERE l."fechaVencimiento" IS NOT NULL
              AND l."fechaVencimiento" >= CURRENT_DATE
              AND l."fechaVencimiento" <= CURRENT_DATE + $1::int
          )::int                                                          AS "expiringPallets",
          MIN(l."fechaVencimiento")::text                                 AS "nearestExpiry"
        FROM pallets p
        JOIN lots l ON l.id = p."lotId"
        WHERE ${LIVE_PALLET_STATUSES}
          AND p."currentLocationId" IS NOT NULL
        GROUP BY p."currentLocationId"
      ),
      stk AS (
        SELECT "locationId", COALESCE(SUM("currentQuantity"), 0)::float8 AS "stockUnits"
        FROM stocks
        WHERE "locationId" IS NOT NULL
        GROUP BY "locationId"
      ),
      pil AS (
        SELECT "locationId", COUNT(*)::int AS bases
        FROM pilas
        WHERE status <> 'EMPTY'
        GROUP BY "locationId"
      )
      SELECT
        loc.id, loc.code, loc.type, loc.active, loc.zone, loc.aisle, loc.rack,
        loc."capacityPallets", loc."capacityBases",
        w.id                                AS "warehouseId",
        w.name                              AS "warehouseName",
        COALESCE(pal.pallets, 0)            AS pallets,
        COALESCE(pal.units, 0)              AS units,
        COALESCE(stk."stockUnits", 0)       AS "stockUnits",
        COALESCE(pal."blockedPallets", 0)   AS "blockedPallets",
        COALESCE(pal."expiredPallets", 0)   AS "expiredPallets",
        COALESCE(pal."expiringPallets", 0)  AS "expiringPallets",
        pal."nearestExpiry",
        COALESCE(pil.bases, 0)              AS "basesUsed"
      FROM locations loc
      LEFT JOIN warehouses w ON w.id = loc."warehouseId"
      LEFT JOIN pal ON pal."locationId" = loc.id
      LEFT JOIN stk ON stk."locationId" = loc.id
      LEFT JOIN pil ON pil."locationId" = loc.id
      ${whereClause}
      ORDER BY loc.zone NULLS LAST, loc.aisle NULLS LAST, loc.rack, loc.code
      `,
      params,
    );

    const locations = rows.map((r) => this.classifyCell(r));

    const byZoneMap = new Map<string, { zone: string; locations: number; occupied: number; free: number; pallets: number; units: number }>();
    for (const l of locations) {
      const key = l.zone ?? 'SIN_ZONA';
      const z = byZoneMap.get(key) ?? { zone: key, locations: 0, occupied: 0, free: 0, pallets: 0, units: 0 };
      z.locations += 1;
      if (l.pallets > 0) z.occupied += 1;
      else if (l.active) z.free += 1;
      z.pallets += l.pallets;
      z.units += l.units;
      byZoneMap.set(key, z);
    }

    return {
      locations,
      summary: {
        totalLocations: locations.length,
        activeLocations: locations.filter((l) => l.active).length,
        freeLocations: locations.filter((l) => l.state === 'FREE').length,
        occupiedLocations: locations.filter((l) => l.pallets > 0).length,
        fullLocations: locations.filter((l) => l.state === 'FULL').length,
        incidentLocations: locations.filter((l) => l.issues.length > 0).length,
        totalPallets: locations.reduce((s, l) => s + l.pallets, 0),
        totalUnits: locations.reduce((s, l) => s + l.units, 0),
        byZone: [...byZoneMap.values()],
      },
    };
  }

  /**
   * Traduce los contadores crudos de una celda a issues + estado visual.
   * La precedencia va de lo más accionable a lo más informativo: una ubicación
   * inactiva se muestra como inactiva aunque además esté llena.
   */
  private classifyCell(raw: RawCell): LocationCell {
    const pallets = Number(raw.pallets);
    const units = Number(raw.units);
    const stockUnits = Number(raw.stockUnits);
    const basesUsed = Number(raw.basesUsed);
    const basesCapacity = raw.capacityBases ?? null;

    const issues: LocationIssue[] = [];
    if (basesCapacity != null && basesUsed > basesCapacity) issues.push('OVER_CAPACITY');
    if (raw.blockedPallets > 0) issues.push('BLOCKED_PALLETS');
    if (Math.abs(units - stockUnits) > UNIT_TOLERANCE) issues.push('STOCK_MISMATCH');
    if (raw.expiredPallets > 0) issues.push('EXPIRED');
    if (raw.expiringPallets > 0) issues.push('EXPIRING');
    if (!raw.active && pallets > 0) issues.push('INACTIVE_WITH_STOCK');

    // Una ubicación TEMPORAL —o de RECEPCION— con contenido es una entrada
    // provisoria: mercadería que todavía no fue guardada en su hueco definitivo.
    const provisional = pallets > 0 && (raw.type === 'TEMPORAL' || raw.zone === 'RECEPCION');
    const hardIssue =
      issues.includes('OVER_CAPACITY') ||
      issues.includes('BLOCKED_PALLETS') ||
      issues.includes('STOCK_MISMATCH') ||
      issues.includes('INACTIVE_WITH_STOCK');

    let state: LocationMapState;
    if (!raw.active) state = 'INACTIVE';
    else if (hardIssue) state = 'INCIDENT';
    else if (raw.expiredPallets > 0 || raw.expiringPallets > 0) state = 'EXPIRING';
    else if (basesCapacity != null && basesUsed >= basesCapacity && basesUsed > 0) state = 'FULL';
    else if (provisional) state = 'PROVISIONAL';
    else if (pallets > 0) state = 'OCCUPIED';
    else state = 'FREE';

    return {
      ...raw,
      pallets,
      units,
      stockUnits,
      basesUsed,
      capacityBases: basesCapacity,
      blockedPallets: Number(raw.blockedPallets),
      expiredPallets: Number(raw.expiredPallets),
      expiringPallets: Number(raw.expiringPallets),
      issues,
      state,
    };
  }

  /**
   * Localizador: "¿dónde está este material?". Busca por código o descripción
   * de material, lote interno, lote del proveedor, lote SAP, código de pallet o
   * código de ubicación, y devuelve las líneas de stock que coinciden más los
   * totales por material y las ubicaciones a resaltar en el mapa.
   */
  async stockSearch(query: string, warehouseId?: string) {
    const term = query?.trim() ?? '';
    if (term.length < 2) {
      throw new BadRequestException('Ingresá al menos 2 caracteres para buscar.');
    }

    const params: unknown[] = [`%${term}%`];
    let warehouseFilter = '';
    if (warehouseId) {
      params.push(warehouseId);
      warehouseFilter = `AND loc."warehouseId"::text = $${params.length}`;
    }

    const rows = await this.dataSource.query<StockSearchRow[]>(
      `
      SELECT
        p.id                              AS "palletId",
        p.code                            AS "palletCode",
        p.status                          AS "palletStatus",
        p.quantity::float8                AS quantity,
        l.id                              AS "lotId",
        l."lotCode",
        l."supplierLot",
        l."sapLot",
        l."fechaVencimiento"::text        AS "fechaVencimiento",
        l.status                          AS "lotStatus",
        pr.id                             AS "productId",
        pr.code                           AS "productCode",
        pr.description                    AS "productDescription",
        pr."unitOfMeasure",
        loc.id                            AS "locationId",
        loc.code                          AS "locationCode",
        loc.zone,
        loc.aisle,
        loc.rack,
        loc.level,
        loc.position,
        loc.active                        AS "locationActive",
        w.id                              AS "warehouseId",
        w.name                            AS "warehouseName",
        ent."documentId"                  AS "entryDocumentId"
      FROM pallets p
      JOIN lots     l  ON l.id  = p."lotId"
      JOIN products pr ON pr.id = l."productId"
      LEFT JOIN locations  loc ON loc.id = p."currentLocationId"
      LEFT JOIN warehouses w   ON w.id   = loc."warehouseId"
      LEFT JOIN LATERAL (
        SELECT m."documentId"
        FROM movement_details md
        JOIN movements m ON m.id = md."movementId"
        WHERE md."palletId" = p.id
          AND m."documentId" IS NOT NULL
        ORDER BY (m.type IN ('ENTRY', 'ADJUSTMENT_IN')) DESC, m.date ASC
        LIMIT 1
      ) ent ON TRUE
      WHERE ${LIVE_PALLET_STATUSES}
        AND (
          pr.code        ILIKE $1 OR
          pr.description ILIKE $1 OR
          l."lotCode"    ILIKE $1 OR
          l."supplierLot" ILIKE $1 OR
          l."sapLot"     ILIKE $1 OR
          p.code         ILIKE $1 OR
          loc.code       ILIKE $1
        )
        ${warehouseFilter}
      ORDER BY pr.code, l."lotCode", loc.code NULLS LAST, p.code
      LIMIT ${SEARCH_ROW_LIMIT}
      `,
      params,
    );

    // Agrupación por material: es la respuesta que espera el operario
    // ("40004808 — 12.500 TS en 4 ubicaciones"), no la lista cruda de pallets.
    const byProduct = new Map<string, {
      productId: string;
      productCode: string;
      productDescription: string;
      unitOfMeasure: string | null;
      quantity: number;
      pallets: number;
      lots: Set<string>;
      locations: Set<string>;
      unlocated: number;
    }>();

    for (const r of rows) {
      const g = byProduct.get(r.productId) ?? {
        productId: r.productId,
        productCode: r.productCode,
        productDescription: r.productDescription,
        unitOfMeasure: r.unitOfMeasure ?? null,
        quantity: 0,
        pallets: 0,
        lots: new Set<string>(),
        locations: new Set<string>(),
        unlocated: 0,
      };
      g.quantity += Number(r.quantity);
      g.pallets += 1;
      g.lots.add(r.lotId);
      if (r.locationId) g.locations.add(r.locationId);
      else g.unlocated += 1;
      byProduct.set(r.productId, g);
    }

    const products = [...byProduct.values()]
      .map((g) => ({
        productId: g.productId,
        productCode: g.productCode,
        productDescription: g.productDescription,
        unitOfMeasure: g.unitOfMeasure,
        quantity: g.quantity,
        pallets: g.pallets,
        lots: g.lots.size,
        locations: g.locations.size,
        unlocatedPallets: g.unlocated,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    const locationIds = [...new Set(rows.map((r) => r.locationId).filter((id): id is string => !!id))];

    // Un material del catálogo que coincide pero no tiene stock vigente: sin
    // esto la pantalla diría "sin resultados" cuando la respuesta real es
    // "existe, pero no hay nada en depósito".
    const emptyProducts = rows.length === 0
      ? await this.dataSource.query<{ id: string; code: string; description: string; unitOfMeasure: string | null }[]>(
          `SELECT id, code, description, "unitOfMeasure"
           FROM products
           WHERE (code ILIKE $1 OR description ILIKE $1) AND active = true
           ORDER BY code
           LIMIT 20`,
          [`%${term}%`],
        )
      : [];

    return {
      query: term,
      truncated: rows.length >= SEARCH_ROW_LIMIT,
      summary: {
        quantity: rows.reduce((s, r) => s + Number(r.quantity), 0),
        pallets: rows.length,
        lots: new Set(rows.map((r) => r.lotId)).size,
        locations: locationIds.length,
        unlocatedPallets: rows.filter((r) => !r.locationId).length,
        products: products.length,
      },
      products,
      locationIds,
      rows: rows.map((r) => ({ ...r, quantity: Number(r.quantity) })),
      emptyProducts,
    };
  }

  /**
   * Contenido de una ubicación para el panel lateral: capacidad, ocupación y
   * el detalle de cada pallet (material, lote interno, lote proveedor,
   * vencimiento, cantidad) con el documento de entrada para reimprimir etiqueta.
   */
  async content(id: string) {
    const location = await this.findOne(id);

    const pallets = await this.dataSource.query<(LocationContentPallet & { pilaId: string | null; stackPosition: number | null })[]>(
      `
      SELECT
        p.id                        AS "palletId",
        p.code                      AS "palletCode",
        p.status                    AS "palletStatus",
        p.quantity::float8          AS quantity,
        p."createdAt"::text         AS "createdAt",
        p."pilaId",
        p."stackPosition",
        l.id                        AS "lotId",
        l."lotCode",
        l."supplierLot",
        l."sapLot",
        l."fechaVencimiento"::text  AS "fechaVencimiento",
        l.status                    AS "lotStatus",
        pr.id                       AS "productId",
        pr.code                     AS "productCode",
        pr.description              AS "productDescription",
        pr."unitOfMeasure",
        ent."documentId"            AS "entryDocumentId"
      FROM pallets p
      JOIN lots     l  ON l.id  = p."lotId"
      JOIN products pr ON pr.id = l."productId"
      LEFT JOIN LATERAL (
        SELECT m."documentId"
        FROM movement_details md
        JOIN movements m ON m.id = md."movementId"
        WHERE md."palletId" = p.id
          AND m."documentId" IS NOT NULL
        ORDER BY (m.type IN ('ENTRY', 'ADJUSTMENT_IN')) DESC, m.date ASC
        LIMIT 1
      ) ent ON TRUE
      WHERE p."currentLocationId"::text = $1
        AND ${LIVE_PALLET_STATUSES}
      ORDER BY l."fechaVencimiento" NULLS LAST, p.code
      `,
      [id],
    );

    const [stockRow] = await this.dataSource.query<{ stockUnits: number }[]>(
      `SELECT COALESCE(SUM("currentQuantity"), 0)::float8 AS "stockUnits"
       FROM stocks WHERE "locationId"::text = $1`,
      [id],
    );

    const units = pallets.reduce((s, p) => s + Number(p.quantity), 0);
    const stockUnits = Number(stockRow?.stockUnits ?? 0);

    // Agrupar por pila (base) para el panel — a los pallets sin pilaId
    // (legado, o restaurados sin volver a pasar por el motor) se los agrupa
    // aparte, no se los pierde.
    const pilaIds = [...new Set(pallets.map((p) => p.pilaId).filter((v): v is string => !!v))];
    const pilaRows = pilaIds.length
      ? await this.pilaRepo.find({ where: { id: In(pilaIds) } })
      : [];
    const pilaById = new Map(pilaRows.map((p) => [p.id, p]));

    const pileGroups = new Map<string, { pilaId: string | null; sequence: number | null; pallets: typeof pallets }>();
    for (const p of pallets) {
      const key = p.pilaId ?? '__sin_pila__';
      const group = pileGroups.get(key) ?? {
        pilaId: p.pilaId,
        sequence: p.pilaId ? pilaById.get(p.pilaId)?.sequence ?? null : null,
        pallets: [],
      };
      group.pallets.push(p);
      pileGroups.set(key, group);
    }
    const piles = [...pileGroups.values()].sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));

    return {
      location: {
        id: location.id,
        code: location.code,
        type: location.type,
        active: location.active,
        zone: location.zone ?? null,
        aisle: location.aisle ?? null,
        rack: location.rack ?? null,
        capacityBases: location.capacityBases ?? null,
        temperatureZone: location.temperatureZone,
        warehouseId: location.warehouse?.id ?? null,
        warehouseName: location.warehouse?.name ?? null,
      },
      occupancy: {
        pallets: pallets.length,
        basesUsed: piles.length,
        basesCapacity: location.capacityBases ?? null,
        units,
        stockUnits,
        mismatch: Math.abs(units - stockUnits) > UNIT_TOLERANCE ? stockUnits - units : 0,
      },
      piles: piles.map((g) => ({
        pilaId: g.pilaId,
        sequence: g.sequence,
        pallets: g.pallets.map((p) => ({ ...p, quantity: Number(p.quantity) })),
      })),
      pallets: pallets.map((p) => ({ ...p, quantity: Number(p.quantity) })),
    };
  }

  /**
   * Vista Incidencias: ubicaciones con diferencia de stock, sobrecapacidad,
   * pallets bloqueados o vencimientos, más lo que no está en ninguna ubicación
   * (pallets sin ubicar y stock a nivel depósito).
   */
  async incidents(warehouseId?: string) {
    const { locations } = await this.map(warehouseId);
    const flagged = locations.filter((l) => l.issues.length > 0);

    const params: unknown[] = [];
    let palletWarehouseFilter = '';
    let stockWarehouseFilter = '';
    if (warehouseId) {
      params.push(warehouseId);
      // Un pallet sin ubicación no tiene depósito propio: se acota por el
      // depósito del stock de su material para no ocultarlo del todo.
      palletWarehouseFilter = `AND EXISTS (
        SELECT 1 FROM stocks s
        WHERE s."productId" = l."productId" AND s."warehouseId"::text = $${params.length}
      )`;
      stockWarehouseFilter = `AND s."warehouseId"::text = $${params.length}`;
    }

    const palletsWithoutLocation = await this.dataSource.query<UnlocatedPallet[]>(
      `
      SELECT
        p.id               AS "palletId",
        p.code             AS "palletCode",
        p.status           AS "palletStatus",
        p.quantity::float8 AS quantity,
        l."lotCode",
        l."supplierLot",
        l."fechaVencimiento"::text AS "fechaVencimiento",
        pr.code            AS "productCode",
        pr.description     AS "productDescription",
        pr."unitOfMeasure"
      FROM pallets p
      JOIN lots     l  ON l.id  = p."lotId"
      JOIN products pr ON pr.id = l."productId"
      WHERE p."currentLocationId" IS NULL
        AND ${LIVE_PALLET_STATUSES}
        ${palletWarehouseFilter}
      ORDER BY pr.code, p.code
      LIMIT 200
      `,
      params,
    );

    const stockWithoutLocation = await this.dataSource.query<UnlocatedStock[]>(
      `
      SELECT
        pr.id                        AS "productId",
        pr.code                      AS "productCode",
        pr.description               AS "productDescription",
        pr."unitOfMeasure",
        w.name                       AS "warehouseName",
        s."currentQuantity"::float8  AS quantity
      FROM stocks s
      JOIN products pr ON pr.id = s."productId"
      LEFT JOIN warehouses w ON w.id = s."warehouseId"
      WHERE s."locationId" IS NULL
        AND s."currentQuantity" <> 0
        ${stockWarehouseFilter}
      ORDER BY pr.code
      LIMIT 200
      `,
      params,
    );

    const count = (issue: LocationIssue) => flagged.filter((l) => l.issues.includes(issue)).length;

    return {
      locations: flagged,
      palletsWithoutLocation: palletsWithoutLocation.map((p) => ({ ...p, quantity: Number(p.quantity) })),
      stockWithoutLocation: stockWithoutLocation.map((s) => ({ ...s, quantity: Number(s.quantity) })),
      summary: {
        locations: flagged.length,
        overCapacity: count('OVER_CAPACITY'),
        blockedPallets: count('BLOCKED_PALLETS'),
        stockMismatch: count('STOCK_MISMATCH'),
        expired: count('EXPIRED'),
        expiring: count('EXPIRING'),
        inactiveWithStock: count('INACTIVE_WITH_STOCK'),
        palletsWithoutLocation: palletsWithoutLocation.length,
        stockWithoutLocation: stockWithoutLocation.length,
        expiryWarningDays: EXPIRY_WARNING_DAYS,
      },
    };
  }

  async findOne(id: string) {
    const location = await this.locationRepo.findOne({
      where: { id },
      relations: ['warehouse'],
    });

    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async update(id: string, dto: UpdateLocationDto) {
    const location = await this.findOne(id);
    if (dto.warehouseId) {
      const warehouse = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } });
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      location.warehouse = warehouse;
    }
    const { warehouseId: _ignored, ...fields } = dto;
    void _ignored;

    // Mismo criterio que en create(): no dejar dos celdas con el mismo
    // Sector-Subsector, ni siquiera moviendo una existente a un par ya tomado.
    if (dto.aisle !== undefined || dto.rack !== undefined) {
      const nextAisle = (dto.aisle ?? location.aisle)?.trim().toUpperCase() || null;
      const nextRack = (dto.rack ?? location.rack)?.trim().toUpperCase() || null;
      await this.assertSubsectorFree(
        location.warehouse.id, nextAisle, nextRack, location.warehouse.name, location.id,
      );
      if (dto.aisle !== undefined) fields.aisle = nextAisle ?? undefined;
      if (dto.rack !== undefined) fields.rack = nextRack ?? undefined;
    }

    Object.assign(location, fields);
    return this.locationRepo.save(location);
  }

  async remove(id: string) {
    const location = await this.findOne(id);

    // stocks.locationId y pallets.currentLocationId son columnas uuid sin FK: si se
    // borra una ubicación ocupada, el stock y los pallets quedan apuntando a un id
    // inexistente — invisibles en el mapa del depósito pero sumando en los totales.
    const pallets = await this.palletRepo.count({
      where: { currentLocationId: id, status: Not(In(['EXITED', 'EMPTY'])) },
    });
    const [{ stock }] = (await this.locationRepo.query(
      // float8, no int: con ::int una ubicación con 0.4 unidades daría stock = 0
      // y se dejaría borrar, dejando ese stock huérfano apuntando a un id inexistente.
      `SELECT COALESCE(SUM("currentQuantity"), 0)::float8 AS stock FROM stocks WHERE "locationId" = $1`,
      [id],
    )) as Array<{ stock: number }>;

    if (pallets > 0 || stock !== 0) {
      throw new BadRequestException(
        `No se puede eliminar la ubicación ${location.code}: tiene ${pallets} palet(s) y ${stock} unidad(es) de stock. ` +
        `Transferí el contenido antes de eliminarla.`,
      );
    }

    // Sin pallets/stock vivos, cualquier pila que quede acá es residual (vacía
    // o con solo pallets EXITED) — limpiarla ahora evita que quede colgada
    // apuntando a un locationId que está a punto de dejar de existir (mismo
    // riesgo de huérfano que ya se evita arriba para pallets/stocks).
    await this.pilaRepo.delete({ locationId: id });

    return this.locationRepo.remove(location);
  }

  /**
   * Elimina un pasillo completo — el caso real es un sector generado con
   * parámetros equivocados, donde borrar posición por posición son decenas de
   * clics.
   *
   * Es todo-o-nada a propósito: si alguna posición tiene contenido, no borra
   * nada y devuelve cuáles son. Un borrado parcial dejaría media estructura en
   * pie, que es más difícil de entender (y de deshacer) que un rechazo claro.
   */
  async removeAisle(warehouseId: string, aisle: string) {
    const normalized = aisle.trim().toUpperCase();
    if (!normalized) throw new BadRequestException('Indicá el pasillo a eliminar.');

    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const locations = await this.locationRepo.find({
      where: { aisle: normalized, warehouse: { id: warehouseId } },
    });
    if (locations.length === 0) {
      throw new NotFoundException(`El pasillo ${normalized} no tiene ubicaciones en este depósito.`);
    }

    const ids = locations.map((l) => l.id);
    const occupied = (await this.locationRepo.query(
      `SELECT l.id,
              l.code,
              COALESCE(pal.pallets, 0)::int     AS pallets,
              COALESCE(st.stock, 0)::float8     AS stock
         FROM locations l
         LEFT JOIN (SELECT "currentLocationId" AS loc, COUNT(*) AS pallets
                      FROM pallets
                     WHERE status NOT IN ('EXITED', 'EMPTY')
                     GROUP BY "currentLocationId") pal ON pal.loc = l.id
         LEFT JOIN (SELECT "locationId" AS loc, SUM("currentQuantity") AS stock
                      FROM stocks GROUP BY "locationId") st ON st.loc = l.id
        WHERE l.id = ANY($1)
          AND (COALESCE(pal.pallets, 0) > 0 OR COALESCE(st.stock, 0) <> 0)
        ORDER BY l.code`,
      [ids],
    )) as Array<{ code: string; pallets: number; stock: number }>;

    if (occupied.length > 0) {
      const detalle = occupied.slice(0, 5).map((o) => `${o.code} (${o.pallets} palet/s, ${o.stock} unid.)`).join(', ');
      const resto = occupied.length > 5 ? ` y ${occupied.length - 5} más` : '';
      throw new BadRequestException(
        `No se puede eliminar el pasillo ${normalized}: ${occupied.length} ubicación(es) con contenido — ${detalle}${resto}. ` +
        `Transferí el contenido antes de eliminarlo.`,
      );
    }

    // Igual que en remove(): sin pallets/stock vivos en ninguna ubicación del
    // pasillo, cualquier pila residual (vacía o con solo EXITED) se limpia
    // antes de borrar para no dejarla colgada.
    await this.pilaRepo.delete({ locationId: In(ids) });

    await this.locationRepo.remove(locations);
    return { aisle: normalized, deleted: locations.length };
  }
}
