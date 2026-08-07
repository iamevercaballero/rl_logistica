import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, In, Not } from 'typeorm';
import { Pila } from './entities/pila.entity';
import { Location } from '../locations/entities/location.entity';
import { Pallet } from '../pallets/entities/pallet.entity';
import { Product } from '../products/entities/product.entity';

export type PileMixingPolicy = 'SAME_PRODUCT' | 'SAME_LOT';

export interface PlacementItem {
  /** Clave arbitraria del caller (ej. índice del palletItem) para mapear el resultado de vuelta. */
  key: string;
  productId: string;
  lotId?: string | null;
}

export interface PlacementPileResult {
  pilaId: string;
  isNew: boolean;
  sequence: number;
  productId: string;
  lotId: string | null;
  items: { key: string; stackPosition: number }[];
}

export interface PlacementPlan {
  locationId: string;
  locationCode: string;
  piles: PlacementPileResult[];
  basesUsed: number;
  basesTotal: number | null;
  basesFree: number | null;
}

/** Working state interno del algoritmo — piles con contadores mutables. */
interface WorkingPile extends PlacementPileResult {
  level: number;
  maxLevel: number;
  /** false para pilas CLOSED: ocupan base pero ya no admiten pallets encima. */
  stackable: boolean;
}

/**
 * Arma y (opcionalmente) confirma la agrupación de pallets en pilas dentro de
 * un Sector-Subsector. `feasibility()` es la parte reutilizada por
 * `LocationsService.recommend()`; `placePallets()` es el motor de colocación
 * real, usado tanto para la vista previa (`commit:false`, sin escribir nada)
 * como para la confirmación real (`commit:true`, dentro de la transacción de
 * `MovementsService.createInTransaction`).
 */
@Injectable()
export class PilasService {
  /**
   * Factibilidad (ubicación, producto) — independiente de cuánto haya
   * ocupado ahora mismo. Temperatura/peso/altura exactos de `recommend()`;
   * `allowsStacking` acá se interpreta a nivel Sector-Subsector completo (si
   * la ubicación no permite apilar, cada pallet necesita su propia base,
   * pero eso no vuelve infactible al sector — solo cambia cuántas bases va a
   * usar, chequeo que hace `placePallets` con la capacidad real).
   */
  feasibility(location: Location, product: Product): { feasible: boolean; blockers: string[] } {
    const blockers: string[] = [];

    const locTemp = location.temperatureZone ?? 'AMBIENT';
    const pTemp = product.temperatureZone ?? 'AMBIENT';
    if (locTemp !== pTemp) blockers.push(`temperatura ${locTemp} ≠ ${pTemp}`);

    const maxW = location.maxWeightKg ?? null;
    const pWeight = product.weightKg ?? null;
    if (maxW != null && pWeight != null && pWeight > maxW) blockers.push('excede peso máximo');

    const maxH = location.maxHeightCm ?? null;
    const pHeight = product.heightCm ?? null;
    if (maxH != null && pHeight != null && pHeight > maxH) blockers.push('excede altura máxima');

    return { feasible: blockers.length === 0, blockers };
  }

  /**
   * Arma (y, si `commit`, persiste) el plan de pilas para un lote de pallets
   * que entran a una ubicación. First-fit: por cada pallet busca una pila
   * OPEN compatible (mismo producto, mismo lote si la política lo exige, no
   * llena); si no hay, abre una nueva, cerrando contra `capacityBases`.
   *
   * `commit:true` DEBE correr dentro de una transacción existente — toma lock
   * pesimista sobre las pilas abiertas de la ubicación para que dos entradas
   * simultáneas al mismo sector no decidan ambas que la misma pila tiene
   * lugar.
   */
  async placePallets(
    manager: EntityManager,
    locationId: string,
    items: PlacementItem[],
    options: { commit: boolean; pileMixingPolicy?: PileMixingPolicy },
  ): Promise<PlacementPlan> {
    if (items.length === 0) {
      throw new BadRequestException('No hay pallets para ubicar.');
    }

    const location = await manager.findOne(Location, { where: { id: locationId } });
    if (!location) throw new NotFoundException('Ubicación no encontrada.');

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await manager.getRepository(Product).find({ where: { id: In(productIds) } });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const productId of productIds) {
      const product = productMap.get(productId);
      if (!product) throw new BadRequestException(`Producto ${productId} no encontrado.`);
      const { feasible, blockers } = this.feasibility(location, product);
      if (!feasible) {
        throw new BadRequestException(`${location.code} no admite ${product.code}: ${blockers.join(', ')}.`);
      }
    }

