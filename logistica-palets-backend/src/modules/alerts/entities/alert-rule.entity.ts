import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configurable stock-level alert rules.
 * When a rule fires (stock < thresholdMin) the cron job emits a WS event
 * and can send an email (Fase 4.3).
 */
@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-readable label for this rule. */
  @Column({ nullable: true, type: 'varchar' })
  description: string | null;

  /**
   * Target product. Null = rule applies to ALL products (global threshold).
   */
  @Column({ nullable: true, type: 'uuid' })
  productId: string | null;

  /**
   * Target warehouse. Null = sum across all warehouses.
   */
  @Column({ nullable: true, type: 'uuid' })
  warehouseId: string | null;

  /**
   * Fire the alert when stock falls below this value.
   * Must be >= 0. Zero disables the stock trigger for this rule.
   */
  @Column({ type: 'int', default: 0 })
  thresholdMin: number;

  /**
   * Whether this rule is currently being evaluated by the cron job.
   */
  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
