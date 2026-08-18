import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { UserWarehouse } from './entities/user-warehouse.entity';
import type { UserRole } from '../users/entities/user.entity';

/** Identidad mínima que necesita cualquier chequeo de acceso. */
export type AccessUser = { userId: string; role: UserRole | string };

/**
 * Política de alcance por rol — **el único lugar** donde se decide si un rol
 * ve todos los depósitos o solo los asignados.
 *
 * Cambiar MANAGER a asignación explícita en el futuro es cambiar `true` por
 * `false` acá: el resto de la aplicación ya consulta a este servicio y no
 * tiene condicionales `if (role === 'ADMIN')` propios.
 *
 * AUDITOR conserva el alcance de lectura global que ya tenía (no se le amplían
 * permisos: sigue sin poder operar, eso lo decide RolesGuard).
 */
const GLOBAL_SCOPE_ROLES: Record<string, boolean> = {
  ADMIN: true,
  MANAGER: true,
  AUDITOR: true,
  OPERATOR: false,
};

/** Entidades desde las que se puede derivar el depósito real de una operación. */
export type WarehouseSourceEntity = 'location' | 'pallet' | 'lot' | 'movement' | 'document';

/**
 * Alcance de depósitos de una consulta: lista de ids permitidos, o `null` para
 * "sin filtro" (usuario con alcance global que no eligió un depósito concreto).
 * Lo produce siempre `resolveQueryScope`, nunca el cliente.
 */
export type WarehouseScope = string[] | null;

