import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const adjustmentRequestTypes = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const;
export type AdjustmentRequestType = (typeof adjustmentRequestTypes)[number];

export const adjustmentRequestStatuses = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADO',
  'RECHAZADO',
] as const;
export type AdjustmentRequestStatus = (typeof adjustmentRequestStatuses)[number];

/** Motivos de ajuste predefinidos. Admin podrá agregar más (Fase 5). */
export const adjustmentReasonOptions = [
  'DIFERENCIA_INVENTARIO',
  'CONTEO_FISICO',
  'MERMA',
  'PERDIDA',
  'ROTURA',
  'SOBRANTE',
  'OBSOLETO',
  'OTRO',
] as const;
export type AdjustmentReasonOption = (typeof adjustmentReasonOptions)[number];

/**
 * Solicitud de ajuste de inventario.
 * Multi-producto: contiene N líneas (AdjustmentRequestLine).
 * El stock NO se impacta hasta que el estado pasa a APROBADO.
 *
 * Códigos internos:
 *   RLAI-2026-000001 → Ajuste Inventario Entrada (suma stock)
 *   RLAO-2026-000001 → Ajuste Inventario Salida  (resta stock)
 */
@Index('idx_adj_request_created_at', ['createdAt'])
@Index('idx_adj_request_type_status', ['type', 'status'])
@Entity('adjustment_requests')
export class AdjustmentRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código correlativo: RLAI-2026-000001 / RLAO-2026-000001 */
  @Index('idx_adj_request_code', { unique: true })
  @Column({ type: 'varchar', length: 24 })
  code: string;

  @Column({ type: 'varchar' })
  type: AdjustmentRequestType;

  @Column({ type: 'varchar', default: 'BORRADOR' })
  status: AdjustmentRequestStatus;

  /** Motivo principal del ajuste (obligatorio). */
  @Column({ type: 'varchar', length: 60 })
  reason: string;

  /** Categoría libre (ej: "Campaña julio 2026"). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  adjustmentCategory?: string | null;

  /** Depósito principal del ajuste. */
  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  locationId?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Motivo del rechazo — lo agrega el aprobador al rechazar. */
  @Column({ type: 'text', nullable: true })
  rejectReason?: string | null;

  /** Totales denormalizados. */
  @Column({ type: 'int', default: 0 })
  totalLines: number;

  @Column({ type: 'int', default: 0 })
  totalQuantity: number;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'uuid', nullable: true })
  approvedById?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date | null;

  /**
   * Referencia al movimiento original que se está anulando.
   * Seteado cuando el AdjustmentRequest fue creado por el flujo de anulación automática.
   * Al aprobar: ese movimiento queda marcado como VOIDED.
   */
  @Column({ type: 'uuid', nullable: true })
  originalMovementId?: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
