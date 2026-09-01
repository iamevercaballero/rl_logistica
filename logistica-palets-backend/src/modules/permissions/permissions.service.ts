import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolePermission, PermissionAction } from './entities/role-permission.entity';
import { UserPermission, PermissionEffect } from './entities/user-permission.entity';
import type { UserRole } from '../users/entities/user.entity';
import { CacheService } from '../cache/cache.service';

/**
 * Vida de los permisos efectivos en caché (RL-M-17).
 *
 * Cada petición autenticada hacía tres consultas: la revalidación del usuario en
 * `jwt.strategy` —que es una decisión de seguridad correcta y no se toca— más
 * las dos de `getEffectivePermissions`. Esas dos son configuración, no
 * revalidación, así que se cachean.
 *
 * Un minuto es corto a propósito. Los cambios de permisos invalidan la entrada
 * de inmediato; el TTL es la red por si alguna vez se agrega una ruta de
 * escritura que se olvide de invalidar. Con un TTL largo, ese olvido tardaría
 * horas en notarse.
 */
const TTL_PERMISOS_SEGUNDOS = 60;

/** module → acciones permitidas. Ausencia de módulo = sin permisos ahí. */
export type EffectivePermissions = Record<string, PermissionAction[]>;

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly roleRepo: Repository<RolePermission>,
    @InjectRepository(UserPermission)
    private readonly userPermRepo: Repository<UserPermission>,
    private readonly cache: CacheService,
  ) {}

  /** Clave de los permisos efectivos. Incluye el rol: cambiarlo cambia la clave. */
  private static claveEfectivos(userId: string, role: UserRole): string {
    return `perm:eff:${userId}:${role}`;
  }

  /**
   * Borra los permisos cacheados de un usuario, en todos sus roles.
   *
   * Se llama en cada camino que modifica sus overrides. El patrón cubre los
   * cuatro roles sin tener que saber cuál tiene puesto ahora.
   */
  private async invalidar(userId: string): Promise<void> {
    await this.cache.delPattern(`perm:eff:${userId}:*`);
  }

  /** Plantilla del rol — lo que tendría un usuario sin overrides. */
  async getRolePermissions(role: UserRole): Promise<EffectivePermissions> {
    const rows = await this.roleRepo.find({ where: { role, allowed: true } });
    const map: EffectivePermissions = {};
    for (const row of rows) {
      (map[row.module] ??= []).push(row.action);
    }
    return map;
  }

  /** Overrides puntuales del usuario, tal cual están guardados. */
  getUserOverrides(userId: string): Promise<UserPermission[]> {
    return this.userPermRepo.find({ where: { userId } });
  }

  /**
   * Permisos reales de un usuario: la plantilla de su rol con sus overrides
   * aplicados encima. `DENY` saca una acción aunque el rol la diera; `ALLOW`
   * la suma aunque el rol no la diera. Nunca al revés (el rol no vuelve a
   * agregar algo que un DENY sacó): el override manda siempre.
   */
  async getEffectivePermissions(userId: string, role: UserRole): Promise<EffectivePermissions> {
    // Lo que se cachea es el resultado ya combinado, no las entidades: es un
    // objeto plano (`Record<string, string[]>`), así que el viaje por JSON no
    // le cambia la forma. Cachear `getUserOverrides` habría sido peor —esas
    // filas tienen columnas `Date` y se devuelven tal cual en
    // `GET /users/:id/permissions`, donde pasarían a ser cadenas—.
    const clave = PermissionsService.claveEfectivos(userId, role);
    const cacheado = await this.cache.get<EffectivePermissions>(clave);
    if (cacheado) return cacheado;

    const base = await this.getRolePermissions(role);
    const overrides = await this.getUserOverrides(userId);

    const effective: EffectivePermissions = {};
    for (const [module, actions] of Object.entries(base)) effective[module] = [...actions];

    for (const o of overrides) {
      const set = new Set(effective[o.module] ?? []);
      if (o.effect === 'ALLOW') set.add(o.action);
      else set.delete(o.action);
      effective[o.module] = [...set];
    }

    // Un módulo que quedó en 0 acciones no se lista — evita "movements: []"
    // en /auth/me, que se lee como "algo raro pasó" en vez de "nada acá".
    for (const module of Object.keys(effective)) {
      if (effective[module].length === 0) delete effective[module];
    }

    await this.cache.set(clave, effective, TTL_PERMISOS_SEGUNDOS);
    return effective;
  }

  async hasPermission(userId: string, role: UserRole, module: string, action: PermissionAction): Promise<boolean> {
    const effective = await this.getEffectivePermissions(userId, role);
    return !!effective[module]?.includes(action);
  }

  async assertPermission(userId: string, role: UserRole, module: string, action: PermissionAction): Promise<void> {
    if (!(await this.hasPermission(userId, role, module, action))) {
      throw new ForbiddenException(`No tenés permiso para "${action}" en "${module}".`);
    }
  }

  /**
   * ¿Puede `actor` otorgar/quitar este permiso a un usuario con `targetRole`?
   * ADMIN no tiene techo. MANAGER no puede tocar permisos de ADMIN/MANAGER,
   * ni otorgar algo que él mismo no tiene — un MANAGER sin `users:remove`
   * (por ejemplo) no puede dárselo a otro MANAGER... salvo que no pueda tocar
   * MANAGER de entrada, que es justamente la primera regla.
   */
  async assertCanManagePermission(
    actor: { userId: string; role: UserRole },
    targetRole: UserRole,
    module: string,
    action: PermissionAction,
  ): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (actor.role !== 'MANAGER') {
      throw new ForbiddenException('No tenés permiso para administrar permisos de otros usuarios.');
    }
    if (targetRole === 'ADMIN' || targetRole === 'MANAGER') {
      throw new ForbiddenException('Un MANAGER no puede modificar permisos de un ADMIN o de otro MANAGER.');
    }
    if (!(await this.hasPermission(actor.userId, actor.role, module, action))) {
      throw new ForbiddenException('No podés otorgar un permiso que vos mismo no tenés.');
    }
  }

  async setUserPermission(
    targetUserId: string,
    module: string,
    action: PermissionAction,
    effect: PermissionEffect,
  ): Promise<UserPermission> {
    let row = await this.userPermRepo.findOne({ where: { userId: targetUserId, module, action } });
    if (row) {
      row.effect = effect;
    } else {
      row = this.userPermRepo.create({ userId: targetUserId, module, action, effect });
    }
    const guardado = await this.userPermRepo.save(row);
    await this.invalidar(targetUserId);
    return guardado;
  }

  async removeUserPermission(targetUserId: string, module: string, action: PermissionAction): Promise<void> {
    await this.userPermRepo.delete({ userId: targetUserId, module, action });
    await this.invalidar(targetUserId);
  }

  /** "Restaurar permisos del rol": borra todos los overrides del usuario. */
  async restoreRoleDefaults(targetUserId: string): Promise<void> {
    await this.userPermRepo.delete({ userId: targetUserId });
    await this.invalidar(targetUserId);
  }
}
