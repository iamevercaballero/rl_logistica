/**
 * Revocación y rotación de refresh tokens (RL-M-02).
 *
 * `logout` sólo borraba la cookie del navegador: el token seguía siendo válido
 * siete días, así que cerrar sesión no cerraba nada para quien tuviera una
 * copia. Y como tampoco se rotaba, un token robado servía esos mismos siete
 * días sin que nada lo delatara.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { AuthEvent } from '../src/modules/auth/entities/auth-event.entity';
import { RefreshSession } from '../src/modules/auth/entities/refresh-session.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { UserAuditLog } from '../src/modules/users/entities/user-audit-log.entity';
import { createTestDataSource, resetDb } from './test-datasource';

const CLAVE = 'Password1';
const SECRETO = 'secreto-de-prueba-para-refresh';

let ds: DataSource;
let auth: AuthService;
let jwt: JwtService;

async function crearUsuario(username = 'operador.uno'): Promise<User> {
  const repo = ds.getRepository(User);
  return repo.save(
    repo.create({
      username, fullName: username,
      passwordHash: await bcrypt.hash(CLAVE, 4),
      role: 'OPERATOR', active: true,
    }),
  );
}

const sesiones = () => ds.getRepository(RefreshSession).find({ order: { createdAt: 'ASC' } });

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  jwt = new JwtService({ secret: SECRETO });
  const users = new UsersService(ds.getRepository(User), ds.getRepository(UserAuditLog), ds);
  auth = new AuthService(
    users, jwt, ds.getRepository(AuthEvent), ds.getRepository(RefreshSession),
  );
  process.env.JWT_REFRESH_SECRET = SECRETO;
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('el login abre una sesión', () => {
  it('cada ingreso crea una fila viva con su vencimiento', async () => {
    const user = await crearUsuario();
    await auth.login(user.username, CLAVE, { ip: '190.1.2.3', userAgent: 'curl' });

    const [s] = await sesiones();
    expect(s.userId).toBe(user.id);
    expect(s.revokedAt).toBeNull();
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(s.ip).toBe('190.1.2.3');
  });

  it('el token lleva el id de la sesión, no un identificador cualquiera', async () => {
    // Es lo que hace posible revocarlo: sin fila viva, el token no vale.
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);
    const payload = jwt.verify<{ jti: string }>(refresh_token, { secret: SECRETO });

    const [s] = await sesiones();
    expect(payload.jti).toBe(s.id);
  });
});

describe('logout revoca de verdad', () => {
  it('el refresh token deja de servir después de cerrar sesión', async () => {
    // El caso del hallazgo: antes seguía sirviendo siete días.
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);

    await auth.logout(refresh_token);

    await expect(auth.refresh(refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deja constancia del motivo', async () => {
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);
    await auth.logout(refresh_token);

    const [s] = await sesiones();
    expect(s.revokedReason).toBe('LOGOUT');
  });

  it('cerrar sesión dos veces, o con un token inválido, no falla', async () => {
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);

    await expect(auth.logout(refresh_token)).resolves.toBeUndefined();
    await expect(auth.logout(refresh_token)).resolves.toBeUndefined();
    await expect(auth.logout('no-es-un-token')).resolves.toBeUndefined();
    await expect(auth.logout(undefined)).resolves.toBeUndefined();
  });

  it('cerrar una sesión no toca las otras del mismo usuario', async () => {
    // Dos dispositivos: cerrar en uno no puede echar al otro.
    const user = await crearUsuario();
    const a = await auth.login(user.username, CLAVE);
    const b = await auth.login(user.username, CLAVE);

    await auth.logout(a.refresh_token);

    await expect(auth.refresh(b.refresh_token)).resolves.toHaveProperty('access_token');
  });
});

describe('rotación en cada refresco', () => {
  it('devuelve un token nuevo y el anterior queda inservible', async () => {
    const user = await crearUsuario();
    const { refresh_token: primero } = await auth.login(user.username, CLAVE);

    const { refresh_token: segundo } = await auth.refresh(primero);
    expect(segundo).not.toBe(primero);

    // El nuevo sirve.
    await expect(auth.refresh(segundo)).resolves.toHaveProperty('access_token');
  });

  it('la sesión anterior queda marcada como rotada y apunta a la que la reemplazó', async () => {
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);
    await auth.refresh(refresh_token);

    const [vieja, nueva] = await sesiones();
    expect(vieja.revokedReason).toBe('ROTATED');
    expect(vieja.replacedById).toBe(nueva.id);
    expect(nueva.familyId).toBe(vieja.familyId);
  });
});

describe('detección de reuso', () => {
  it('reusar un token ya rotado cierra TODAS las sesiones de esa familia', async () => {
    // Presentar un token ya rotado significa que hay dos copias en circulación.
    // No se puede saber cuál es la legítima, así que se cortan todas.
    const user = await crearUsuario();
    const { refresh_token: robado } = await auth.login(user.username, CLAVE);
    const { refresh_token: legitimo } = await auth.refresh(robado);

    // El atacante usa la copia vieja.
    await expect(auth.refresh(robado)).rejects.toBeInstanceOf(UnauthorizedException);

    // Y el token del usuario legítimo también deja de servir: tiene que volver
    // a entrar con su contraseña, que es lo único que el atacante no tiene.
    await expect(auth.refresh(legitimo)).rejects.toBeInstanceOf(UnauthorizedException);

    const todas = await sesiones();
    expect(todas.every((s) => s.revokedAt !== null)).toBe(true);
    expect(todas.some((s) => s.revokedReason === 'REUSE_DETECTED')).toBe(true);
  });

  it('el reuso queda registrado en la bitácora de accesos', async () => {
    const user = await crearUsuario();
    const { refresh_token: robado } = await auth.login(user.username, CLAVE);
    await auth.refresh(robado);
    await auth.refresh(robado).catch(() => undefined);

    const eventos = await ds.getRepository(AuthEvent).find();
    expect(eventos.map((e) => e.reason)).toContain('REFRESH_REUSED');
  });

  it('un reuso no afecta a la sesión de otro dispositivo', async () => {
    // Familias distintas: cada login abre la suya.
    const user = await crearUsuario();
    const dispositivoA = await auth.login(user.username, CLAVE);
    const dispositivoB = await auth.login(user.username, CLAVE);

    const rotadoA = await auth.refresh(dispositivoA.refresh_token);
    await auth.refresh(dispositivoA.refresh_token).catch(() => undefined); // reuso en A

    await expect(auth.refresh(rotadoA.refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(dispositivoB.refresh_token)).resolves.toHaveProperty('access_token');
  });
});

describe('tokens que no corresponden a una sesión', () => {
  it('un token sin jti se rechaza: es de antes de esta feature', async () => {
    // Admitirlos dejaría abierta una vía que evita la revocación.
    const user = await crearUsuario();
    const viejo = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      { secret: SECRETO, expiresIn: '7d' },
    );

    await expect(auth.refresh(viejo)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token cuya sesión ya se borró se rechaza', async () => {
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);
    await ds.query(`DELETE FROM "refresh_sessions"`);

    await expect(auth.refresh(refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('una sesión vencida se rechaza aunque el token todavía verifique', async () => {
    const user = await crearUsuario();
    const { refresh_token } = await auth.login(user.username, CLAVE);
    await ds.query(`UPDATE "refresh_sessions" SET "expiresAt" = now() - interval '1 minute'`);

    await expect(auth.refresh(refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
