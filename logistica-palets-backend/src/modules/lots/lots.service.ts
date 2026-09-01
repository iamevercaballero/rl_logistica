import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lot, LOT_STATUS_ARCHIVED } from './entities/lot.entity';
import { Product } from '../products/entities/product.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { formatQuantity, quantitiesEqual, quantityDelta, roundQuantity } from '../../common/quantity';
import { CreateLotDto } from './dto/create-lot.dto';
import { UpdateLotDto } from './dto/update-lot.dto';
import type { WarehouseScope } from '../warehouses/warehouse-access.service';
import { dropSapLotIfUnused, sapLotNotAllowedMessage } from '../products/uses-sap-lot';

/**
 * Normaliza el código de lote para evitar duplicados por diferencias de
 * mayúsculas/minúsculas o espacios. Reglas WMS: trim + uppercase + colapsar
 * espacios internos. Ej: " l2444 " → "L2444", "L 2444" → "L 2444".
 */
export function normalizeLotCode(code: string): string {
  return (code ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

@Injectable()
export class LotsService {
  constructor(
    @InjectRepository(Lot)
    private readonly lotRepo: Repository<Lot>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Pallet)
    private readonly palletRepo: Repository<Pallet>,
  ) {}

  async create(dto: CreateLotDto) {
    const product = await this.productRepo.findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const lotCode = normalizeLotCode(dto.lotCode);
    if (!lotCode) throw new BadRequestException('El código de lote es obligatorio');

    const existing = await this.lotRepo.findOne({ where: { productId: dto.productId, lotCode } });
    if (existing) {
      throw new BadRequestException(`Ya existe el lote "${lotCode}" para este producto`);
    }

    // Alta manual de un lote: el usuario escribió ese lote SAP a propósito, así
    // que si el material no los usa se le dice, en vez de guardar a medias.
    if (dto.sapLot?.trim() && !product.usesSapLot) {
      throw new BadRequestException(sapLotNotAllowedMessage(product.code));
    }

    const lot = this.lotRepo.create({
      lotCode,
      productId: dto.productId,
      product,
      fechaVencimiento: dto.fechaVencimiento ?? null,
      fechaFabricacion: dto.fechaFabricacion ?? null,
      proveedor: dto.proveedor ?? null,
      sapLot: dto.sapLot ?? null,
      stockActual: 0,
    });

    return this.lotRepo.save(lot);
  }

  /**
   * Lotes visibles en el alcance.
   *
   * La identidad del lote sigue siendo global (producto + código): lo que se
   * acota es **dónde está** su mercadería. Dentro de un depósito, un lote solo
   * aparece si tiene pallets vivos ahí, y `stockActual` se informa como el
   * stock de ese depósito, no el total del lote en toda la operación.
   */
  async findAll(productId?: string, sapLot?: string, includePallets = false, scope: WarehouseScope = null) {
    const qb = this.lotRepo
      .createQueryBuilder('lot')
      .leftJoinAndSelect('lot.product', 'product')
      .orderBy('lot.fechaVencimiento', 'ASC');
    if (productId) qb.andWhere('lot.productId = :productId', { productId });
    if (sapLot) qb.andWhere('lot.sapLot = :sapLot', { sapLot });

    if (scope) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM pallets sp
          JOIN locations sl ON sl.id = sp."currentLocationId"
          WHERE sp."lotId" = lot.id
            AND sp.status NOT IN ('EXITED', 'EMPTY')
            AND sl."warehouseId" IN (:...scopeIds)
        )`,
        { scopeIds: scope },
      );
    }

    const lots = await qb.getMany();
    if (lots.length === 0) return [];

    // Conteos agregados de pallets por lote (siempre incluidos — son baratos)
    const lotIds = lots.map((l) => l.id);
    const countsQb = this.palletRepo
      .createQueryBuilder('p')
      .select('p."lotId"', 'lotId')
      .addSelect("COUNT(*) FILTER (WHERE p.status = 'AVAILABLE')", 'availableCount')
      .addSelect("COUNT(*) FILTER (WHERE p.status = 'EXITED')", 'exitedCount')
      .addSelect('COUNT(*)', 'totalCount')
      .addSelect("COALESCE(SUM(p.quantity) FILTER (WHERE p.status NOT IN ('EXITED','EMPTY')), 0)", 'scopedStock')
      .where('p."lotId" IN (:...lotIds)', { lotIds })
      .groupBy('p."lotId"');
    if (scope) {
      countsQb
        .innerJoin('locations', 'ploc', 'ploc.id = p."currentLocationId"')
        .andWhere('ploc."warehouseId" IN (:...scopeIds)', { scopeIds: scope });
    }
    const counts = await countsQb.getRawMany();

    const countsByLot = new Map(counts.map((c) => [c.lotId, c]));

    let palletsByLot: Map<string, Pallet[]> | null = null;
    if (includePallets) {
      const palletsQb = this.palletRepo
        .createQueryBuilder('p')
        .where('p."lotId" IN (:...lotIds)', { lotIds })
        .orderBy('p.code', 'ASC');
      if (scope) {
        palletsQb
          .innerJoin('locations', 'ploc', 'ploc.id = p."currentLocationId"')
          .andWhere('ploc."warehouseId" IN (:...scopeIds)', { scopeIds: scope });
      }
      const pallets = await palletsQb.getMany();
      palletsByLot = new Map();
      for (const p of pallets) {
        if (!palletsByLot.has(p.lotId)) palletsByLot.set(p.lotId, []);
        palletsByLot.get(p.lotId)!.push(p);
      }
    }

    return lots.map((lot) => {
      const c = countsByLot.get(lot.id);
      return {
        ...lot,
        // Con alcance acotado el stock mostrado es el del depósito, no el global.
        stockActual: scope ? Number(c?.scopedStock ?? 0) : lot.stockActual,
        availablePalletsCount: c ? Number(c.availableCount) : 0,
        exitedPalletsCount: c ? Number(c.exitedCount) : 0,
        totalPalletsCount: c ? Number(c.totalCount) : 0,
        ...(includePallets ? { pallets: palletsByLot?.get(lot.id) ?? [] } : {}),
      };
    });
  }

  /**
   * FEFO con pallets disponibles embebidos por lote.
   * `locationId`: si se especifica, solo incluye pallets de esa ubicación (para transferencias).
   *
   * **Acotado al depósito**: es lo que arma la pantalla de Salida, así que solo
   * puede ofrecer pallets del depósito activo. Si un producto tiene 5.000 en el
   * 01 y 10.000 en el 02, trabajando en el 01 se ven 5.000 — y una salida de
   * 7.000 falla por falta de stock aunque globalmente existan 15.000.
   */
  async findFefo(productId?: string, sapLot?: string, locationId?: string, scope: WarehouseScope = null) {
    const qb = this.lotRepo
      .createQueryBuilder('lot')
      .leftJoinAndSelect('lot.product', 'product')
      .andWhere('lot.stockActual > 0')
      .orderBy({ 'lot.fechaVencimiento': { order: 'ASC', nulls: 'NULLS LAST' } });
    if (productId) qb.andWhere('lot.productId = :productId', { productId });
    if (sapLot) qb.andWhere('lot.sapLot = :sapLot', { sapLot });
    const lots = await qb.getMany();

    if (lots.length === 0) return [];
    const lotIds = lots.map((l) => l.id);

    const palletsQb = this.palletRepo
      .createQueryBuilder('p')
      .where('p.lotId IN (:...lotIds)', { lotIds })
      .andWhere("p.status = 'AVAILABLE'")
      .orderBy('p.code', 'ASC');

    if (locationId) {
      palletsQb.andWhere('p.currentLocationId = :locationId', { locationId });
    }
    if (scope) {
      palletsQb
        .innerJoin('locations', 'ploc', 'ploc.id = p."currentLocationId"')
        .andWhere('ploc."warehouseId" IN (:...scopeIds)', { scopeIds: scope });
    }

    const pallets = await palletsQb.getMany();

    const palletsByLot = new Map<string, Pallet[]>();
    for (const p of pallets) {
      if (!palletsByLot.has(p.lotId)) palletsByLot.set(p.lotId, []);
      palletsByLot.get(p.lotId)!.push(p);
    }

    const result = lots.map((lot) => {
      const lotPallets = palletsByLot.get(lot.id) ?? [];
      return {
        ...lot,
        // Dentro de un depósito, el disponible del lote es el de sus pallets ahí.
        stockActual: scope
          ? lotPallets.reduce((sum, pallet) => sum + Number(pallet.quantity), 0)
          : lot.stockActual,
        pallets: lotPallets,
      };
    });

    // Con ubicación o depósito acotado, un lote sin pallets ahí no se ofrece.
    return locationId || scope ? result.filter((l) => l.pallets.length > 0) : result;
  }

  async findOne(id: string) {
    const lot = await this.lotRepo.findOne({ where: { id }, relations: ['product'] });
    if (!lot) throw new NotFoundException('Lote no encontrado');
    return lot;
  }

  async findOrCreate(
    productId: string,
    lotCode: string,
    fechaVencimiento?: string,
    proveedor?: string,
    fechaFabricacion?: string,
    sapLot?: string,
  ): Promise<Lot> {
    lotCode = normalizeLotCode(lotCode);
    // Camino automático: al material que no usa Lote SAP no se le escribe uno.
    sapLot = await dropSapLotIfUnused(this.lotRepo.manager, productId, sapLot);
    let lot = await this.lotRepo.findOne({ where: { productId, lotCode } });
    if (!lot) {
      lot = await this.lotRepo.save(this.lotRepo.create({
        lotCode, productId,
        fechaVencimiento: fechaVencimiento ?? null,
        fechaFabricacion: fechaFabricacion ?? null,
        proveedor: proveedor ?? null,
        sapLot: sapLot ?? null,
        stockActual: 0,
      }));
    } else {
      let changed = false;
      if (fechaVencimiento && !lot.fechaVencimiento) { lot.fechaVencimiento = fechaVencimiento; changed = true; }
      if (proveedor && !lot.proveedor) { lot.proveedor = proveedor; changed = true; }
      if (fechaFabricacion && !lot.fechaFabricacion) { lot.fechaFabricacion = fechaFabricacion; changed = true; }
      if (sapLot && !lot.sapLot) { lot.sapLot = sapLot; changed = true; }
      if (changed) lot = await this.lotRepo.save(lot);
    }
    return lot;
  }

  async update(id: string, dto: UpdateLotDto) {
    const lot = await this.findOne(id);
    // Asignar un lote SAP a un material que no los usa se rechaza. Limpiarlo o
    // dejarlo como está siempre se permite: el histórico es del lote, no del
    // material, y cambiar la configuración no lo borra.
    if (dto.sapLot?.trim() && !lot.product.usesSapLot) {
      throw new BadRequestException(sapLotNotAllowedMessage(lot.product.code));
    }
    Object.assign(lot, dto);
    if (dto.lotCode !== undefined) {
      const lotCode = normalizeLotCode(dto.lotCode);
      if (!lotCode) throw new BadRequestException('El código de lote es obligatorio');
      if (lotCode !== lot.lotCode) {
        const dup = await this.lotRepo.findOne({ where: { productId: lot.productId, lotCode } });
        if (dup && dup.id !== id) {
          throw new BadRequestException(`Ya existe el lote "${lotCode}" para este producto`);
        }
      }
      lot.lotCode = lotCode;
    }
    return this.lotRepo.save(lot);
  }

  /**
   * Baja de un lote.
   *
   * El DELETE físico sin control rompía la trazabilidad. Ni `movements.lotId` ni
   * `pallets.lotId` ni `movement_details.lotId` tienen clave foránea, así que la
   * base no impedía nada: borrar el lote dejaba esas filas apuntando al vacío y
   * el material despachado perdía el vínculo con el lote de proveedor que lo
   * originó — justo el dato que hace falta para responder un reclamo o un
   * retiro de mercadería.
   *
   * Mismo criterio que Materiales y Depósitos, y coherente con Pallets, donde la
   * eliminación directamente se deshabilitó:
   *
   *   1. Con stock vivo → se rechaza. Primero hay que despachar o ajustar.
   *   2. Con historia (pallets, movimientos o detalles) → se archiva, no se borra.
   *   3. Sólo un lote recién creado y sin usar se elimina de verdad.
   *
   * El stock se mira por dos vías —el contador `stockActual` del lote y la suma
   * real de sus pallets— porque pueden diverger (ver la reconciliación de más
   * abajo). Si cualquiera de las dos dice que hay mercadería, no se toca.
   */
  async remove(id: string) {
    const lot = await this.findOne(id);

    const [uso] = (await this.lotRepo.query(
      `SELECT
         (SELECT COUNT(*) FROM pallets WHERE "lotId" = $1)::int                AS "totalPallets",
         (SELECT COUNT(*) FROM pallets WHERE "lotId" = $1
            AND status NOT IN ('EXITED', 'EMPTY') AND quantity > 0)::int       AS "livePallets",
         (SELECT COALESCE(SUM(quantity), 0) FROM pallets WHERE "lotId" = $1
            AND status NOT IN ('EXITED', 'EMPTY'))::float8                     AS "liveQuantity",
         (SELECT COUNT(*) FROM movements WHERE "lotId" = $1)::int              AS "movements",
         (SELECT COUNT(*) FROM movement_details WHERE "lotId" = $1)::int       AS "details"`,
      [id],
    )) as Array<{
      totalPallets: number;
      livePallets: number;
      liveQuantity: number;
      movements: number;
      details: number;
    }>;

    const stockActual = Number(lot.stockActual) || 0;
    const enPallets = Number(uso.liveQuantity) || 0;

    if (!quantitiesEqual(stockActual, 0) || !quantitiesEqual(enPallets, 0) || uso.livePallets > 0) {
      const cantidad = quantitiesEqual(stockActual, 0) ? enPallets : stockActual;
      throw new BadRequestException(
        `No se puede eliminar el lote ${lot.lotCode}: tiene ${formatQuantity(cantidad)} en stock ` +
          `repartidas en ${uso.livePallets} palet(s). Despachá o ajustá el stock antes de darlo de baja.`,
      );
    }

    const conHistoria = uso.totalPallets > 0 || uso.movements > 0 || uso.details > 0;
    if (conHistoria) {
      lot.status = LOT_STATUS_ARCHIVED;
      await this.lotRepo.save(lot);
      return {
        deleted: true,
        deactivated: true,
        id: lot.id,
        reason:
          `El lote tiene ${uso.totalPallets} palet(s) y ${uso.movements + uso.details} registro(s) de movimiento: ` +
          `se archivó en lugar de eliminarse para preservar la trazabilidad.`,
      };
    }

    await this.lotRepo.remove(lot);
    return { deleted: true, deactivated: false, id };
  }

  /**
   * FIX 5 — Reconciliación de stockActual.
   * Recalcula lot.stockActual desde cero sumando las cantidades de pallets no despachados.
   * Útil para corregir derivas causadas por ediciones directas o bugs históricos.
   */
  async reconcileStock(id: string) {
    const lot = await this.findOne(id);
    const result = await this.palletRepo
      .createQueryBuilder('p')
      .select("COALESCE(SUM(p.quantity), 0)", 'total')
      .where('p."lotId" = :id', { id })
      .andWhere("p.status != 'EXITED'")
      .getRawOne();

    const real = roundQuantity(Number(result?.total ?? 0));
    const previous = lot.stockActual;

    // `quantitiesEqual` compara los enteros escalados, no los flotantes: con un
    // `!==` directo, un residuo de coma flotante (100.00000000001 vs 100) se
    // guardaba como si fuera una corrección real y ensuciaba el informe.
    if (!quantitiesEqual(real, previous)) {
      lot.stockActual = real;
      await this.lotRepo.save(lot);
    }

    return { lotId: id, lotCode: lot.lotCode, previous, reconciled: real, delta: quantityDelta(real, previous) };
  }

  /**
   * Reconcilia TODOS los lotes de un producto (o todos si no se especifica).
   * Devuelve sólo los lotes donde hubo corrección (delta !== 0).
   */
  async reconcileAllStocks(productId?: string) {
    const qb = this.lotRepo.createQueryBuilder('lot');
    if (productId) qb.andWhere('lot."productId" = :productId', { productId });
    const lots = await qb.getMany();

    const corrections: { lotId: string; lotCode: string; previous: number; reconciled: number; delta: number }[] = [];
    for (const lot of lots) {
      const result = await this.palletRepo
        .createQueryBuilder('p')
        .select("COALESCE(SUM(p.quantity), 0)", 'total')
        .where('p."lotId" = :id', { id: lot.id })
        .andWhere("p.status != 'EXITED'")
        .getRawOne();

      const real = roundQuantity(Number(result?.total ?? 0));
      // Igual que en `reconcileStock`: se comparan los enteros escalados, no los
      // flotantes. Con `!==` un residuo de coma flotante contaba como corrección
      // y llenaba el informe de diferencias que no existen.
      if (!quantitiesEqual(real, lot.stockActual)) {
        corrections.push({
          lotId: lot.id, lotCode: lot.lotCode, previous: lot.stockActual,
          reconciled: real, delta: quantityDelta(real, lot.stockActual),
        });
        lot.stockActual = real;
        await this.lotRepo.save(lot);
      }
    }
    return { corrected: corrections.length, corrections };
  }
}
