import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const planStatuses = ['PLANNED', 'CONFIRMED', 'EXECUTED', 'CANCELLED'] as const;
export type PlanStatus = (typeof planStatuses)[number];

export const planTypes = ['ENTRY', 'EXIT'] as const;
export type PlanType = (typeof planTypes)[number];

@Index('idx_prod_plan_date', ['plannedDate'])
@Index('idx_prod_plan_product', ['productId'])
@Index('idx_prod_plan_status', ['status'])
@Entity('production_plans')
export class ProductionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  plannedDate: string;

  @Column({ type: 'varchar' })
  type: PlanType;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  locationId?: string | null;

  @Column({ type: 'int' })
  plannedQuantity: number;

  @Column({ type: 'int', nullable: true })
  plannedPallets?: number | null;

  @Column({ type: 'varchar', default: 'PLANNED' })
  status: PlanStatus;

  @Column({ type: 'varchar', nullable: true })
  supplier?: string | null;

  @Column({ type: 'varchar', nullable: true })
  destination?: string | null;

  @Column({ type: 'varchar', nullable: true })
  carrier?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'uuid', nullable: true })
  confirmedById?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
