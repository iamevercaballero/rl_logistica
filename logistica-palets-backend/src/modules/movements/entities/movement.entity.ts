import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const movementTypes = [
  'ENTRY',
  'EXIT',
  'TRANSFER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'REPROCESS',
] as const;

export type MovementType = (typeof movementTypes)[number];

@Entity('movements')
export class Movement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  type: MovementType;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int', nullable: true })
  pallets?: number;

  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string;

  @Column({ type: 'uuid', nullable: true })
  locationId?: string;

  @Column({ type: 'uuid', nullable: true })
  fromWarehouseId?: string;

  @Column({ type: 'uuid', nullable: true })
  fromLocationId?: string;

  @Column({ type: 'uuid', nullable: true })
  toWarehouseId?: string;

  @Column({ type: 'uuid', nullable: true })
  toLocationId?: string;

  @Column({ type: 'varchar', nullable: true })
  documentNumber?: string;

  @Column({ type: 'varchar', nullable: true })
  supplier?: string;

  @Column({ type: 'varchar', nullable: true })
  carrier?: string;

  @Column({ type: 'varchar', nullable: true })
  driver?: string;

  @Column({ type: 'varchar', nullable: true })
  destination?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'uuid', nullable: true })
  palletId?: string;

  @Column({ type: 'uuid', nullable: true })
  lotId?: string;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}