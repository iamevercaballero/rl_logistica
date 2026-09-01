/**
 * Autorización del gateway de WebSocket (RL-M-03).
 *
 * El camino HTTP revalida cada petición contra la base: que el usuario exista,
 * esté activo, y que el token no sea anterior al último cambio de contraseña.
 * El WebSocket se conformaba con que la firma fuera válida y tomaba el rol del
 * propio token, así que un usuario dado de baja —o degradado de rol— conservaba
 * su conexión y sus permisos hasta que el token expirara, ocho horas después.
 *
 * Y `server.emit` difundía cada evento a todos los conectados: un operador del
 * depósito 02 veía la actividad del 01, metadatos que por HTTP no podría
 * consultar.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { EventsGateway } from '../src/modules/events/events.gateway';
import { UsersService } from '../src/modules/users/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UserAuditLog } from '../src/modules/users/entities/user-audit-log.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import type { WarehouseAccessService } from '../src/modules/warehouses/warehouse-access.service';
import {
  createAccessService,
  createTestDataSource,
  grantWarehouse,
  resetDb,
  seedBasics,
  type Basics,
} from './test-datasource';

const SECRETO = 'secreto_de_prueba_para_el_gateway_1234567890';

let ds: DataSource;
let gateway: EventsGateway;
let jwt: JwtService;
let access: WarehouseAccessService;
let base: Basics;

/** Socket falso con lo que el gateway realmente usa. */
function socketFalso(token?: string) {
  const salas: string[] = [];
  return {
    id: 'sock-' + Math.random().toString(36).slice(2, 8),
    handshake: { auth: { token }, headers: {} as Record<string, string> },
    data: {} as Record<string, unknown>,
    salas,
    join: jest.fn(async (sala: string) => { salas.push(sala); }),
    disconnect: jest.fn(),
  };
}

/** Servidor falso que anota a qué salas se emitió cada evento. */
function servidorFalso() {
  const emisiones: Array<{ salas: string[]; evento: string }> = [];
  let sockets: unknown[] = [];
  return {
    emisiones,
    setSockets(s: unknown[]) { sockets = s; },
    to(salas: string[]) {
      return { emit: (evento: string) => emisiones.push({ salas, evento }) };
    },
    emit: jest.fn(),
    fetchSockets: async () => sockets,
  };
}

async function crearUsuario(
  username: string,
  role: 'ADMIN' | 'OPERATOR',
  opts: { active?: boolean; passwordChangedAt?: Date } = {},
): Promise<User> {
  const repo = ds.getRepository(User);
  return repo.save(
    repo.create({
      username, fullName: username, passwordHash: 'x', role,
      active: opts.active ?? true,
      passwordChangedAt: opts.passwordChangedAt,
    }),
  );
}

