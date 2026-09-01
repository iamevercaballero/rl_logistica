import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  capacityBases: number | null;
  basesUsed: number;
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

  async create(dto: CreateWarehouseDto) {
    const name = dto.name.trim();
    const documentCode = dto.documentCode.trim();
    if (!name) throw new BadRequestException('El nombre del depósito es obligatorio');

    // Dos depósitos homónimos son indistinguibles en los selectores y en los reportes.
    const existing = await this.warehouseRepo.findOne({ where: { name } });
    if (existing) throw new BadRequestException(`Ya existe un depósito con el nombre "${name}"`);

    const codeInUse = await this.warehouseRepo.findOne({ where: { documentCode } });
    if (codeInUse) throw new BadRequestException(`El código documental ${documentCode} ya pertenece a otro depósito`);

    const warehouse = this.warehouseRepo.create({ ...dto, name, documentCode });
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
        loc."capacityBases",
        COUNT(DISTINCT pil.id)::int           AS "basesUsed",
        COUNT(p.id)::int                      AS "pallets",
        COALESCE(SUM(p.quantity), 0)::float8  AS "units"
      FROM locations loc
      LEFT JOIN pallets p
        ON p."currentLocationId" = loc.id
       AND p.status NOT IN ('EXITED', 'EMPTY')
      LEFT JOIN pilas pil
        ON pil."locationId" = loc.id
       AND pil.status <> 'EMPTY'
      WHERE loc."warehouseId" = $1
      GROUP BY loc.id
      ORDER BY loc.zone NULLS LAST, loc.aisle NULLS LAST, loc.rack, loc.code
      `,
      [id],
    );

    const byZoneMap = new Map<string, { zone: string; locations: number; occupied: number; pallets: number; units: number }>();
    for (const l of locations) {
      const key = l.zone ?? 'SIN_ZONA';
      const z = byZoneMap.get(key) ?? { zone: key, locations: 0, occupied: 0, pallets: 0, units: 0 };
      z.locations += 1;
      if (l.basesUsed > 0) z.occupied += 1;
      z.pallets += l.pallets;
      z.units += l.units;
      byZoneMap.set(key, z);
    }

    const summary = {
      totalLocations: locations.length,
      activeLocations: locations.filter((l) => l.active).length,
      occupied: locations.filter((l) => l.basesUsed > 0).length,
      totalPallets: locations.reduce((s, l) => s + l.pallets, 0),
      totalUnits: locations.reduce((s, l) => s + l.units, 0),
      byZone: [...byZoneMap.values()],
    };

    return { warehouse, locations, summary };
  }

  async update(id: string, dto: UpdateWarehouseDto) {
    const warehouse = await this.findOne(id);
    if (dto.documentCode !== undefined) {
      const documentCode = dto.documentCode.trim();
      if (warehouse.documentCode && warehouse.documentCode !== documentCode) {
        throw new BadRequestException(
          `El código documental ${warehouse.documentCode} es estable y no puede modificarse`,
        );
      }
      const codeInUse = await this.warehouseRepo.findOne({ where: { documentCode } });
      if (codeInUse && codeInUse.id !== id) {
        throw new BadRequestException(`El código documental ${documentCode} ya pertenece a otro depósito`);
      }
      warehouse.documentCode = documentCode;
    }
    if (dto.name !== undefined) warehouse.name = dto.name.trim();
    if (dto.address !== undefined) warehouse.address = dto.address.trim();
    if (dto.active !== undefined) warehouse.active = dto.active;
    return this.warehouseRepo.save(warehouse);
  }

  /**
   * Un depósito con ubicaciones no puede borrarse: la FK de `locations.warehouseId`
   * lo impedía con un 500 sin explicación. Con stock además hay mercadería real.
   */
  async remove(id: string) {
    const warehouse = await this.findOne(id);

    const [uso] = (await this.warehouseRepo.query(
      `SELECT
         (SELECT COUNT(*) FROM locations WHERE "warehouseId" = $1)::int AS locations,
         (SELECT COALESCE(SUM("currentQuantity"), 0) FROM stocks
           WHERE "warehouseId" = $1)::float8                            AS stock,
         (SELECT COUNT(*) FROM stocks WHERE "warehouseId" = $1)::int    AS "stockRows",
         (SELECT COUNT(*) FROM movements
           WHERE "warehouseId" = $1 OR "fromWarehouseId" = $1
              OR "toWarehouseId" = $1)::int                             AS movements,
         (SELECT COUNT(*) FROM logistics_documents
           WHERE "warehouseId" = $1)::int                               AS documents,
         (SELECT COUNT(*) FROM document_sequences
           WHERE "warehouseId" = $1)::int                               AS sequences`,
      [id],
    )) as Array<{
      locations: number; stock: number; stockRows: number;
      movements: number; documents: number; sequences: number;
    }>;

    if (uso.locations > 0 || uso.stock !== 0) {
      throw new BadRequestException(
        `No se puede eliminar el depósito ${warehouse.name}: tiene ${uso.locations} ubicación(es) y ${uso.stock} unidad(es) de stock. ` +
        `Vaciá y eliminá sus ubicaciones antes de darlo de baja.`,
      );
    }

    // RL-M-12: sin ubicaciones ni stock todavía puede haber historia —
    // movimientos, remitos, correlativos de documento, filas de stock en cero.
    // Antes se borraba igual y esas filas quedaban apuntando a un depósito
    // inexistente; desde RL-C-03 la base directamente lo rechaza. Con historia se
    // desactiva, mismo criterio que Materiales, Ubicaciones y Lotes.
    const historia = uso.movements + uso.documents + uso.sequences + uso.stockRows;
    if (historia > 0) {
      warehouse.active = false;
      await this.warehouseRepo.save(warehouse);
      return {
        deleted: true,
        deactivated: true,
        id: warehouse.id,
        reason:
          `El depósito ${warehouse.name} tiene ${uso.movements} movimiento(s) y ${uso.documents} remito(s) ` +
          `en su historial: se desactivó en lugar de eliminarse para preservar la trazabilidad.`,
      };
    }

    await this.warehouseRepo.remove(warehouse);
    return { deleted: true, deactivated: false, id };
  }
}
