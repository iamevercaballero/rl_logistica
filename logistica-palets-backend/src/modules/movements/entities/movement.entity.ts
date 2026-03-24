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
  pallets?: number | null;

  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  locationId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  fromWarehouseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  fromLocationId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  toWarehouseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  toLocationId?: string | null;

  @Column({ nullable: true })
  documentNumber?: string | null;

  @Column({ nullable: true })
  supplier?: string | null;

  @Column({ nullable: true })
  carrier?: string | null;

  @Column({ nullable: true })
  driver?: string | null;

  @Column({ nullable: true })
  destination?: string | null;

  @Column({ nullable: true })
  notes?: string | null;

  @Column({ type: 'uuid', nullable: true })
  palletId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  lotId?: string | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
