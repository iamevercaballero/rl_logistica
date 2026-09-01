import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Reserva de una clave de idempotencia (RL-A-01).
 *
 * Ninguna escritura del sistema era idempotente: un doble clic, un reintento
 * tras un timeout o una reconexión en el depósito creaban dos movimientos
 * idénticos y duplicaban el impacto en stock. El `isPending` del frontend es
 * una defensa visual — quien repita el POST igual obtiene dos movimientos.
 *
 * La fila se inserta ANTES de ejecutar la operación, en su propia transacción,
 * para que una segunda petición concurrente choque con el índice único en vez
 * de ejecutar el trabajo por segunda vez. Cuando la operación termina bien se
 * guarda la respuesta y se devuelve tal cual en los reintentos; si falla, la
 * reserva se borra, porque un error transitorio tiene que poder reintentarse.
 */
@Index('uq_idempotency_key', ['userId', 'key'], { unique: true })
@Index('idx_idempotency_created_at', ['createdAt'])
@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Valor de la cabecera `Idempotency-Key` que mandó el cliente. */
  @Column({ type: 'varchar', length: 200 })
  key: string;

  /**
   * Dueño de la clave. La genera el cliente, así que dos usuarios podrían
   * mandar la misma sin saberlo; el alcance por usuario evita que la respuesta
   * de uno termine devuelta al otro.
   */
  @Column({ type: 'uuid' })
  userId: string;

  /** `POST /api/movements` — para detectar una clave reusada en otro endpoint. */
  @Column({ type: 'varchar', length: 120 })
  endpoint: string;

  /**
   * SHA-256 del cuerpo de la petición. Si llega la misma clave con un cuerpo
   * distinto es un error del cliente, no un reintento: se responde 422 en vez
   * de devolver la respuesta de otra operación.
   */
  @Column({ type: 'varchar', length: 64 })
  requestHash: string;

  /** IN_PROGRESS mientras se ejecuta; COMPLETED cuando hay respuesta guardada. */
  @Column({ type: 'varchar', length: 20, default: 'IN_PROGRESS' })
  status: 'IN_PROGRESS' | 'COMPLETED';

  /** Respuesta serializada, para devolverla idéntica en cada reintento. */
  @Column({ type: 'text', nullable: true })
  responseBody?: string | null;

  @Column({ type: 'int', nullable: true })
  responseStatus?: number | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;
}

/**
 * Cuánto se recuerda una clave. Cubre de sobra los reintentos reales (segundos)
 * y el caso del operador que reabre el remito al otro día; más allá de eso la
 * tabla crecería sin aportar nada.
 */
export const IDEMPOTENCY_TTL_HOURS = 24;
