import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
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

  async login(username: string, password: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = { sub: user.id, username: user.username, role: user.role };

    const [access_token, refresh_token] = await Promise.all([
      this.jwt.signAsync(payload),
      this.jwt.signAsync(payload, {
        secret: this.refreshSecret,
        // Cast needed: @nestjs/jwt uses branded StringValue but accepts plain strings at runtime
        expiresIn: this.refreshExpiresIn as any,
      }),
    ]);

    return {
      access_token,
      refresh_token,
      user: {
        userId: user.id,
        username: user.username,
        role: user.role,
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

    let payload: { sub: string; username: string; role: string };
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

    const access_token = await this.jwt.signAsync({
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
    });

    return { access_token };
  }
}
