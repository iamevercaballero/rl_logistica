import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Asignación explícita usuario ↔ depósito.
 *
 * No se guardan arrays de ids dentro del usuario: la relación es una tabla
 * propia para que un usuario pueda tener N depósitos, se pueda revocar uno
 * sin reescribir el resto, y las consultas de permisos sean SQL normal.
 *
 * ADMIN/MANAGER no necesitan filas acá — su alcance se resuelve por política
 * en `WarehouseAccessService`. La tabla ya soporta restringirlos en el futuro
 * sin cambiar el esquema.
 */
@Index('uq_user_warehouse', ['userId', 'warehouseId'], { unique: true })
@Index('idx_user_warehouses_user', ['userId'])
@Entity('user_warehouses')
export class UserWarehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  warehouseId: string;

  @CreateDateColumn()
  createdAt: Date;
}
