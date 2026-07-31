import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../common/numeric.transformer';

/** Tipo de documento logístico. ENTRY → RLNE, EXIT → RLNS. */
export const documentTypes = ['ENTRY', 'EXIT'] as const;
export type DocumentType = (typeof documentTypes)[number];

/**
 * Estado del circuito de aprobación del documento.
 * Fase 1: los documentos nacen APROBADO (el stock impacta al crear, como hoy).
 * Fase 2 cambiará el default a PENDIENTE_APROBACION y el stock solo posteará al aprobar.
 */
export const documentStatuses = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADO',
  'RECHAZADO',
  'ANULADO',
] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

/**
 * Cabecera de un remito / documento logístico. Agrupa N movimientos
 * (uno por producto+lote) bajo un único código interno RLNE/RLNS.
 *
 * No reemplaza al Movement: cada Movement sigue siendo la línea mono-producto
 * y conserva todo el motor de stock. El documento solo añade la cabecera común
 * (proveedor/cliente, transporte, remito, aprobación, adjuntos, bitácora).
 */
@Index('idx_document_created_at', ['createdAt'])
@Index('idx_document_type_status', ['type', 'status'])
@Entity('logistics_documents')
export class LogisticsDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código interno único: RLNE-2026-000001 (entrada) / RLNS-2026-000001 (salida) */
  @Index('idx_document_code', { unique: true })
  @Column({ type: 'varchar', length: 24 })
  code: string;

  @Column({ type: 'varchar' })
  type: DocumentType;

  @Column({ type: 'varchar', default: 'APROBADO' })
  status: DocumentStatus;

  /** Fecha de recepción (entrada) / despacho (salida). */
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;

  /** N° de remito del proveedor (entrada) o de salida (001-001-000123). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  documentNumber?: string | null;

  /** Proveedor (entrada). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  supplier?: string | null;

  /** Cliente / destino (salida). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  destination?: string | null;

  /** Depósito principal del documento (origen en salida, destino en entrada). */
  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string | null;

  /** Transporte / empresa de transporte. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  carrier?: string | null;

  /** Chofer. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  driver?: string | null;

  /** Chapa / patente del vehículo. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  vehiclePlate?: string | null;

  /** Responsable de recepción/preparación. */
  @Column({ type: 'uuid', nullable: true })
  encargadoId?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Totales denormalizados para listados rápidos. */
  @Column({ type: 'int', default: 0 })
  totalLines: number;

  @Column({ type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer })
  totalQuantity: number;

  @Column({ type: 'uuid' })
  createdById: string;

  /** Quién aprobó/rechazó (Fase 2). */
  @Column({ type: 'uuid', nullable: true })
  approvedById?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