@Injectable()
export class WarehouseAccessService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(UserWarehouse)
    private readonly assignmentRepo: Repository<UserWarehouse>,
    private readonly dataSource: DataSource,
  ) {}

  /** ¿El rol ve todos los depósitos por política, sin necesitar asignaciones? */
  hasGlobalScope(role: string | undefined | null): boolean {
    return GLOBAL_SCOPE_ROLES[role ?? ''] === true;
  }

  /**
   * Ids de depósitos que el usuario puede usar. `null` = todos (alcance global).
   * Se devuelve `null` en vez de la lista completa para que los callers puedan
   * omitir el filtro en vez de armar un `IN (...)` con todos los depósitos.
   */
  async getAllowedWarehouseIds(user: AccessUser): Promise<string[] | null> {
    if (this.hasGlobalScope(user.role)) return null;

    const rows = await this.assignmentRepo.find({
      where: { userId: user.userId },
      select: { warehouseId: true },
    });
    return rows.map((row) => row.warehouseId);
  }

  /**
   * Depósitos concretos que el usuario puede seleccionar, ya filtrados por
   * activos y ordenados por código documental (01, 02, ...) para que el
   * selector del frontend tenga un orden estable.
   */
  async getAllowedWarehouses(user: AccessUser): Promise<Warehouse[]> {
    const allowedIds = await this.getAllowedWarehouseIds(user);
    if (allowedIds !== null && allowedIds.length === 0) return [];

    const warehouses = await this.warehouseRepo.find({
      where: allowedIds === null ? { active: true } : { active: true, id: In(allowedIds) },
    });

    return warehouses.sort((a, b) =>
      (a.documentCode ?? '￿').localeCompare(b.documentCode ?? '￿') ||
      a.name.localeCompare(b.name, 'es'),
    );
  }

  /**
   * Valida que el usuario pueda operar/consultar ese depósito.
   * Lanza 403 si no tiene acceso — nunca devuelve un booleano silencioso, para
   * que sea imposible olvidarse de chequear el resultado.
   */
  async assertWarehouseAccess(user: AccessUser, warehouseId: string): Promise<void> {
    if (!warehouseId) {
      throw new BadRequestException('Falta el depósito de la operación');
    }
    if (this.hasGlobalScope(user.role)) return;

    const assignment = await this.assignmentRepo.findOne({
      where: { userId: user.userId, warehouseId },
    });
    if (!assignment) {
      throw new ForbiddenException('No tenés acceso a este depósito.');
    }
  }

  /**
   * Igual que `assertWarehouseAccess`, pero además exige que el depósito esté
   * activo. Se usa antes de **escribir** (entradas, salidas, ajustes): un
   * depósito dado de baja mientras el usuario tenía la sesión abierta no debe
   * seguir aceptando operaciones nuevas, aunque sí se pueda consultar historia.
   */
  async assertWritableWarehouse(user: AccessUser, warehouseId: string): Promise<Warehouse> {
    await this.assertWarehouseAccess(user, warehouseId);

    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new NotFoundException('El depósito no existe');
    if (!warehouse.active) {
      throw new BadRequestException(
        `El depósito ${warehouse.name} está inactivo: no admite nuevas operaciones.`,
      );
    }
    return warehouse;
  }

  /**
   * Resuelve el depósito con el que debe trabajar una consulta.
   *
   * - Si el cliente pide uno explícito, se valida el acceso y se usa ese.
   * - Si no pide ninguno y el usuario tiene alcance global, devuelve `null`
   *   (sin filtro: es el caso de una vista administrativa de todos los depósitos).
   * - Si no pide ninguno y el usuario tiene alcance acotado, devuelve **sus**
   *   depósitos, para que nunca vea datos de otros por omitir el parámetro.
   */
  async resolveQueryScope(
    user: AccessUser,
    requestedWarehouseId?: string | null,
  ): Promise<{ warehouseId: string | null; warehouseIds: string[] | null }> {
    if (requestedWarehouseId) {
      await this.assertWarehouseAccess(user, requestedWarehouseId);
      return { warehouseId: requestedWarehouseId, warehouseIds: [requestedWarehouseId] };
    }

    const allowedIds = await this.getAllowedWarehouseIds(user);
    if (allowedIds === null) return { warehouseId: null, warehouseIds: null };
    if (allowedIds.length === 0) {
      throw new ForbiddenException('No tenés ningún depósito asignado. Pedí acceso a un administrador.');
    }
    return {
      warehouseId: allowedIds.length === 1 ? allowedIds[0] : null,
      warehouseIds: allowedIds,
    };
  }

  /**
   * Depósito real de una entidad de inventario, leído de la base.
   *
   * Es la contraparte de "no confiar en el `warehouseId` que manda el cliente":
   * cuando el depósito se puede derivar del palet/ubicación/lote/movimiento, se
   * deriva y se valida contra eso. Resuelve además el caso de un palet movido
   * concurrentemente: siempre lee la ubicación **actual**, no la que creía el
   * cliente al abrir el formulario.
   *
   * Devuelve `null` cuando la entidad existe pero no tiene depósito determinable
   * (ej. palet sin ubicación); el caller decide si eso es un error.
   */
  async resolveEntityWarehouseId(
    entity: WarehouseSourceEntity,
    id: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const runner = manager ?? this.dataSource.manager;

    const sql: Record<WarehouseSourceEntity, string> = {
      location: `SELECT "warehouseId" AS id FROM locations WHERE id = $1`,
      pallet: `
        SELECT loc."warehouseId" AS id
        FROM pallets p
        LEFT JOIN locations loc ON loc.id = p."currentLocationId"
        WHERE p.id = $1`,
      // Un lote puede tener stock en más de un depósito: solo se considera
      // determinable si todo su stock vivo está en uno solo.
      lot: `
        SELECT MIN(loc."warehouseId"::text)::uuid AS id
        FROM pallets p
        JOIN locations loc ON loc.id = p."currentLocationId"
        WHERE p."lotId" = $1 AND p.status NOT IN ('EXITED', 'EMPTY')
        HAVING COUNT(DISTINCT loc."warehouseId") = 1`,
      movement: `
        SELECT COALESCE(m."warehouseId", m."toWarehouseId", m."fromWarehouseId") AS id
        FROM movements m WHERE m.id = $1`,
      document: `SELECT "warehouseId" AS id FROM logistics_documents WHERE id = $1`,
    };

    const rows = await runner.query<Array<{ id: string | null }>>(sql[entity], [id]);
    return rows[0]?.id ?? null;
  }

  /**
   * Valida el acceso al depósito **real** de una entidad, resolviéndolo primero
   * desde la base. Si el depósito no se puede determinar se rechaza en vez de
   * dejar pasar la operación sin control.
   */
  async assertEntityAccess(
    user: AccessUser,
    entity: WarehouseSourceEntity,
    id: string,
    manager?: EntityManager,
  ): Promise<string> {
    const warehouseId = await this.resolveEntityWarehouseId(entity, id, manager);
    if (!warehouseId) {
      throw new BadRequestException(
        'No se pudo determinar el depósito de la operación. Verificá que la ubicación/palet siga vigente.',
      );
    }
    await this.assertWarehouseAccess(user, warehouseId);
    return warehouseId;
  }

  /** Asignaciones actuales de un usuario (para el módulo de usuarios). */
  async listAssignments(userId: string): Promise<string[]> {
    const rows = await this.assignmentRepo.find({ where: { userId }, select: { warehouseId: true } });
    return rows.map((row) => row.warehouseId);
  }

  /** Reemplaza las asignaciones de un usuario por el conjunto indicado. */
  async setAssignments(userId: string, warehouseIds: string[]): Promise<string[]> {
    const unique = [...new Set(warehouseIds)];

    if (unique.length > 0) {
      const existing = await this.warehouseRepo.find({ where: { id: In(unique) }, select: { id: true } });
      if (existing.length !== unique.length) {
        throw new BadRequestException('Uno o más depósitos indicados no existen');
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserWarehouse, { userId });
      if (unique.length > 0) {
        await manager.insert(
          UserWarehouse,
          unique.map((warehouseId) => ({ userId, warehouseId })),
        );
      }
    });

    return unique;
  }
}