/** Token firmado como los del login, con `iat` controlable. */
function token(user: User, opts: { role?: string; iat?: number } = {}): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: opts.role ?? user.role,
      iat: opts.iat ?? Math.floor(Date.now() / 1000),
    },
    { secret: SECRETO },
  );
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  jwt = new JwtService({ secret: SECRETO });
  access = createAccessService(ds);
  const users = new UsersService(ds.getRepository(User), ds.getRepository(UserAuditLog), ds);
  gateway = new EventsGateway(jwt, users, access);
  process.env.JWT_SECRET = SECRETO;
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('conexión: la misma validación que el camino HTTP', () => {
  it('acepta a un usuario activo con token vigente', async () => {
    const admin = await crearUsuario('admin.ws', 'ADMIN');
    const client = socketFalso(token(admin));

    await gateway.handleConnection(client as never);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.data.user).toMatchObject({ username: 'admin.ws', role: 'ADMIN' });
  });

  it('rechaza a un usuario dado de baja aunque su token siga firmado y sin expirar', async () => {
    const baja = await crearUsuario('operador.baja', 'OPERATOR', { active: false });
    const client = socketFalso(token(baja));

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rechaza un token anterior al último cambio de contraseña', async () => {
    // Es lo que hace que "cerrar sesiones" y cambiar la contraseña corten el
    // acceso en curso, no sólo el próximo login.
    const user = await crearUsuario('operador.uno', 'OPERATOR', { passwordChangedAt: new Date() });
    const viejo = token(user, { iat: Math.floor(Date.now() / 1000) - 3600 });
    const client = socketFalso(viejo);

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rechaza sin token', async () => {
    const client = socketFalso(undefined);
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('el rol vigente en la base manda sobre el que viaja en el token', async () => {
    // Un token emitido cuando el usuario era ADMIN no puede seguir dándole ADMIN
    // después de degradarlo.
    const user = await crearUsuario('degradado', 'OPERATOR');
    const client = socketFalso(token(user, { role: 'ADMIN' }));

    await gateway.handleConnection(client as never);

    expect(client.data.user).toMatchObject({ role: 'OPERATOR' });
  });
});

describe('salas por alcance', () => {
  it('un rol global entra a la sala global y no a la de cada depósito', async () => {
    const admin = await crearUsuario('admin.ws', 'ADMIN');
    const client = socketFalso(token(admin));

    await gateway.handleConnection(client as never);

    expect(client.salas).toEqual(['scope:all']);
  });

  it('un operador entra sólo a las salas de sus depósitos asignados', async () => {
    const otro = await ds.getRepository(Warehouse).save(
      ds.getRepository(Warehouse).create({ name: 'Depósito 02', documentCode: '02', active: true }),
    );
    const op = await crearUsuario('operador.uno', 'OPERATOR');
    await grantWarehouse(ds, base.warehouse.id, op.id);
    const client = socketFalso(token(op));

    await gateway.handleConnection(client as never);

    expect(client.salas).toEqual([`wh:${base.warehouse.id}`]);
    expect(client.salas).not.toContain(`wh:${otro.id}`);
    expect(client.salas).not.toContain('scope:all');
  });
});

describe('emisión acotada al depósito del evento', () => {
  it('un evento con depósito llega a la sala global y a la de ese depósito', async () => {
    const server = servidorFalso();
    (gateway as unknown as { server: unknown }).server = server;

    gateway.emitStockUpdated({ warehouseId: base.warehouse.id });

    expect(server.emisiones).toEqual([
      { salas: ['scope:all', `wh:${base.warehouse.id}`], evento: 'stock:updated' },
    ]);
  });

  it('un evento sin depósito llega sólo a la sala global', async () => {
    const server = servidorFalso();
    (gateway as unknown as { server: unknown }).server = server;

    gateway.emitMovementCreated({ movementId: 'm1', type: 'ENTRY', warehouseId: null });

    expect(server.emisiones).toEqual([{ salas: ['scope:all'], evento: 'movement:created' }]);
  });

  it('ya no difunde a todos los conectados', async () => {
    // `server.emit` sin sala era el comportamiento anterior.
    const server = servidorFalso();
    (gateway as unknown as { server: unknown }).server = server;

    gateway.emitStockUpdated({ warehouseId: base.warehouse.id });

    expect(server.emit).not.toHaveBeenCalled();
  });
});

describe('revalidación de las conexiones vivas', () => {
  it('corta la conexión de un usuario dado de baja después de conectarse', async () => {
    // Validar sólo al conectar no alcanzaba: la baja no cortaba una sesión ya
    // establecida, que sobrevivía hasta que el token expirara.
    const user = await crearUsuario('operador.uno', 'OPERATOR');
    await grantWarehouse(ds, base.warehouse.id, user.id);
    const client = socketFalso(token(user));
    await gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();

    await ds.getRepository(User).update(user.id, { active: false });

    const server = servidorFalso();
    server.setSockets([client]);
    (gateway as unknown as { server: unknown }).server = server;

    await gateway.revalidarConexiones();

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('deja en pie la conexión de un usuario que sigue vigente', async () => {
    const user = await crearUsuario('operador.uno', 'OPERATOR');
    await grantWarehouse(ds, base.warehouse.id, user.id);
    const client = socketFalso(token(user));
    await gateway.handleConnection(client as never);

    const server = servidorFalso();
    server.setSockets([client]);
    (gateway as unknown as { server: unknown }).server = server;

    await gateway.revalidarConexiones();

    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
