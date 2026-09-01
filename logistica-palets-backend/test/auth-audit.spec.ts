/**
 * Bitácora de autenticación y append-only real (RL-M-09).
 *
 * Tres huecos que iban juntos: no quedaba rastro de un intento de login
 * fallido, la IP registrada habría sido la del túnel y no la del cliente, y las
 * tablas de auditoría eran append-only sólo por convención.
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
import { User } from '../src/modules/users/entities/user.entity';
import { UserAuditLog } from '../src/modules/users/entities/user-audit-log.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { clientIp, requestId, userAgent, behindTrustedProxy } from '../src/common/client-ip';
import { createTestDataSource, resetDb } from './test-datasource';

const CLAVE = 'Password1';

let ds: DataSource;
let auth: AuthService;

const eventos = () => ds.getRepository(AuthEvent).find({ order: { createdAt: 'ASC' } });

async function crearUsuario(username: string, active = true): Promise<User> {
  const repo = ds.getRepository(User);
  return repo.save(
    repo.create({
      username,
      fullName: username,
      passwordHash: await bcrypt.hash(CLAVE, 10),
      role: 'OPERATOR',
      active,
    }),
  );
}

const contexto = {
  ip: '190.128.44.7',
  userAgent: 'Mozilla/5.0 (Android 14; Mobile) Chrome/126',
  requestId: 'e2f1c0aa-1111-2222-3333-444455556666',
};

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  const users = new UsersService(ds.getRepository(User), ds.getRepository(UserAuditLog), ds);
  auth = new AuthService(users, new JwtService({ secret: 'test-secret' }), ds.getRepository(AuthEvent));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('registro de intentos de login', () => {
  it('un login correcto queda registrado con IP, user-agent y id de correlación', async () => {
    const user = await crearUsuario('operador.uno');

    await auth.login('operador.uno', CLAVE, contexto);

    const [evento] = await eventos();
    expect(evento.eventType).toBe('LOGIN_SUCCESS');
    expect(evento.userId).toBe(user.id);
    expect(evento.reason).toBeNull();
    expect(evento.ip).toBe(contexto.ip);
    expect(evento.userAgent).toBe(contexto.userAgent);
    expect(evento.requestId).toBe(contexto.requestId);
  });

  it('una contraseña incorrecta queda registrada con el motivo real', async () => {
    const user = await crearUsuario('operador.uno');

    await expect(auth.login('operador.uno', 'incorrecta', contexto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const [evento] = await eventos();
    expect(evento.eventType).toBe('LOGIN_FAILED');
    expect(evento.reason).toBe('BAD_PASSWORD');
    expect(evento.userId).toBe(user.id);
    expect(evento.username).toBe('operador.uno');
  });

  it('un usuario inexistente queda registrado con el nombre que se tipeó', async () => {
    // Es la señal de que alguien está probando nombres: sin guardar lo tipeado,
    // un barrido de usuarios es indistinguible de un dedo torpe.
    await expect(auth.login('administrador', CLAVE, contexto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const [evento] = await eventos();
    expect(evento.reason).toBe('USER_NOT_FOUND');
    expect(evento.userId).toBeNull();
    expect(evento.username).toBe('administrador');
  });

  it('un usuario dado de baja se distingue de una contraseña incorrecta', async () => {
    const user = await crearUsuario('operador.baja', false);

    await expect(auth.login('operador.baja', CLAVE, contexto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const [evento] = await eventos();
    expect(evento.reason).toBe('USER_INACTIVE');
    expect(evento.userId).toBe(user.id);
  });

  it('la respuesta al cliente es la misma en los tres casos: no revela si el usuario existe', async () => {
    await crearUsuario('operador.uno');
    await crearUsuario('operador.baja', false);

    const mensajes: string[] = [];
    for (const [u, p] of [['operador.uno', 'mala'], ['no.existe', CLAVE], ['operador.baja', CLAVE]]) {
      await auth.login(u, p, contexto).catch((e: Error) => mensajes.push(e.message));
    }

    expect(mensajes).toEqual(['Credenciales inválidas', 'Credenciales inválidas', 'Credenciales inválidas']);
    // El motivo real sí se distingue, pero sólo del lado de la bitácora.
    expect((await eventos()).map((e) => e.reason)).toEqual([
      'BAD_PASSWORD',
      'USER_NOT_FOUND',
      'USER_INACTIVE',
    ]);
  });

  it('nunca guarda la contraseña, ni siquiera cuando se tipea en el campo de usuario', async () => {
    const secreto = 'ClaveSuperSecreta123';
    await expect(auth.login(secreto, secreto, contexto)).rejects.toBeInstanceOf(UnauthorizedException);

    // El username sí se guarda tal cual —es el dato útil— pero ninguna columna
    // más puede contener lo tipeado como contraseña.
    const [evento] = await eventos();
    const sinUsername = { ...evento, username: '' };
    expect(JSON.stringify(sinUsername)).not.toContain(secreto);
  });

  it('un fallo al escribir la bitácora no impide entrar', async () => {
    // Es best-effort a propósito: negar el login no deshace nada, sólo deja a la
    // gente afuera. El fallo se ve en el log de la aplicación.
    await crearUsuario('operador.uno');
    const repo = ds.getRepository(AuthEvent);
    const save = jest.spyOn(repo, 'save').mockRejectedValueOnce(new Error('base caída'));

    await expect(auth.login('operador.uno', CLAVE, contexto)).resolves.toHaveProperty('access_token');

    save.mockRestore();
  });
});

describe('IP real del cliente', () => {
  const conCabecera = (headers: Record<string, string>, ip = '172.18.0.5') => ({ ip, headers });

  it('detrás de un proxy declarado usa CF-Connecting-IP, no la IP del túnel', () => {
    // Sin esto, `req.ip` es la IP del contenedor cloudflared: la misma para
    // todos los usuarios.
    expect(clientIp(conCabecera({ 'cf-connecting-ip': '190.128.44.7' }), '1')).toBe('190.128.44.7');
  });

  it('sin proxy declarado ignora la cabecera: si no, sería falsificable', () => {
    // Si el backend quedara expuesto de forma directa, esa cabecera la pone
    // quien quiera — y con ella se saltearía el límite de intentos de login.
    expect(clientIp(conCabecera({ 'cf-connecting-ip': '1.2.3.4' }), undefined)).toBe('172.18.0.5');
  });

  it('normaliza las IPv4 mapeadas a IPv6, que si no cuentan como dos clientes', () => {
    expect(clientIp({ ip: '::ffff:190.128.44.7' }, undefined)).toBe('190.128.44.7');
  });

  it('TRUST_PROXY sólo se considera activo con un valor con sentido', () => {
    expect(behindTrustedProxy('1')).toBe(true);
    expect(behindTrustedProxy('true')).toBe(true);
    expect(behindTrustedProxy('0')).toBe(false);
    expect(behindTrustedProxy('false')).toBe(false);
    expect(behindTrustedProxy('')).toBe(false);
    expect(behindTrustedProxy(undefined)).toBe(false);
  });

  it('recorta el user-agent al largo de la columna y devuelve null si no viene', () => {
    expect(userAgent({ headers: { 'user-agent': 'x'.repeat(400) } })).toHaveLength(255);
    expect(userAgent({ headers: {} })).toBeNull();
  });

  it('toma el id de correlación de la petición', () => {
    expect(requestId({ id: 'abc-123' })).toBe('abc-123');
    expect(requestId({})).toBeNull();
  });
});

describe('append-only: la base lo hace cumplir, no la convención', () => {
  it('no se puede borrar un evento de autenticación', async () => {
    await crearUsuario('operador.uno');
    await auth.login('operador.uno', CLAVE, contexto);

    await expect(ds.query(`DELETE FROM "auth_events"`)).rejects.toThrow(/append-only/i);
    expect(await ds.getRepository(AuthEvent).count()).toBe(1);
  });

  it('no se puede editar un evento de autenticación', async () => {
    await crearUsuario('operador.uno');
    await expect(auth.login('operador.uno', 'mala', contexto)).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      ds.query(`UPDATE "auth_events" SET "reason" = 'BAD_PASSWORD', "ip" = NULL`),
    ).rejects.toThrow(/append-only/i);
  });

  it('tampoco se puede borrar de la bitácora logística', async () => {
    // Es la que sostiene la trazabilidad del inventario: quien pudiera hacer un
    // movimiento indebido no debe poder borrar su rastro desde la misma conexión.
    const repo = ds.getRepository(DocumentEvent);
    await repo.save(
      repo.create({
        entityType: 'MOVEMENT',
        entityId: '00000000-0000-0000-0000-0000000000ff',
        eventType: 'CREADO',
        description: 'evento de prueba',
      }),
    );

    await expect(ds.query(`DELETE FROM "document_events"`)).rejects.toThrow(/append-only/i);
    await expect(ds.query(`UPDATE "document_events" SET "description" = 'otra cosa'`)).rejects.toThrow(
      /append-only/i,
    );
    expect(await repo.count()).toBe(1);
  });

  it('tampoco se puede borrar de la auditoría administrativa de usuarios', async () => {
    const repo = ds.getRepository(UserAuditLog);
    await repo.save(
      repo.create({
        actorUserId: '00000000-0000-0000-0000-0000000000aa',
        targetUserId: '00000000-0000-0000-0000-0000000000bb',
        action: 'ROLE_CHANGED',
        field: 'role',
        oldValue: 'OPERATOR',
        newValue: 'ADMIN',
      }),
    );

    await expect(ds.query(`DELETE FROM "user_audit_log"`)).rejects.toThrow(/append-only/i);
    expect(await repo.count()).toBe(1);
  });

  it('insertar sigue funcionando: lo que se bloquea es modificar', async () => {
    await crearUsuario('operador.uno');
    await auth.login('operador.uno', CLAVE, contexto);
    await auth.login('operador.uno', CLAVE, contexto);
    expect(await ds.getRepository(AuthEvent).count()).toBe(2);
  });
});
