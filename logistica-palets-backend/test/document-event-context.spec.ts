/**
 * Identidad de red en la bitácora de negocio — cierra la mitad que faltaba de RL-M-09.
 *
 * RL-M-09 dejó IP, user-agent e id de correlación en `auth_events`, la bitácora
 * de accesos, pero `document_events` —la de negocio— siguió guardando sólo quién.
 * De un movimiento o una anulación se sabía el autor, no desde dónde: justo la
 * mitad que hace falta el día que algo se investiga.
 *
 * Lo que hacía difícil cerrarlo no era la columna sino llegar hasta ella: la
 * bitácora se escribe desde catorce lugares, casi todos dentro de una
 * transacción, en servicios que no tienen acceso al `Request`. Pasar los tres
 * valores por parámetro habría tocado los catorce puntos y todas las firmas
 * intermedias, y una llamada olvidada no falla —escribe una fila incompleta y
 * nadie se entera—. `AsyncLocalStorage` los lleva solo.
 *
 * Estas pruebas fijan las dos mitades: que el contexto viaja bien, incluidos los
 * casos donde un almacén por petición se rompe (`await` y concurrencia), y que
 * lo que termina escrito en la fila es lo correcto, incluido el NULL de las
 * escrituras que no vienen de ninguna petición.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import {
  contextoActual,
  conContextoDePeticion,
  RequestContextMiddleware,
  type ContextoDePeticion,
} from '../src/common/request-context';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { createTestDataSource, resetDb, TEST_USER_ID } from './test-datasource';

let ds: DataSource;
let uploads: UploadsService;

const ENTIDAD = '11111111-1111-1111-1111-111111111111';

/** Petición mínima con la forma que leen los helpers de `client-ip`. */
const peticion = (over: Record<string, unknown> = {}) => ({
  ip: '190.128.1.7',
  id: 'req-abc-123',
  headers: { 'user-agent': 'Mozilla/5.0 (deposito)' },
  ...over,
});

const evento = () => ({
  entityType: 'MOVEMENT',
  entityId: ENTIDAD,
  eventType: 'CREADO' as const,
  description: 'Entrada de prueba',
  userId: TEST_USER_ID,
  username: 'tester',
});

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  uploads = new UploadsService(ds.getRepository(Attachment), ds.getRepository(DocumentEvent));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

