import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { BCRYPT_COST, UsersService } from '../users/users.service';
import { wasIssuedBeforePasswordChange } from './token-freshness';
import { AuthEvent, type AuthEventType, type AuthFailureReason } from './entities/auth-event.entity';

/**
 * Bloqueo de cuenta por intentos fallidos (RL-M-11).
 *
 * El límite de tasa existente es de 5 intentos por minuto **por IP**: no acota
 * nada a quien reparta los intentos entre varias direcciones, que es lo que hace
 * cualquier ataque serio contra una cuenta concreta. Esto cuenta por *usuario*.
 *
 * Ventana deslizante y no bloqueo permanente, a propósito: un bloqueo que hay
 * que levantar a mano convierte el ataque en una denegación de servicio contra
 * el encargado. Con 10 fallos en 15 minutos, un ataque por fuerza bruta queda
 * inviable y el peor caso para un usuario legítimo es esperar un rato — visible,
 * además, en `auth_events`.
 */
const MAX_INTENTOS_FALLIDOS = 10;
const VENTANA_BLOQUEO_MS = 15 * 60_000;

/**
 * Hash de descarte para igualar el tiempo de respuesta cuando el usuario no
 * existe (RL-M-11).
 *
 * `login` devolvía antes de llegar a `bcrypt.compare` si no encontraba al
 * usuario, y bcrypt con coste 12 tarda cientos de milisegundos: la diferencia
 * era medible desde afuera y permitía averiguar qué nombres de usuario existen
 * sin acertar una sola contraseña. Comparando siempre contra algo, las dos
 * ramas cuestan lo mismo.
 *
 * Es un hash real de coste 12 sobre una cadena que nadie va a tipear; no es un
 * secreto ni una credencial.
 *
 * El coste tiene que coincidir con el de los hashes reales, o la señal
 * reaparece invertida: contra un usuario con hash viejo de coste 10, comparar
 * contra uno de coste 12 hace que la rama del usuario inexistente sea cuatro
 * veces más LENTA. Por eso los hashes viejos se reescriben al primer ingreso
 * exitoso — ver `rehashSiHaceFalta`.
 */
const HASH_DE_DESCARTE = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.6vfoRfJUcqPnhAvGDRSsIzKQfLzM7Ei';

