import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { Product } from '../products/entities/product.entity';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { GenerateLocationsDto } from './dto/generate-locations.dto';

/** Estado de disponibilidad de una ubicación para el selector guiado. */
export type LocationAvailabilityStatus = 'FREE' | 'PARTIAL' | 'FULL' | 'BLOCKED';

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
  ) {}

  async create(dto: CreateLocationDto) {
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: dto.warehouseId },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const location = this.locationRepo.create({
      code: dto.code,
      type: dto.type ?? 'RACK',
      zone: dto.zone ?? null,
      aisle: dto.aisle ?? null,
      rack: dto.rack ?? null,
      level: dto.level ?? null,
      position: dto.position ?? null,
      capacityPallets: dto.capacityPallets ?? null,
      temperatureZone: dto.temperatureZone ?? 'AMBIENT',
      maxWeightKg: dto.maxWeightKg ?? null,
      maxHeightCm: dto.maxHeightCm ?? null,
      allowsStacking: dto.allowsStacking ?? true,
      warehouse,
    });

    return this.locationRepo.save(location);
  }

  /**
   * Genera la estructura de una zona en lote:
   * pasillos × racks × niveles × posiciones → una Location por posición.
   * Los códigos ya existentes en el depósito se saltean (idempotente).
   */
  async generate(dto: GenerateLocationsDto) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const aisles = (dto.aisles ?? []).map((a) => a.trim().toUpperCase()).filter(Boolean);
    const racks = aisles.length > 0 ? (dto.racks ?? 1) : 0;
    const levels = aisles.length > 0 ? (dto.levels ?? 1) : 0;

    const total = (aisles.length || 1) * (racks || 1) * (levels || 1) * dto.positions;
    if (total > 2000) {
      throw new BadRequestException(
        `La estructura generaría ${total} ubicaciones (máximo 2000 por tanda). Reducí pasillos/racks/niveles/posiciones.`,
      );
    }

    const prefix = dto.codePrefix?.trim().toUpperCase() || null;
    const isRack = aisles.length > 0;

    type NewLoc = {
      code: string; zone: string; aisle: string | null; rack: string | null;
      level: number | null; position: number | null;
    };
    const wanted: NewLoc[] = [];

    if (isRack) {
      for (const aisle of aisles) {
        for (let r = 1; r <= racks; r++) {
          for (let n = 1; n <= levels; n++) {
            for (let p = 1; p <= dto.positions; p++) {
              wanted.push({
                code: [prefix, aisle, `R${r}`, `N${n}`, `P${p}`].filter(Boolean).join('-'),
                zone: dto.zone, aisle, rack: `R${r}`, level: n, position: p,
              });
            }
          }
        }
      }
    } else {
      for (let p = 1; p <= dto.positions; p++) {
        wanted.push({
          code: [prefix, `P${p}`].filter(Boolean).join('-'),
          zone: dto.zone, aisle: null, rack: null, level: null, position: p,
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
        type: isRack ? 'RACK' : 'PISO',
        zone: w.zone,
        aisle: w.aisle,
        rack: w.rack,
        level: w.level,
        position: w.position,
        capacityPallets: dto.capacityPallets ?? null,
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

  findAll() {
    return this.locationRepo.find({ relations: ['warehouse'] });
  }

  /**
   * Disponibilidad por ubicación para el selector guiado de Entrada/Transferencia.
   * Devuelve, por cada ubicación, los pallets ocupados vs capacidad y un estado:
   * BLOCKED (inactiva), FULL (sin lugar), PARTIAL (con lugar pero ocupada), FREE.
   */
  async availability() {
    const locations = await this.locationRepo.find({ relations: ['warehouse'] });

    // Conteo de pallets vigentes (no despachados ni vacíos) por ubicación
    const counts = await this.palletRepo
      .createQueryBuilder('p')
      .select('p."currentLocationId"', 'locationId')
      .addSelect('COUNT(*)', 'occupied')
      .where("p.status NOT IN ('EXITED', 'EMPTY')")
      .andWhere('p."currentLocationId" IS NOT NULL')
      .groupBy('p."currentLocationId"')
      .getRawMany<{ locationId: string; occupied: string }>();

    const occByLoc = new Map(counts.map((c) => [c.locationId, Number(c.occupied)]));

    return locations.map((loc) => {
      const occupied = occByLoc.get(loc.id) ?? 0;
      const capacity = loc.capacityPallets ?? null;
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
        level: loc.level ?? null,
        position: loc.position ?? null,
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
   * Slotting: recomienda dónde guardar un pallet de `productId`.
   * Filtra ubicaciones factibles (temperatura, peso, altura, capacidad,
   * apilamiento) y las puntúa (consolidación con el mismo producto, zona de
   * almacenamiento, frágil al piso, llenar huecos abiertos). Devuelve top 3 con
   * el motivo de cada recomendación.
   */
  async recommend(productId: string, quantity = 1) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const locations = await this.locationRepo.find({ relations: ['warehouse'] });

    // Ocupación vigente por ubicación.
    const counts = await this.palletRepo
      .createQueryBuilder('p')
      .select('p."currentLocationId"', 'locationId')
      .addSelect('COUNT(*)', 'occupied')
      .where("p.status NOT IN ('EXITED', 'EMPTY')")
      .andWhere('p."currentLocationId" IS NOT NULL')
      .groupBy('p."currentLocationId"')
      .getRawMany<{ locationId: string; occupied: string }>();
    const occByLoc = new Map(counts.map((c) => [c.locationId, Number(c.occupied)]));

    // Ubicaciones que ya contienen el mismo producto (para consolidar).
    const sameProductRows = await this.palletRepo
      .createQueryBuilder('p')
      .innerJoin('lots', 'lot', 'lot.id = p."lotId"')
      .select('DISTINCT p."currentLocationId"', 'locationId')
      .where('lot."productId" = :productId', { productId })
      .andWhere("p.status NOT IN ('EXITED', 'EMPTY')")
      .andWhere('p."currentLocationId" IS NOT NULL')
      .getRawMany<{ locationId: string }>();
    const sameProductLocs = new Set(sameProductRows.map((r) => r.locationId));

    const pWeight = product.weightKg ?? null;
    const pTemp = product.temperatureZone ?? 'AMBIENT';

    const scored = locations
      .filter((loc) => loc.active)
      .map((loc) => {
        const occupied = occByLoc.get(loc.id) ?? 0;
        const capacity = loc.capacityPallets ?? null;
        const reasons: string[] = [];
        const blockers: string[] = [];

        // ── Restricciones duras (factibilidad) ──
        const hasRoom = capacity == null || occupied < capacity;
        if (!hasRoom) blockers.push('sin lugar (llena)');

        const locTemp = loc.temperatureZone ?? 'AMBIENT';
        const tempOk = locTemp === pTemp;
        if (!tempOk) blockers.push(`temperatura ${locTemp} ≠ ${pTemp}`);

        const maxW = loc.maxWeightKg ?? null;
        const weightOk = maxW == null || pWeight == null || pWeight <= maxW;
        if (!weightOk) blockers.push('excede peso máximo');

        const heightOk =
          loc.maxHeightCm == null || product.heightCm == null || product.heightCm <= loc.maxHeightCm;
        if (!heightOk) blockers.push('excede altura máxima');

        // No apilable (producto o ubicación) → requiere celda vacía.
        const stackOk = (product.stackable && loc.allowsStacking) || occupied === 0;
        if (!stackOk) blockers.push('no apilable y celda ocupada');

        const feasible = hasRoom && tempOk && weightOk && heightOk && stackOk;

        // ── Puntaje (mayor = mejor) ──
        let score = 0;
        if (sameProductLocs.has(loc.id)) {
          score += 50;
          reasons.push('mismo producto ya almacenado aquí');
        }
        if (loc.zone === 'ALMACENAMIENTO') {
          score += 20;
          reasons.push('zona de almacenamiento');
        }
        if (product.fragile && loc.level === 1) {
          score += 10;
          reasons.push('producto frágil → nivel piso');
        }
        if (occupied > 0 && product.stackable && loc.allowsStacking) {
          score += 10;
          reasons.push('aprovecha hueco abierto');
        }
        // Desempate suave: preferir más espacio libre.
        if (capacity != null) score += Math.max(0, capacity - occupied);

        return { loc, occupied, capacity, feasible, score, reasons, blockers };
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
        temperatureZone: pTemp,
        fragile: product.fragile,
        rotationPolicy: product.rotationPolicy,
      },
      recommendations,
      message: recommendations.length
        ? null
        : 'No hay ubicaciones factibles. Revisá temperatura, capacidad, peso o altura.',
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
    Object.assign(location, fields);
    return this.locationRepo.save(location);
  }

  async remove(id: string) {
    const location = await this.findOne(id);
    return this.locationRepo.remove(location);
  }
}
