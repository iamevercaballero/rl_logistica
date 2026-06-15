import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

export type LayoutLocation = {
  id: string;
  code: string;
  type: string;
  active: boolean;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  level: number | null;
  position: number | null;
  capacityPallets: number | null;
  pallets: number;
  units: number;
};

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly dataSource: DataSource,
  ) {}

  create(dto: CreateWarehouseDto) {
    const warehouse = this.warehouseRepo.create(dto);
    return this.warehouseRepo.save(warehouse);
  }

  findAll() {
    return this.warehouseRepo.find();
  }

  async findOne(id: string) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  /**
   * Layout operativo del depósito: todas sus ubicaciones con estructura
   * (zona/pasillo/rack/nivel/posición) y ocupación actual (pallets y unidades
   * físicamente ubicados allí), más un resumen por zona.
   */
  async layout(id: string) {
    const warehouse = await this.findOne(id);

    const locations = await this.dataSource.query<LayoutLocation[]>(
      `
      SELECT
        loc.id,
        loc.code,
        loc.type,
        loc.active,
        loc.zone,
        loc.aisle,
        loc.rack,
        loc.level,
        loc.position,
        loc."capacityPallets",
        COUNT(p.id)::int                  AS "pallets",
        COALESCE(SUM(p.quantity), 0)::int AS "units"
      FROM locations loc
      LEFT JOIN pallets p
        ON p."currentLocationId" = loc.id
       AND p.status NOT IN ('EXITED', 'EMPTY')
      WHERE loc."warehouseId" = $1
      GROUP BY loc.id
      ORDER BY loc.zone NULLS LAST, loc.aisle NULLS LAST, loc.rack, loc.level, loc.position, loc.code
      `,
      [id],
    );

    const byZoneMap = new Map<string, { zone: string; locations: number; occupied: number; pallets: number; units: number }>();
    for (const l of locations) {
      const key = l.zone ?? 'SIN_ZONA';
      const z = byZoneMap.get(key) ?? { zone: key, locations: 0, occupied: 0, pallets: 0, units: 0 };
      z.locations += 1;
      if (l.pallets > 0) z.occupied += 1;
      z.pallets += l.pallets;
      z.units += l.units;
      byZoneMap.set(key, z);
    }

    const summary = {
      totalLocations: locations.length,
      activeLocations: locations.filter((l) => l.active).length,
      occupied: locations.filter((l) => l.pallets > 0).length,
      totalPallets: locations.reduce((s, l) => s + l.pallets, 0),
      totalUnits: locations.reduce((s, l) => s + l.units, 0),
      byZone: [...byZoneMap.values()],
    };

    return { warehouse, locations, summary };
  }

  async update(id: string, dto: UpdateWarehouseDto) {
    const warehouse = await this.findOne(id);
    Object.assign(warehouse, dto);
    return this.warehouseRepo.save(warehouse);
  }

  async remove(id: string) {
    const warehouse = await this.findOne(id);
    return this.warehouseRepo.remove(warehouse);
  }
}