/** Identidad de red del intento, resuelta por el controlador. */
export type AuthAttemptContext = {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
    @InjectRepository(AuthEvent)
    private readonly authEvents: Repository<AuthEvent>,
  ) {}

  /* ── Access token config (uses JwtModule defaults) ─────────────────────── */

  /**
   * Refresh token secret (separate from access token secret).
   * Falls back to a derived secret in dev if JWT_REFRESH_SECRET is not set,
   * but logs a warning. In production, always set it explicitly.
   */
  private get refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET ?? `${process.env.JWT_SECRET ?? 'dev_secret'}_refresh`;
  }

  private get refreshExpiresIn(): string {
    return process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  }

  /* ── Public methods ─────────────────────────────────────────────────────── */

  /**
   * Registra el intento en `auth_events`.
   *
   * Es best-effort a propósito, y es una excepción consciente al criterio de
   * RL-A-05 —donde la auditoría va dentro de la transacción del negocio—. Acá no
   * hay ninguna operación que revertir: si la escritura falla, negar el login no
   * "deshace" nada, sólo deja a la gente afuera. El fallo se registra en el log
   * de la aplicación, que es donde se va a ver que la bitácora dejó de escribir.
   */
  private async registrarIntento(
    eventType: AuthEventType,
    username: string,
    userId: string | null,
    reason: AuthFailureReason | null,
    contexto: AuthAttemptContext,
  ): Promise<void> {
    try {
      await this.authEvents.save(
        this.authEvents.create({
          eventType,
          // Recortado al largo de la columna: el nombre lo elige quien intenta.
          username: (username ?? '').slice(0, 120),
          userId,
          reason,
          ip: contexto.ip ?? null,
          userAgent: contexto.userAgent ?? null,
          requestId: contexto.requestId ?? null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el intento de login (${eventType}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Reescribe el hash del usuario si quedó con un coste inferior al vigente.
   *
   * El coste viaja dentro del propio hash, así que subir `BCRYPT_COST` no toca
   * los hashes ya guardados: sin esto, las contraseñas de quienes no la cambian
   * seguirían protegidas con el coste viejo para siempre. El único momento en
   * que se puede recalcular es este, cuando la contraseña en claro está a mano
   * y ya se comprobó que es correcta.
   *
   * Además cierra el hueco de tiempo del hash de descarte: con costes mezclados,
   * la rama del usuario inexistente no puede costar lo mismo que todas las demás.
   *
   * Best-effort: un fallo acá no puede impedir un login que ya es válido.
   */
  private async rehashSiHaceFalta(user: { id: string; passwordHash: string }, password: string): Promise<void> {
    try {
      if (bcrypt.getRounds(user.passwordHash) >= BCRYPT_COST) return;
      await this.usersService.replacePasswordHash(user.id, await bcrypt.hash(password, BCRYPT_COST));
      this.logger.log(`Hash de contraseña actualizado al coste ${BCRYPT_COST} para el usuario ${user.id}`);
    } catch (error) {
      this.logger.warn(`No se pudo actualizar el hash de contraseña: ${(error as Error).message}`);
    }
  }

  /**
   * Fallos consecutivos de este usuario dentro de la ventana.
   *
   * "Consecutivos" es literal: sólo cuentan los posteriores al último ingreso
   * exitoso. Si no, alguien que entra bien todos los días acumularía fallos
   * sueltos hasta quedar bloqueado sin motivo.
   *
   * Se cuenta por el nombre **tal como se tipeó**, sin comprobar que el usuario
   * exista: así el bloqueo se comporta igual para un usuario real que para uno
   * inventado y no delata cuáles existen.
   */
  private async fallosRecientes(username: string): Promise<number> {
    const desde = new Date(Date.now() - VENTANA_BLOQUEO_MS);
    const filas = await this.authEvents.query(
      `SELECT COUNT(*)::int AS fallos
         FROM auth_events
        WHERE username = $1
          AND "eventType" = 'LOGIN_FAILED'
          -- El propio rechazo por bloqueo NO cuenta: si contara, cada intento
          -- durante el bloqueo lo renovaría y la ventana deslizante se
          -- convertiría en un bloqueo permanente mientras dure el ataque —
          -- justo la denegación de servicio que la ventana viene a evitar.
          AND reason IS DISTINCT FROM 'ACCOUNT_LOCKED'
          AND "createdAt" > $2
          AND "createdAt" > COALESCE(
                (SELECT MAX("createdAt") FROM auth_events
                  WHERE username = $1 AND "eventType" = 'LOGIN_SUCCESS'),
                to_timestamp(0))`,
      [username, desde],
    );
    return Number(filas[0]?.fallos ?? 0);
  }

  /**
   * La respuesta es siempre la misma —"Credenciales inválidas"— para no
   * confirmarle a quien prueba si un usuario existe. El motivo real queda sólo
   * en `auth_events`, que es donde sí hace falta para investigar.
   */
  async login(username: string, password: string, contexto: AuthAttemptContext = {}) {
    const user = await this.usersService.findByUsername(username);

    // El bloqueo se evalúa antes de mirar la contraseña, y da un mensaje
    // distinto a propósito: no revela si la cuenta existe —se aplica igual a un
    // nombre inventado— y sí le dice a quien está trabado por qué y por cuánto.
    if ((await this.fallosRecientes(username)) >= MAX_INTENTOS_FALLIDOS) {
      await this.registrarIntento('LOGIN_FAILED', username, user?.id ?? null, 'ACCOUNT_LOCKED', contexto);
      throw new HttpException(
        `Demasiados intentos fallidos para este usuario. Esperá ${VENTANA_BLOQUEO_MS / 60_000} minutos e intentá de nuevo.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Siempre se compara contra algo: sin esto, la rama del usuario inexistente
    // volvía en milisegundos mientras la otra pagaba el coste de bcrypt, y esa
    // diferencia delata qué nombres existen.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? HASH_DE_DESCARTE);

    if (!user) {
      await this.registrarIntento('LOGIN_FAILED', username, null, 'USER_NOT_FOUND', contexto);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!user.active) {
      await this.registrarIntento('LOGIN_FAILED', username, user.id, 'USER_INACTIVE', contexto);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!ok) {
      await this.registrarIntento('LOGIN_FAILED', username, user.id, 'BAD_PASSWORD', contexto);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.rehashSiHaceFalta(user, password);
    await this.registrarIntento('LOGIN_SUCCESS', username, user.id, null, contexto);

    const payload = { sub: user.id, username: user.username, role: user.role };

    const [access_token, refresh_token] = await Promise.all([
      this.jwt.signAsync(payload),
      this.jwt.signAsync(payload, {
        secret: this.refreshSecret,
        // Cast needed: @nestjs/jwt uses branded StringValue but accepts plain strings at runtime
        expiresIn: this.refreshExpiresIn as any,
      }),
    ]);

    // Best-effort: un fallo acá no debe impedir el login.
    void this.usersService.touchLastLogin(user.id).catch(() => {});

    return {
      access_token,
      refresh_token,
      user: {
        userId: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName ?? null,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /**
   * Validate a refresh token and issue a new access token.
   * Throws 401 if the token is missing, expired, or invalid.
   */
  async refresh(refreshToken: string | undefined): Promise<{ access_token: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token ausente');
    }

    let payload: { sub: string; username: string; role: string; iat: number };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    // Optionally verify the user still exists and is active
    const user = await this.usersService.findByUsername(payload.username);
    if (!user || !user.active) {
      throw new UnauthorizedException('Usuario inactivo o eliminado');
    }
    // Sin esto, "cerrar sesiones"/reset de contraseña solo cortaba el access
    // token: el refresh token seguía vivo y renovaba acceso indefinidamente.
    if (wasIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)) {
      throw new UnauthorizedException('La sesión ya no es válida: la contraseña cambió o se cerraron las sesiones.');
    }

    const access_token = await this.jwt.signAsync({
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
    });

    return { access_token };
  }
}
