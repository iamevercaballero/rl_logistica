import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A qué tipo de entidad pertenece el adjunto. */
export const attachmentEntityTypes = ['MOVEMENT', 'DOCUMENT', 'ADJUSTMENT'] as const;
export type AttachmentEntityType = (typeof attachmentEntityTypes)[number];

/** Categoría visual del adjunto (para filtrar y mostrar íconos). */
export const attachmentCategories = ['CAMION', 'PALLET', 'REMITO', 'OTRO'] as const;
export type AttachmentCategory = (typeof attachmentCategories)[number];

/**
 * Archivo adjunto (foto, PDF, doc) vinculado a un movimiento,
 * remito (LogisticsDocument) o solicitud de ajuste.
 *
 * El nombre es obligatorio: el operador debe nombrar cada archivo
 * al momento de subirlo (regla de negocio de RL Logística).
 */
@Index('idx_attachment_entity', ['entityType', 'entityId'])
@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre descriptivo dado por el operador — OBLIGATORIO. */
  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Nombre original del archivo tal como vino del sistema del usuario. */
  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 20 })
  category: AttachmentCategory;

  /** MIME type (image/jpeg, application/pdf, etc.). */
  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  /** Tamaño en bytes. */
  @Column({ type: 'int' })
  fileSize: number;

  /** Ruta relativa dentro de /app/uploads — ej: 2026/06/uuid-filename.jpg */
  @Column({ type: 'varchar', length: 500 })
  filePath: string;

  @Column({ type: 'varchar', length: 20 })
  entityType: AttachmentEntityType;

  @Column({ type: 'uuid' })
  entityId: string;

  @Column({ type: 'uuid' })
  createdById: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
