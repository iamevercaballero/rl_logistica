import { MigrationInterface, QueryRunner } from 'typeorm';
import { ROLE_PERMISSIONS_SEED } from '../modules/permissions/role-permissions.seed';

/**
 * Filas de `role_permissions` para los módulos que hasta ahora sólo estaban
 * protegidos por `@Roles()` y pasan a exigir permiso fino (RL-M-10):
 * proveedores, destinos, adjuntos, alertas, y la carga del corte de SAP.
 *
 * **Esta migración es obligatoria y va antes de desplegar el código nuevo.**
 * `PermissionGuard` falla cerrado: `getRolePermissions()` lee de esta tabla, y
 * un módulo sin filas no le da la acción a nadie. Poner `@RequirePermission`
 * sobre un módulo que la tabla no conoce deja a *todos* afuera con 403,
 * incluido el ADMIN. Los tests no lo detectan solos porque siembran de
 * `ROLE_PERMISSIONS_SEED`, la misma constante que se actualiza al agregar el
 * decorador; por eso `permission-coverage.spec.ts` compara los decoradores
 * reales contra el seed, y este archivo lleva el seed a la base.
 *
 * Las filas salen del propio seed en vez de repetirse acá: la constante es la
 * fuente única y así no pueden divergir. Se acota a los módulos que introduce
 * esta migración para que `down()` pueda revertir exactamente lo que agregó y
 * no toque lo que sembró `CreateRolePermissions`.
 */
export class AddMissingRolePermissions1784800000000 implements MigrationInterface {
  name = 'AddMissingRolePermissions1784800000000';

  /** Módulos que esta migración incorpora al motor de permisos. */
  private static readonly MODULOS_NUEVOS = ['suppliers', 'destinations', 'attachments', 'alerts'];

  /** Acciones sueltas que se agregan a un módulo que ya existía. */
  private static readonly ACCIONES_NUEVAS: ReadonlyArray<[string, string]> = [['reports', 'create']];

  private static incumbe(module: string, action: string): boolean {
    return (
      AddMissingRolePermissions1784800000000.MODULOS_NUEVOS.includes(module) ||
      AddMissingRolePermissions1784800000000.ACCIONES_NUEVAS.some(([m, a]) => m === module && a === action)
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const filas = ROLE_PERMISSIONS_SEED.filter((row) =>
      AddMissingRolePermissions1784800000000.incumbe(row.module, row.action),
    );

    // Si el seed dejara de traer alguno de estos módulos, la migración se
    // volvería un no-op silencioso y el despliegue rompería el módulo entero.
    // Mejor abortar acá, con la base intacta.
    const faltantes = AddMissingRolePermissions1784800000000.MODULOS_NUEVOS.filter(
      (m) => !filas.some((f) => f.module === m),
    );
    if (faltantes.length > 0) {
      throw new Error(
        `ROLE_PERMISSIONS_SEED no tiene filas para: ${faltantes.join(', ')}. ` +
          'Sin ellas PermissionGuard deja a todos los usuarios afuera de esos módulos.',
      );
    }

    for (const row of filas) {
      for (const role of row.roles) {
        await queryRunner.query(
          `INSERT INTO "role_permissions" ("role", "module", "action", "allowed")
           VALUES ($1, $2, $3, true)
           ON CONFLICT DO NOTHING`,
          [role, row.module, row.action],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Al revertir, estos módulos vuelven a estar protegidos sólo por `@Roles()`
    // — que es como estaban antes—, así que borrar sus filas no deja ningún
    // endpoint sin control.
    await queryRunner.query(`DELETE FROM "role_permissions" WHERE "module" = ANY($1)`, [
      AddMissingRolePermissions1784800000000.MODULOS_NUEVOS,
    ]);
    for (const [module, action] of AddMissingRolePermissions1784800000000.ACCIONES_NUEVAS) {
      await queryRunner.query(`DELETE FROM "role_permissions" WHERE "module" = $1 AND "action" = $2`, [
        module,
        action,
      ]);
    }
    // Los overrides por usuario apuntan a módulos que dejan de existir en la
    // plantilla: sin esto quedarían filas huérfanas que reaparecerían con otro
    // significado si el módulo se vuelve a agregar.
    await queryRunner.query(`DELETE FROM "user_permissions" WHERE "module" = ANY($1)`, [
      AddMissingRolePermissions1784800000000.MODULOS_NUEVOS,
    ]);
    for (const [module, action] of AddMissingRolePermissions1784800000000.ACCIONES_NUEVAS) {
      await queryRunner.query(`DELETE FROM "user_permissions" WHERE "module" = $1 AND "action" = $2`, [
        module,
        action,
      ]);
    }
  }
}
