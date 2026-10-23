/**
 * El techo de cada rol se deriva de los decoradores, no de una lista a mano.
 *
 * El bug que motiva esto: `RolesGuard` corre antes que `PermissionGuard`, así
 * que un permiso otorgado sobre una ruta cuyo `@Roles()` no incluye al rol no
 * hace nada. La pestaña Permisos ofrecía esos tildes igual — se le dio "Lotes →
 * Editar" a un operador, `/auth/me` lo devolvía, y editar seguía dando 403.
 *
 * No necesita base de datos: se le pasan controllers de mentira y se verifica
 * qué techo sale.
 */
import { MetadataScanner } from '@nestjs/core';
import { RoleCeilingService } from '../src/modules/permissions/role-ceiling.service';
import { Roles } from '../src/modules/auth/roles/roles.decorator';
import { RequirePermission } from '../src/modules/permissions/decorators/require-permission.decorator';

/** `DiscoveryService` de mentira: devuelve los controllers que le pasemos. */
function discoveryCon(...clases: Array<new () => object>) {
  return {
    getControllers: () => clases.map((Clase) => ({ instance: new Clase(), metatype: Clase })),
  } as never;
}

function servicioCon(...clases: Array<new () => object>) {
  const svc = new RoleCeilingService(discoveryCon(...clases), new MetadataScanner());
  svc.onModuleInit();
  return svc;
}

describe('RoleCeilingService', () => {
  it('un permiso sobre una ruta ADMIN/MANAGER no es alcanzable para OPERATOR', () => {
    class LotesController {
      @Roles('ADMIN', 'MANAGER')
      @RequirePermission('lots', 'update')
      editar() {}
    }

    const svc = servicioCon(LotesController);
    expect(svc.isReachable('MANAGER', 'lots', 'update')).toBe(true);
    expect(svc.isReachable('OPERATOR', 'lots', 'update')).toBe(false);
    expect(svc.forRole('OPERATOR')).toEqual({});
  });

  it('agregar el rol a la lista blanca lo vuelve alcanzable', () => {
    class LotesController {
      @Roles('ADMIN', 'MANAGER', 'OPERATOR')
      @RequirePermission('lots', 'update')
      editar() {}
    }

    expect(servicioCon(LotesController).isReachable('OPERATOR', 'lots', 'update')).toBe(true);
  });

  /**
   * Varias rutas comparten permiso y algunas son variantes masivas más
   * angostas. Que la angosta siga cerrada no hace inútil al tilde: editar un
   * lote de a uno sí funciona, así que el permiso cuenta como alcanzable.
   */
  it('alcanza con que UNA ruta del permiso admita el rol', () => {
    class LotesController {
      @Roles('ADMIN', 'MANAGER', 'OPERATOR')
      @RequirePermission('lots', 'update')
      editarUno() {}

      @Roles('ADMIN', 'MANAGER')
      @RequirePermission('lots', 'update')
      reconciliarTodo() {}
    }

    expect(servicioCon(LotesController).isReachable('OPERATOR', 'lots', 'update')).toBe(true);
  });

  it('una ruta sin @Roles la alcanzan todos los roles', () => {
    class AbiertoController {
      @RequirePermission('dashboard', 'read')
      ver() {}
    }

    const svc = servicioCon(AbiertoController);
    for (const rol of ['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'] as const) {
      expect(svc.isReachable(rol, 'dashboard', 'read')).toBe(true);
    }
  });

  it('hereda el @Roles de la clase cuando el handler no lo declara', () => {
    @Roles('ADMIN')
    class SoloAdminController {
      @RequirePermission('billing', 'remove')
      borrar() {}
    }

    const svc = servicioCon(SoloAdminController);
    expect(svc.isReachable('ADMIN', 'billing', 'remove')).toBe(true);
    expect(svc.isReachable('MANAGER', 'billing', 'remove')).toBe(false);
  });

  it('el @Roles del handler gana sobre el de la clase', () => {
    @Roles('ADMIN')
    class MixtoController {
      @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
      @RequirePermission('reports', 'read')
      leer() {}
    }

    expect(servicioCon(MixtoController).isReachable('AUDITOR', 'reports', 'read')).toBe(true);
  });

  it('un método sin @RequirePermission no aporta nada al techo', () => {
    class SinPermisoController {
      @Roles('ADMIN', 'MANAGER', 'OPERATOR')
      algo() {}
    }

    expect(servicioCon(SinPermisoController).forRole('OPERATOR')).toEqual({});
  });

  it('agrupa varias acciones del mismo módulo', () => {
    class PaletsController {
      @Roles('ADMIN', 'MANAGER', 'OPERATOR')
      @RequirePermission('pallets', 'create')
      crear() {}

      @Roles('ADMIN', 'MANAGER', 'OPERATOR')
      @RequirePermission('pallets', 'update')
      editar() {}

      @Roles('ADMIN', 'MANAGER')
      @RequirePermission('pallets', 'remove')
      borrar() {}
    }

    const svc = servicioCon(PaletsController);
    expect(svc.forRole('OPERATOR').pallets.sort()).toEqual(['create', 'update']);
    expect(svc.forRole('MANAGER').pallets.sort()).toEqual(['create', 'remove', 'update']);
  });

  it('ignora un rol inexistente en un @Roles sin romperse', () => {
    class RaroController {
      @Roles('ADMIN', 'SUPERVISOR_QUE_NO_EXISTE')
      @RequirePermission('lots', 'read')
      leer() {}
    }

    const svc = servicioCon(RaroController);
    expect(svc.isReachable('ADMIN', 'lots', 'read')).toBe(true);
    expect(svc.forRole('OPERATOR')).toEqual({});
  });

  it('junta el techo de varios controllers', () => {
    class A {
      @Roles('ADMIN', 'MANAGER', 'OPERATOR')
      @RequirePermission('lots', 'update')
      m() {}
    }
    class B {
      @Roles('ADMIN', 'MANAGER')
      @RequirePermission('users', 'update')
      m() {}
    }

    const svc = servicioCon(A, B);
    expect(svc.forRole('OPERATOR')).toEqual({ lots: ['update'] });
    expect(svc.forRole('MANAGER')).toEqual({ lots: ['update'], users: ['update'] });
  });

  it('un rol sin ninguna ruta no revienta: devuelve un techo vacío', () => {
    class A {
      @Roles('ADMIN')
      @RequirePermission('billing', 'remove')
      m() {}
    }

    expect(servicioCon(A).forRole('AUDITOR')).toEqual({});
  });
});
