import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../common/numeric.transformer';

export const movementTypes = [
  'ENTRY',
  'EXIT',
  'TRANSFER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
] as const;

export type MovementType = (typeof movementTypes)[number];

export const movementStatuses = ['NORMAL', 'PENDING_REGULARIZATION'] as const;
export type MovementStatus = (typeof movementStatuses)[number];

export const adjustmentReasons = [
  'DIFERENCIA_INVENTARIO',
  'CONTEO_FISICO',
  'MERMA',
  'PERDIDA',
  'ROTURA',
  'SOBRANTE',
  'OTRO',
] as const;
export type AdjustmentReason = (typeof adjustmentReasons)[number];

@Index('idx_movement_created_at', ['createdAt'])
@Index('idx_movement_product', ['productId'])
@Index('idx_movement_type_status', ['type', 'status'])
@Index('idx_movement_pallet', ['palletId'])
@Index('idx_movement_lot', ['lotId'])
@Index('idx_movement_document', ['documentId'])
@Entity('movements')
export class Movement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Cabecera (remito) que agrupa este movimiento, si fue creado vía documento. */
  @Column({ type: 'uuid', nullable: true })
  documentId?: string | null;

  @Column({ type: 'varchar' })
  type: MovementType;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'numeric', precision: 14, scale: 3, transformer: numericTransformer })
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

  /** CI del chofer — copiada desde Transportes al registrar el movimiento. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  driverDocument?: string | null;

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

  @Column({ type: 'uuid', nullable: true })
  encargadoRecepcionId?: string | null;

  @Column({ type: 'varchar', default: 'NORMAL' })
  status: MovementStatus;

  @Column({ type: 'varchar', nullable: true })
  adjustmentReason?: string | null;

  @Column({ type: 'varchar', nullable: true })
  adjustmentCategory?: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  /**
   * Estado de anulación:
   *   NONE         → sin anulación
   *   VOID_PENDING → solicitud de anulación pendiente de aprobación
   *   VOIDED       → anulado (transacción compensatoria aprobada y ejecutada)
   */
  @Column({ type: 'varchar', default: 'NONE' })
  voidStatus: 'NONE' | 'VOID_PENDING' | 'VOIDED';

  /** ID del AdjustmentRequest que anula este movimiento (si existe). */
  @Column({ type: 'uuid', nullable: true })
  voidAdjRequestId?: string | null;
}