import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
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
   */
  async validate(payload: JwtPayload) {
    const user = await this.users.findByUsername(payload.username);

    if (!user || !user.active) {
      throw new UnauthorizedException('Usuario inactivo o eliminado');
    }

    return {
      userId: user.id,
      username: user.username,
      // El rol vigente en la base manda sobre el que viaja en el token.
      role: user.role,
    };
  }
}
