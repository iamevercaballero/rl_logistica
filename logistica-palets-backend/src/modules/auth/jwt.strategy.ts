import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { wasIssuedBeforePasswordChange } from './token-freshness';

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  /** Issued-at en segundos — lo agrega `jsonwebtoken` automáticamente al firmar. */
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev_secret_fallback',
    });
  }

  /**
   * Una firma válida sólo prueba que el token se emitió acá, no que siga vigente:
   * sin revalidar contra la base, un usuario dado de baja o degradado de rol conserva
   * sus permisos hasta que expire el token (8 h por defecto).
   *
   * Es una consulta indexada por `username` (columna única) en una tabla chica; el
   * costo es despreciable frente al de los endpoints que protege, y evita tener que
   * invalidar un caché en cada alta, baja o cambio de rol.
   *
   * Además: un token emitido ANTES del último cambio de contraseña (o de un
   * "cerrar sesiones", que adelanta la misma marca sin tocar la contraseña) se
   * rechaza aunque no haya expirado — es lo que hace que ambas acciones
   * realmente corten el acceso en curso, no solo el próximo login.
   */
  async validate(payload: JwtPayload) {
    const user = await this.users.findByUsername(payload.username);

    if (!user || !user.active) {
      throw new UnauthorizedException('Usuario inactivo o eliminado');
    }
    if (wasIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)) {
      throw new UnauthorizedException('La sesión ya no es válida: la contraseña cambió o se cerraron las sesiones.');
    }

    return {
      userId: user.id,
      username: user.username,
      // El rol vigente en la base manda sobre el que viaja en el token.
      role: user.role,
    };
  }
}
