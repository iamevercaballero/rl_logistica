import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bitácora de intentos de autenticación (RL-M-09).
 *
 * Antes no quedaba rastro de un login fallido: ni quién lo intentó, ni desde
 * dónde, ni cuántas veces. Un ataque de fuerza bruta contra la cuenta del
 * encargado —o el operador que lleva tres días sin poder entrar— eran
 * igualmente invisibles.
 *
 * **Nunca guarda contraseñas.** Guarda el usuario *tal como se tipeó*, que es
 * lo que permite ver que alguien está probando nombres, y el motivo real del
 * rechazo, que la API no revela: la respuesta HTTP es siempre "Credenciales
 * inválidas" para no confirmar si un usuario existe.
 *
 * La tabla es append-only por trigger — ver `src/common/append-only.ts`.
 */
export const AUTH_EVENT_TYPES = ['LOGIN_SUCCESS', 'LOGIN_FAILED'] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

/** Motivo real del rechazo. Sólo vive acá: la respuesta al cliente es genérica. */
export const AUTH_FAILURE_REASONS = ['USER_NOT_FOUND', 'USER_INACTIVE', 'BAD_PASSWORD', 'ACCOUNT_LOCKED'] as const;
export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number];

@Index('idx_auth_event_created_at', ['createdAt'])
@Index('idx_auth_event_username', ['username', 'createdAt'])
@Index('idx_auth_event_ip', ['ip', 'createdAt'])
@Entity('auth_events')
export class AuthEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  eventType: AuthEventType;

  /**
   * Usuario tal como se tipeó, recortado. Sin normalizar ni resolver: la gracia
   * es poder ver los nombres que alguien está probando.
   */
  @Column({ type: 'varchar', length: 120 })
  username: string;

  /**
   * Usuario real, cuando el nombre corresponde a uno existente. `null` en un
   * intento contra un usuario que no existe. Sin clave foránea, igual criterio
   * que el resto de las columnas de autoría: dar de baja a alguien no debe
   * borrar ni romper el registro de lo que pasó con su cuenta.
   */
  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reason?: AuthFailureReason | null;

  /** IP real del cliente — ver `src/common/client-ip.ts`. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  /** Id de correlación, para cruzar esta fila con las líneas de log del mismo pedido. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId?: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
