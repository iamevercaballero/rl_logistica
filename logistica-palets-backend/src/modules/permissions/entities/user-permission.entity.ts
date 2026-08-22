import { Column, Entity, Index, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { PermissionAction } from './role-permission.entity';

export type PermissionEffect = 'ALLOW' | 'DENY';

/**
 * Override puntual de permiso para UN usuario — prevalece sobre lo que le
 * daría su rol en `role_permissions`.
 *
 * `ALLOW` suma algo que el rol no daba (ej: un OPERATOR con `reports:read`
 * cuando su rol no lo trae). `DENY` saca algo que el rol sí daba (ej: a Joel
 * se le apaga `movements:create` sin bajarlo de rol). Es intencionalmente
 * plano — un solo override por (usuario, módulo, acción), sin depósito — la
 * spec pide explícitamente no cruzar todavía permisos con depósitos.
 */
@Index('uq_user_permission', ['userId', 'module', 'action'], { unique: true })
@Index('idx_user_permission_user', ['userId'])
@Entity('user_permissions')
export class UserPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar' })
  module: string;

  @Column({ type: 'varchar' })
  action: PermissionAction;

  @Column({ type: 'varchar' })
  effect: PermissionEffect;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
