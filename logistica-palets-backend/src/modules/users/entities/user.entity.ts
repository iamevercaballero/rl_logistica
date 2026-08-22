import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type UserRole = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'AUDITOR';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', default: 'OPERATOR' })
  role: UserRole;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'varchar', nullable: true })
  fullName?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Último login exitoso. `null` = todavía no inició sesión. */
  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date | null;

  /**
   * Último cambio de contraseña (o de "cerrar sesiones", que reusa esta misma
   * columna sin tocar la contraseña). `JwtStrategy.validate` rechaza cualquier
   * token emitido antes de este instante — así un reset de contraseña o un
   * "cerrar sesiones" invalida los JWT ya emitidos sin necesitar una lista de
   * revocación aparte.
   */
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  passwordChangedAt: Date;

  /** Si `true`, el frontend exige cambiar la contraseña antes de operar. */
  @Column({ default: false })
  mustChangePassword: boolean;
}
