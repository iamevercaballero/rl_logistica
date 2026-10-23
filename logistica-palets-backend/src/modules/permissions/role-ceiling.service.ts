import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ROLES_KEY } from '../auth/roles/roles.decorator';
import { PERMISSION_KEY, type RequiredPermission } from './decorators/require-permission.decorator';
import type { UserRole } from '../users/entities/user.entity';
import type { PermissionAction } from './entities/role-permission.entity';

export const USER_ROLES: readonly UserRole[] = ['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'];

/** module → acciones que ese rol puede llegar a ejercer. Mismo formato que `EffectivePermissions`. */
export type ReachablePermissions = Record<string, PermissionAction[]>;

/**
 * Techo de cada rol: qué combinaciones `module:action` puede llegar a ejercer,
 * mirando los `@Roles()` reales de las rutas.
 *
 * Existe porque los dos guards se suman y el grueso manda: `RolesGuard` corre
 * antes que `PermissionGuard`, así que un permiso otorgado a mano sobre una ruta
 * cuyo `@Roles()` no incluye al rol no hace nada. La pestaña Permisos ofrecía
 * esos tildes igual —el caso que se encontró en producción fue "Lotes → Editar"
 * a un operador: el permiso se guardaba, `/auth/me` lo devolvía, y editar
 * seguía dando 403 sin explicación—.
 *
 * El techo se deriva de los decoradores en el arranque, no de una tabla escrita
 * a mano: una lista paralela es justamente lo que se desincronizó. Si mañana una
 * ruta cambia su `@Roles()`, esto cambia con ella y la interfaz se actualiza
 * sola.
 *
 * Un permiso cuenta como alcanzable si **alguna** ruta que lo pide admite el
 * rol. Eso es a propósito: varias rutas comparten permiso y algunas son
 * variantes masivas o de mantenimiento más angostas (`lots/reconcile-all`,
 * `locations/generate`). Que la variante angosta siga cerrada no hace que el
 * tilde sea inútil — editar un lote de a uno sí funciona.
 */
@Injectable()
export class RoleCeilingService implements OnModuleInit {
  private readonly logger = new Logger(RoleCeilingService.name);
  private techo = new Map<UserRole, Map<string, Set<PermissionAction>>>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onModuleInit(): void {
    this.techo = new Map(USER_ROLES.map((r) => [r, new Map<string, Set<PermissionAction>>()]));

    let rutas = 0;
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const rolesDeClase = this.leerRoles(wrapper.metatype as object | undefined);

      for (const nombre of this.scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[nombre];
        if (typeof handler !== 'function') continue;

        const permiso = Reflect.getMetadata(PERMISSION_KEY, handler) as RequiredPermission | undefined;
        if (!permiso) continue;

        // Sin `@Roles()` en ningún nivel la ruta no filtra por rol: la alcanzan todos.
        const alcanzan = this.leerRoles(handler) ?? rolesDeClase ?? USER_ROLES;
        for (const rol of alcanzan) {
          const porModulo = this.techo.get(rol);
          if (!porModulo) continue; // un `@Roles()` con un rol que ya no existe
          const acciones = porModulo.get(permiso.module) ?? new Set<PermissionAction>();
          acciones.add(permiso.action);
          porModulo.set(permiso.module, acciones);
        }
        rutas++;
      }
    }

    this.logger.log(`Techo de roles derivado de ${rutas} rutas con @RequirePermission.`);
  }

  private leerRoles(target: object | undefined): readonly UserRole[] | undefined {
    if (!target) return undefined;
    const roles = Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined;
    if (!roles || roles.length === 0) return undefined;
    return roles.filter((r): r is UserRole => (USER_ROLES as readonly string[]).includes(r));
  }

  /** Lo que ese rol puede llegar a ejercer, para que la interfaz no ofrezca tildes muertos. */
  forRole(role: UserRole): ReachablePermissions {
    const salida: ReachablePermissions = {};
    for (const [module, acciones] of this.techo.get(role) ?? []) {
      salida[module] = [...acciones];
    }
    return salida;
  }

  /** ¿Otorgar este permiso a alguien con este rol sirve de algo? */
  isReachable(role: UserRole, module: string, action: PermissionAction): boolean {
    return !!this.techo.get(role)?.get(module)?.has(action);
  }
}
