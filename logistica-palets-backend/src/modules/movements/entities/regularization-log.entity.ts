import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_regularization_movement', ['movementId'])
@Entity('regularization_logs')
export class RegularizationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  movementId: string;

  @Column({ type: 'varchar' })
  field: string;

  @Column({ type: 'text', nullable: true })
  oldValue?: string | null;

  @Column({ type: 'text', nullable: true })
  newValue?: string | null;

  @Column({ type: 'uuid' })
  changedById: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