    const pilaRepo = manager.getRepository(Pila);
    // Se cargan OPEN **y** CLOSED: una pila llena sigue ocupando su base física
    // aunque ya no admita más niveles. Contar solo las OPEN dejaría meter pallets
    // por encima de `capacityBases`. Las EMPTY sí se excluyen — su base se liberó.
    const existingPilas = options.commit
      ? await pilaRepo.find({ where: { locationId, status: In(['OPEN', 'CLOSED']) }, lock: { mode: 'pessimistic_write' } })
      : await pilaRepo.find({ where: { locationId, status: In(['OPEN', 'CLOSED']) } });

    // Productos de pilas ya existentes que no aparecen en `items` (para poder leer su maxStackLevel).
    const existingProductIds = existingPilas.map((p) => p.productId).filter((id): id is string => !!id);
    if (existingProductIds.some((id) => !productMap.has(id))) {
      const extra = await manager
        .getRepository(Product)
        .find({ where: { id: In(existingProductIds.filter((id) => !productMap.has(id))) } });
      for (const p of extra) productMap.set(p.id, p);
    }

    const levelsByPila = new Map<string, number>();
    if (existingPilas.length > 0) {
      const counts = await manager
        .getRepository(Pallet)
        .createQueryBuilder('p')
        .select('p."pilaId"', 'pilaId')
        .addSelect('COUNT(*)', 'n')
        .where('p."pilaId" IN (:...ids)', { ids: existingPilas.map((p) => p.id) })
        .andWhere(`p.status NOT IN ('EXITED', 'EMPTY')`)
        .groupBy('p."pilaId"')
        .getRawMany<{ pilaId: string; n: string }>();
      for (const c of counts) levelsByPila.set(c.pilaId, Number(c.n));
    }

    const maxSeqRow = await pilaRepo
      .createQueryBuilder('p')
      .select('MAX(p.sequence)', 'max')
      .where('p."locationId" = :locationId', { locationId })
      .getRawOne<{ max: number | string | null }>();
    let nextSequence = Number(maxSeqRow?.max ?? 0) + 1;

    const maxLevelFor = (productId: string, pilaOverride?: number | null) =>
      pilaOverride ?? location.defaultMaxStackLevel ?? productMap.get(productId)?.maxStackLevel ?? Infinity;

    const working: WorkingPile[] = existingPilas.map((p) => ({
      pilaId: p.id,
      isNew: false,
      sequence: p.sequence,
      productId: p.productId!,
      lotId: p.lotId ?? null,
      items: [],
      level: levelsByPila.get(p.id) ?? 0,
      maxLevel: maxLevelFor(p.productId!, p.maxLevels),
      // Una pila CLOSED ocupa base pero ya no recibe pallets encima.
      stackable: p.status === 'OPEN',
    }));

    const policy = options.pileMixingPolicy ?? 'SAME_PRODUCT';

