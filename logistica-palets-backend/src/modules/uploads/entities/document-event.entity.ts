import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tipos de eventos que pueden ocurrir en la bitácora de un documento.
 * La tabla es APPEND-ONLY: los eventos nunca se borran ni editan.
 */
export const documentEventTypes = [
  'CREADO',              // Movimiento/remito/ajuste creado
  'EDITADO',             // Metadatos modificados
  'FOTO_ADJUNTADA',      // Archivo adjunto subido
  'ARCHIVO_ELIMINADO',   // Archivo adjunto eliminado
  'ENVIADO_APROBACION',  // Ajuste enviado para aprobación
  'APROBADO',            // Ajuste aprobado, stock posteado
  'AUTOAPROBADO',        // Ajuste aprobado por su propio creador (no había otro aprobador)
  'RECHAZADO',           // Ajuste rechazado (vuelve a borrador)
  'ANULACION_SOLICITADA',// Solicitud de anulación generada
  'ANULADO',             // Movimiento marcado como VOIDED
  'CARGA_INICIAL_REVERTIDA', // Un ajuste de la carga inicial fue eliminado por el revert
  'NOTA_IMPRESA',        // Nota RLNE/RLNS impresa o descargada
  'INSPECCION',          // Inspección de vehículo registrada
] as const;

export type DocumentEventType = (typeof documentEventTypes)[number];

/**
 * Evento de auditoría en la bitácora logística.
 * Append-only — registra todo lo que sucede sobre un documento.
 */
@Index('idx_doc_event_entity', ['entityType', 'entityId'])
@Index('idx_doc_event_created_at', ['createdAt'])
@Index('idx_doc_event_request', ['requestId'], { where: '"requestId" IS NOT NULL' })
@Entity('document_events')
export class DocumentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Tipo de entidad: MOVEMENT | DOCUMENT | ADJUSTMENT */
  @Column({ type: 'varchar', length: 20 })
  entityType: string;

  @Column({ type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar', length: 40 })
  eventType: DocumentEventType;

  /** Descripción legible del evento. */
  @Column({ type: 'text' })
  description: string;

  /** JSON con datos adicionales del evento (opcional). */
  @Column({ type: 'text', nullable: true })
  metadata?: string | null;

  /** Código legible de la entidad (RLNE-2026-000001, RLAI-...) — cacheado sin JOIN. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  entityCode?: string | null;

  /** Usuario que generó el evento (null = sistema automático). */
  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  /** Username cacheado para mostrar sin JOIN. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  username?: string | null;

  /*
   * Identidad de red de la petición que originó el evento. Los tres se llenan
   * solos desde `contextoActual()`; ver `src/common/request-context.ts`.
   *
   * Nulables a propósito: el cron de alertas, el seed y el arranque también
   * escriben en esta bitácora y no vienen de ninguna petición. Ahí NULL es el
   * valor correcto — una IP inventada sería peor que ninguna.
   *
   * Mismos tipos que `auth_events`, para poder cruzar las dos bitácoras por
   * `requestId` sin conversiones.
   */

  /** IP real del cliente — ver `src/common/client-ip.ts`. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  /** Id de correlación, el mismo que viaja en la cabecera `X-Request-Id`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId?: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