// ─────────────────────────────────────────────────────────────
//  El contexto en sí
// ─────────────────────────────────────────────────────────────
describe('contexto de la peticion', () => {
  it('fuera de una peticion devuelve nulos, no basura', () => {
    // Es el caso del cron de alertas, el seed y el arranque. Inventar una IP
    // ahi seria peor que no tener ninguna.
    expect(contextoActual()).toEqual({ ip: null, userAgent: null, requestId: null });
  });

  it('deriva los tres valores de la peticion', () => {
    conContextoDePeticion(peticion(), () => {
      expect(contextoActual()).toEqual({
        ip: '190.128.1.7',
        userAgent: 'Mozilla/5.0 (deposito)',
        requestId: 'req-abc-123',
      });
    });
  });

  it('normaliza el IPv4 mapeado sobre IPv6', () => {
    conContextoDePeticion(peticion({ ip: '::ffff:190.128.1.7' }), () => {
      expect(contextoActual().ip).toBe('190.128.1.7');
    });
  });

  it('hereda la regla de TRUST_PROXY: sin proxy declarado, la cabecera de Cloudflare se ignora', () => {
    // Mismo criterio que la bitacora de accesos. Si el backend quedara expuesto
    // de forma directa, esa cabecera la pone cualquiera.
    const previo = process.env.TRUST_PROXY;
    const conCabecera = peticion({
      headers: { 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'x' },
    });
    try {
      delete process.env.TRUST_PROXY;
      conContextoDePeticion(conCabecera, () => {
        expect(contextoActual().ip).toBe('190.128.1.7');
      });

      process.env.TRUST_PROXY = '1';
      conContextoDePeticion(conCabecera, () => {
        expect(contextoActual().ip).toBe('1.2.3.4');
      });
    } finally {
      if (previo === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previo;
    }
  });

  it('sobrevive a los await — que es lo que un almacen por peticion debe garantizar', async () => {
    await conContextoDePeticion(peticion({ id: 'req-await' }), async () => {
      await new Promise((r) => setTimeout(r, 5));
      await Promise.resolve();
      expect(contextoActual().requestId).toBe('req-await');
    });
  });

  it('dos peticiones simultaneas no se mezclan', async () => {
    // La propiedad que hace correcto todo esto. Con una variable de modulo, la
    // segunda peticion pisaria a la primera y la bitacora atribuiria el
    // movimiento de una persona a la IP de otra.
    const una = conContextoDePeticion(peticion({ ip: '10.0.0.1', id: 'r1' }), async () => {
      await new Promise((r) => setTimeout(r, 20));
      return contextoActual();
    });
    const otra = conContextoDePeticion(peticion({ ip: '10.0.0.2', id: 'r2' }), async () => {
      await new Promise((r) => setTimeout(r, 5));
      return contextoActual();
    });
    const [a, b] = await Promise.all([una, otra]);
    expect(a.ip).toBe('10.0.0.1');
    expect(a.requestId).toBe('r1');
    expect(b.ip).toBe('10.0.0.2');
    expect(b.requestId).toBe('r2');
  });

  it('el middleware lo siembra para lo que venga despues, y no queda pegado', () => {
    const mw = new RequestContextMiddleware();
    let visto: ContextoDePeticion | null = null;
    mw.use(peticion({ id: 'req-mw' }), {}, () => {
      visto = contextoActual();
    });
    expect(visto).not.toBeNull();
    expect((visto as unknown as ContextoDePeticion).requestId).toBe('req-mw');
    expect(contextoActual().requestId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
//  Lo que termina escrito en la fila
// ─────────────────────────────────────────────────────────────
describe('la fila de document_events', () => {
  const filaGuardada = () =>
    ds.getRepository(DocumentEvent).findOneByOrFail({ entityId: ENTIDAD });

  it('guarda IP, user-agent e id de correlacion sin que la llamada los pase', async () => {
    // El punto del cambio: `log()` se invoca exactamente igual que antes.
    await conContextoDePeticion(peticion(), () => uploads.log(evento()));

    const fila = await filaGuardada();
    expect(fila.ip).toBe('190.128.1.7');
    expect(fila.userAgent).toBe('Mozilla/5.0 (deposito)');
    expect(fila.requestId).toBe('req-abc-123');
    expect(fila.username).toBe('tester');
  });

  it('deja los tres en null cuando no hay peticion detras', async () => {
    await uploads.log(evento());

    const fila = await filaGuardada();
    expect(fila.ip).toBeNull();
    expect(fila.userAgent).toBeNull();
    expect(fila.requestId).toBeNull();
    // Y el evento se guarda igual: la falta de contexto no rompe la bitacora.
    expect(fila.description).toBe('Entrada de prueba');
  });

  it('recorta el user-agent a lo que entra en la columna', async () => {
    const largo = 'A'.repeat(400);
    await conContextoDePeticion(peticion({ headers: { 'user-agent': largo } }), () =>
      uploads.log(evento()),
    );
    const fila = await filaGuardada();
    expect(fila.userAgent).toHaveLength(255);
  });

  it('el mismo requestId permite cruzar la bitacora de negocio con la de accesos', async () => {
    // El caso de uso que motiva la columna: «este login sospechoso, que
    // movimientos genero». Las dos tablas usan el mismo tipo y el mismo valor.
    await conContextoDePeticion(peticion({ id: 'req-cruce' }), () => uploads.log(evento()));
    const filas = await ds.getRepository(DocumentEvent).findBy({ requestId: 'req-cruce' });
    expect(filas).toHaveLength(1);
  });

  it('el evento escrito dentro de una transaccion tambien lleva el contexto', async () => {
    // Los nueve eventos de inventario se escriben con el `manager` de la
    // transaccion (RL-A-05). Es el camino real, y el que mas lejos queda del
    // objeto Request.
    await conContextoDePeticion(peticion({ id: 'req-tx' }), () =>
      ds.transaction(async (manager) => {
        await uploads.log({ ...evento(), manager });
      }),
    );
    const fila = await filaGuardada();
    expect(fila.requestId).toBe('req-tx');
    expect(fila.ip).toBe('190.128.1.7');
  });
});
