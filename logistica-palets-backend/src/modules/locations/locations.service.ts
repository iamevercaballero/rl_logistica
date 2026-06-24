import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from './entities/location.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
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
