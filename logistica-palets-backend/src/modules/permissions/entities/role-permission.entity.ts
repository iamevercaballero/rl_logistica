import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from '../../users/entities/user.entity';

/** Acciones reconocidas por el motor de permisos. No todo módulo usa todas. */
export type PermissionAction = 'read' | 'create' | 'update' | 'remove' | 'approve';

/**
 * Plantilla de permisos por rol — la versión "editable desde la app" de lo
 * que hoy vive hardcodeado en `frontend/src/auth/rbac.ts` y en los `@Roles()`
 * de cada controller.
 *
 * Es la base de `getEffectivePermissions`: un usuario sin overrides (la
 * inmensa mayoría) tiene exactamente los permisos de su rol acá. Solo se
 * insertan filas para combinaciones permitidas (`allowed = true`) — la
 * ausencia de fila ya significa "no permitido", así que el seed inicial no
 * necesita enumerar los `false`.
 */
@Index('uq_role_permission', ['role', 'module', 'action'], { unique: true })
@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  role: UserRole;

  @Column({ type: 'varchar' })
  module: string;

  @Column({ type: 'varchar' })
  action: PermissionAction;

  @Column({ default: true })
  allowed: boolean;
}
