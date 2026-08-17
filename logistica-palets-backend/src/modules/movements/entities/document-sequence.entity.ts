import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Contador de secuencias para códigos internos de documentos.
 * RLNE/RLNS: una fila por (prefijo, depósito), con `year = 0` porque el
 * correlativo no se reinicia anualmente. RLAI/RLAO conservan su alcance anual
 * global usando `GLOBAL_SEQUENCE_SCOPE`.
 *
 * El incremento se hace con SELECT ... FOR UPDATE dentro de la transacción
 * del documento, garantizando códigos correlativos sin huecos ni colisiones
 * bajo concurrencia.
 */
export const GLOBAL_SEQUENCE_SCOPE = '00000000-0000-0000-0000-000000000000';

@Index('idx_document_sequence_key', ['prefix', 'year', 'warehouseId'], { unique: true })
@Entity('document_sequences')
export class DocumentSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** RLNE / RLNS */
  @Column({ type: 'varchar', length: 8 })
  prefix: string;

  @Column({ type: 'int' })
  year: number;

  /** UUID del depósito para RLNE/RLNS; UUID cero para secuencias globales. */
  @Column({ type: 'uuid', default: GLOBAL_SEQUENCE_SCOPE })
  warehouseId: string;

  @Column({ type: 'int', default: 0 })
  lastNumber: number;
}
