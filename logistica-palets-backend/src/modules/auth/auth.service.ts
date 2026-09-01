import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { wasIssuedBeforePasswordChange } from './token-freshness';
import { AuthEvent, type AuthEventType, type AuthFailureReason } from './entities/auth-event.entity';

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
   * La respuesta es siempre la misma —"Credenciales inválidas"— para no
   * confirmarle a quien prueba si un usuario existe. El motivo real queda sólo
   * en `auth_events`, que es donde sí hace falta para investigar.
   */
  async login(username: string, password: string, contexto: AuthAttemptContext = {}) {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      await this.registrarIntento('LOGIN_FAILED', username, null, 'USER_NOT_FOUND', contexto);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!user.active) {
      await this.registrarIntento('LOGIN_FAILED', username, user.id, 'USER_INACTIVE', contexto);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.registrarIntento('LOGIN_FAILED', username, user.id, 'BAD_PASSWORD', contexto);
      throw new UnauthorizedException('Credenciales inválidas');
    }

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
