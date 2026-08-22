import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolePermission, PermissionAction } from './entities/role-permission.entity';
import { UserPermission, PermissionEffect } from './entities/user-permission.entity';
import type { UserRole } from '../users/entities/user.entity';

/** module → acciones permitidas. Ausencia de módulo = sin permisos ahí. */
export type EffectivePermissions = Record<string, PermissionAction[]>;

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly roleRepo: Repository<RolePermission>,
    @InjectRepository(UserPermission)
    private readonly userPermRepo: Repository<UserPermission>,
  ) {}

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
    return this.userPermRepo.save(row);
  }

  async removeUserPermission(targetUserId: string, module: string, action: PermissionAction): Promise<void> {
    await this.userPermRepo.delete({ userId: targetUserId, module, action });
  }

  /** "Restaurar permisos del rol": borra todos los overrides del usuario. */
  async restoreRoleDefaults(targetUserId: string): Promise<void> {
    await this.userPermRepo.delete({ userId: targetUserId });
  }
}
