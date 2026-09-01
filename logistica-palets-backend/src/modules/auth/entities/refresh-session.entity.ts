import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Sesión de refresco: una fila por cada refresh token vigente (RL-M-02).
 *
 * Hasta acá `logout` sólo borraba la cookie del navegador. El token seguía
 * siendo válido siete días, así que cerrar sesión no cerraba nada para quien
 * tuviera una copia: sólo un cambio de contraseña o un "cerrar sesiones" —vía
 * `passwordChangedAt`— lo invalidaba de verdad. Y como tampoco se rotaba, un
 * token robado servía las mismas siete días sin que nada lo delatara.
 *
 * El `id` de esta fila viaja como `jti` dentro del refresh token: sin una fila
 * viva que le corresponda, el token no vale. Eso convierte el logout en una
 * revocación real y permite detectar el reuso.
 *
 * Guarda identificadores y metadatos de red, nunca el token: un volcado de esta
 * tabla no le sirve a nadie para autenticarse.
 */
@Index('idx_refresh_session_user', ['userId', 'revokedAt'])
@Index('idx_refresh_session_expires', ['expiresAt'])
@Entity('refresh_sessions')
export class RefreshSession {
  /** Viaja como `jti` en el refresh token. */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /**
   * Cadena de rotación. Todas las sesiones que descienden de un mismo login
   * comparten esta raíz, así que detectar un reuso permite cortar la familia
   * entera y no sólo el eslabón presentado.
   */
  @Column({ type: 'uuid' })
  familyId: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  /** `null` mientras la sesión está viva. */
  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  /**
   * Por qué se revocó. `ROTATED` es el caso normal —se usó para refrescar y
   * quedó reemplazada—; los otros dos son el logout y el corte de una familia
   * al detectar que se reusó un token ya rotado.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  revokedReason?: 'ROTATED' | 'LOGOUT' | 'REUSE_DETECTED' | null;

  /** Sesión que la reemplazó al rotar, para poder seguir la cadena. */
  @Column({ type: 'uuid', nullable: true })
  replacedById?: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
