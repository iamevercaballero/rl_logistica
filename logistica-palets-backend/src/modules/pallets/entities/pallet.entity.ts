import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformer } from '../../../common/numeric.transformer';

@Index('idx_pallet_current_location', ['currentLocationId'])
@Index('idx_pallet_lot', ['lotId'])
@Index('idx_pallet_status', ['status'])
@Entity('pallets')
export class Pallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'uuid' })
  lotId: string;

  @Column({ type: 'numeric', precision: 14, scale: 3, transformer: numericTransformer })
  quantity: number;

  @Column({ type: 'uuid', nullable: true })
  currentLocationId?: string | null;

  /** AVAILABLE | EXITED | BLOCKED | DAMAGED | IN_TRANSIT */
  @Column({ default: 'AVAILABLE' })
  status: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  exitedAt?: Date | null;

  /** Peso físico del pallet (kg) — informativo, cargado por lote en la entrada e impreso en la etiqueta. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  weightKg?: number | null;
}