    for (const item of items) {
      const product = productMap.get(item.productId)!;
      const itemLotId = item.lotId ?? null;

      let target: WorkingPile | undefined;
      if (product.stackable && location.allowsStacking) {
        target = working.find(
          (w) =>
            w.stackable &&
            w.productId === item.productId &&
            (policy !== 'SAME_LOT' || w.lotId === itemLotId) &&
            w.level < w.maxLevel,
        );
      }

      if (!target) {
        // `working` ya incluye las pilas CLOSED existentes, así que esto cuenta
        // todas las bases realmente ocupadas, no solo las que reciben pallets acá.
        const basesUsed = working.length;
        if (location.capacityBases != null && basesUsed >= location.capacityBases) {
          throw new BadRequestException(
            `${location.code} no tiene bases libres (${basesUsed}/${location.capacityBases} ocupadas). ` +
            `Elegí otro sector o liberá espacio antes de continuar.`,
          );
        }
        target = {
          pilaId: '',
          isNew: true,
          sequence: nextSequence++,
          productId: item.productId,
          lotId: itemLotId,
          items: [],
          level: 0,
          maxLevel: maxLevelFor(item.productId, null),
          stackable: true,
        };
        working.push(target);
      }

      target.level += 1;
      target.items.push({ key: item.key, stackPosition: target.level });
    }

    if (options.commit) {
      for (const w of working) {
        if (w.items.length === 0) continue;
        if (w.isNew) {
          const created = await this.createPilaWithRetry(manager, {
            locationId, sequence: w.sequence, productId: w.productId, lotId: w.lotId,
            status: w.level >= w.maxLevel ? 'CLOSED' : 'OPEN',
          });
          w.pilaId = created.id;
        } else {
          await pilaRepo.update(w.pilaId, {
            status: w.level >= w.maxLevel ? 'CLOSED' : 'OPEN',
            updatedAt: new Date(),
          });
        }
      }
    }

    // Ocupación total del sector una vez aplicada la operación (existentes +
    // nuevas), no solo las pilas que este movimiento toca — es lo que se le
    // muestra al operario como "X/Y bases ocupadas".
    const basesUsed = working.length;
    return {
      locationId,
      locationCode: location.code,
      piles: working
        .filter((w) => w.items.length > 0)
        .map(({ pilaId, isNew, sequence, productId, lotId, items: pileItems }) => ({
          pilaId, isNew, sequence, productId, lotId, items: pileItems,
        })),
      basesUsed,
      basesTotal: location.capacityBases ?? null,
      basesFree: location.capacityBases != null ? Math.max(0, location.capacityBases - basesUsed) : null,
    };
  }

  /**
   * Libera la base **solo si la pila quedó sin pallets vivos**. Si todavía
   * quedan pallets apilados, la base sigue ocupada — sacar un pallet de una
   * pila de tres no libera el lugar de piso.
   *
   * La fila no se borra: se marca EMPTY para no romper las referencias de
   * auditoría (`movement_details.pilaId`) ni reciclar el número de secuencia.
   * Todas las consultas de ocupación descuentan las EMPTY.
   */
  async releaseIfEmpty(manager: EntityManager, pilaId?: string | null): Promise<void> {
    if (!pilaId) return;

    const remaining = await manager
      .getRepository(Pallet)
      .count({ where: { pilaId, status: Not(In(['EXITED', 'EMPTY'])) } });
    if (remaining > 0) return;

    await manager.getRepository(Pila).update(pilaId, {
      status: 'EMPTY',
      productId: null,
      lotId: null,
      closedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Reintenta una vez ante colisión de `uq_pila_location_sequence` (23505) —
   * dos entradas simultáneas al mismo sector calculando el mismo `sequence`
   * siguiente. Mismo patrón que `MovementsService.withUniqueRetry`.
   */
  private async createPilaWithRetry(
    manager: EntityManager,
    data: { locationId: string; sequence: number; productId: string; lotId: string | null; status: string },
  ): Promise<Pila> {
    const pilaRepo = manager.getRepository(Pila);
    try {
      return await pilaRepo.save(pilaRepo.create(data));
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== '23505') throw error;
      const maxSeqRow = await pilaRepo
        .createQueryBuilder('p')
        .select('MAX(p.sequence)', 'max')
        .where('p."locationId" = :locationId', { locationId: data.locationId })
        .getRawOne<{ max: number | string | null }>();
      const retrySequence = Number(maxSeqRow?.max ?? 0) + 1;
      return pilaRepo.save(pilaRepo.create({ ...data, sequence: retrySequence }));
    }
  }
}
