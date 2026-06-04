import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Contador de secuencias para códigos internos de documentos.
 * Una fila por (prefijo, año): ('RLNE', 2026), ('RLNS', 2026).
 *
 * El incremento se hace con SELECT ... FOR UPDATE dentro de la transacción
 * del documento, garantizando códigos correlativos sin huecos ni colisiones
 * bajo concurrencia.
 */
@Index('idx_document_sequence_key', ['prefix', 'year'], { unique: true })
@Entity('document_sequences')
export class DocumentSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** RLNE / RLNS */
  @Column({ type: 'varchar', length: 8 })
  prefix: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int', default: 0 })
  lastNumber: number;
}
