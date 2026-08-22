import { Column, Entity, Index, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * Eventos administrativos sobre un usuario — quién le cambió qué a quién.
 *
 * Nunca contiene contraseñas ni hashes: `PASSWORD_RESET`/`SESSIONS_CLOSED`
 * quedan registrados como evento sin `oldValue`/`newValue`. `actorUserId` sin
 * FK, a propósito: es el mismo criterio que ya usa el resto de la app para
 * columnas de autoría (`movements.createdById`, etc.) — un actor dado de baja
 * más adelante no debe romper ni vaciar el historial de lo que hizo.
 */
export const USER_AUDIT_ACTIONS = [
  'USER_CREATED',
  'USER_UPDATED',
  'ROLE_CHANGED',
  'USER_ACTIVATED',
  'USER_DEACTIVATED',
  'PASSWORD_RESET',
  'SESSIONS_CLOSED',
  'WAREHOUSE_ASSIGNED',
  'WAREHOUSE_REMOVED',
  'PERMISSION_GRANTED',
  'PERMISSION_REVOKED',
  'PERMISSIONS_RESTORED',
] as const;
export type UserAuditAction = (typeof USER_AUDIT_ACTIONS)[number];

@Index('idx_user_audit_target', ['targetUserId', 'createdAt'])
@Entity('user_audit_log')
export class UserAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  actorUserId: string;

  @Column({ type: 'uuid' })
  targetUserId: string;

  @Column({ type: 'varchar' })
  action: UserAuditAction;

  /** Campo afectado (ej. "role", "active", "movements:create"). Null en eventos sin campo puntual. */
  @Column({ type: 'varchar', nullable: true })
  field?: string | null;

  @Column({ type: 'text', nullable: true })
  oldValue?: string | null;

  @Column({ type: 'text', nullable: true })
  newValue?: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
