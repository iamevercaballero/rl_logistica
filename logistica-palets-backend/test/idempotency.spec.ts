/**
 * Idempotencia de las escrituras (RL-A-01) contra un PostgreSQL real.
 *
 * Ninguna escritura lo era: un doble clic, un reintento tras un timeout o una
 * reconexión en el depósito creaban dos movimientos idénticos y duplicaban el
 * impacto en stock. El `isPending` del frontend es una defensa visual — quien
 * repita el POST igual obtiene dos movimientos.
 *
 * Estas pruebas ejercitan el interceptor directamente, sin capa HTTP, para
 * poder controlar la concurrencia con precisión.
 */
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';
import { IdempotencyKey } from '../src/common/idempotency/idempotency-key.entity';
import { createTestDataSource } from './test-datasource';

const USER_A = '00000000-0000-0000-0000-0000000000aa';
const USER_B = '00000000-0000-0000-0000-0000000000bb';

let ds: DataSource;
let interceptor: IdempotencyInterceptor;

/** Reflector que devuelve siempre `true`: el endpoint está marcado @Idempotent(). */
const reflectorMarcado = { getAllAndOverride: () => true } as unknown as Reflector;

function contexto(opts: {
  key?: string;
  userId?: string;
  body?: unknown;
  path?: string;
}): ExecutionContext {
  const req = {
    method: 'POST',
    path: opts.path ?? '/api/movements',
    route: { path: opts.path ?? '/api/movements' },
    headers: opts.key ? { 'idempotency-key': opts.key } : {},
    body: opts.body ?? { type: 'ENTRY', quantity: 10 },
    user: opts.userId === null ? undefined : { userId: opts.userId ?? USER_A },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handlerFalso() {},
    getClass: () => class ControladorFalso {},
  } as unknown as ExecutionContext;
}

/** Handler que cuenta ejecuciones — así se ve si el trabajo corrió dos veces. */
function handler(respuesta: unknown, contador?: { n: number }, demoraMs = 0): CallHandler {
  return {
    handle: () => {
      if (contador) contador.n += 1;
      if (demoraMs === 0) return of(respuesta);
      return new Observable<unknown>((sub) => {
        setTimeout(() => { sub.next(respuesta); sub.complete(); }, demoraMs);
      });
    },
  };
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  // El esquema lo crea `synchronize` a partir de la entidad registrada en
  // TEST_ENTITIES: no hace falta DDL a mano.
  interceptor = new IdempotencyInterceptor(reflectorMarcado, ds.getRepository(IdempotencyKey));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await ds.query('TRUNCATE TABLE "idempotency_keys"');
});

const correr = (ctx: ExecutionContext, h: CallHandler) =>
  firstValueFrom(interceptor.intercept(ctx, h) as never);

describe('sin cabecera: el comportamiento no cambia', () => {
  it('ejecuta normalmente y no registra nada', async () => {
    const cuenta = { n: 0 };
    await correr(contexto({}), handler({ movementId: 'm1' }, cuenta));

    expect(cuenta.n).toBe(1);
    expect(await ds.getRepository(IdempotencyKey).count()).toBe(0);
  });
});

describe('reintento con la misma clave', () => {
  it('ejecuta una sola vez y devuelve la misma respuesta', async () => {
    const cuenta = { n: 0 };
    const primera = await correr(contexto({ key: 'k1' }), handler({ movementId: 'm1' }, cuenta));
    const segunda = await correr(contexto({ key: 'k1' }), handler({ movementId: 'm1' }, cuenta));

    expect(cuenta.n).toBe(1);
    expect(primera).toEqual({ movementId: 'm1' });
    expect(segunda).toEqual({ movementId: 'm1' });
  });

  it('claves distintas son operaciones distintas', async () => {
    const cuenta = { n: 0 };
    await correr(contexto({ key: 'k1' }), handler({ movementId: 'm1' }, cuenta));
    await correr(contexto({ key: 'k2' }), handler({ movementId: 'm2' }, cuenta));

    expect(cuenta.n).toBe(2);
  });

  it('la misma clave de OTRO usuario no devuelve la respuesta ajena', async () => {
    const cuenta = { n: 0 };
    await correr(contexto({ key: 'k1', userId: USER_A }), handler({ movementId: 'de-A' }, cuenta));
    const deB = await correr(contexto({ key: 'k1', userId: USER_B }), handler({ movementId: 'de-B' }, cuenta));

    expect(cuenta.n).toBe(2);
    expect(deB).toEqual({ movementId: 'de-B' });
  });
});

describe('la misma clave con otro contenido es un error del cliente', () => {
  it('rechaza con 422 si cambia el cuerpo', async () => {
    await correr(contexto({ key: 'k1', body: { quantity: 10 } }), handler({ movementId: 'm1' }));

    await expect(
      correr(contexto({ key: 'k1', body: { quantity: 999 } }), handler({ movementId: 'm2' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rechaza si se reusa en otro endpoint', async () => {
    await correr(contexto({ key: 'k1', path: '/api/movements' }), handler({ movementId: 'm1' }));

    await expect(
      correr(contexto({ key: 'k1', path: '/api/adjustments' }), handler({ requestId: 'a1' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('doble clic: dos peticiones a la vez', () => {
  it('ejecuta una sola vez y las dos reciben la misma respuesta', async () => {
    const cuenta = { n: 0 };
    // La primera tarda 400 ms; la segunda entra mientras está en curso y tiene
    // que esperar a su respuesta en vez de ejecutar de nuevo o dar error.
    const [a, b] = await Promise.all([
      correr(contexto({ key: 'doble' }), handler({ movementId: 'unico' }, cuenta, 400)),
      new Promise((r) => setTimeout(r, 60)).then(() =>
        correr(contexto({ key: 'doble' }), handler({ movementId: 'DUPLICADO' }, cuenta, 400)),
      ),
    ]);

    expect(cuenta.n).toBe(1);
    expect(a).toEqual({ movementId: 'unico' });
    expect(b).toEqual({ movementId: 'unico' });
  }, 20_000);
});

describe('si la operación falla, la clave se libera', () => {
  it('propaga el error y no deja la reserva', async () => {
    const fallo = { handle: () => throwError(() => new Error('stock insuficiente')) };

    await expect(correr(contexto({ key: 'kf' }), fallo)).rejects.toThrow('stock insuficiente');

    expect(await ds.getRepository(IdempotencyKey).count()).toBe(0);
  });

  it('reintentar con la misma clave vuelve a ejecutar — un error transitorio no se cachea', async () => {
    const fallo = { handle: () => throwError(() => new Error('la base no respondió')) };
    await expect(correr(contexto({ key: 'kr' }), fallo)).rejects.toThrow();

    const cuenta = { n: 0 };
    const res = await correr(contexto({ key: 'kr' }), handler({ movementId: 'ok' }, cuenta));

    expect(cuenta.n).toBe(1);
    expect(res).toEqual({ movementId: 'ok' });
  });
});

describe('estado en la base', () => {
  it('la reserva queda COMPLETED con la respuesta guardada', async () => {
    await correr(contexto({ key: 'kc' }), handler({ movementId: 'm1' }));

    const fila = await ds.getRepository(IdempotencyKey).findOneOrFail({ where: { key: 'kc' } });
    expect(fila.status).toBe('COMPLETED');
    expect(JSON.parse(fila.responseBody!)).toEqual({ movementId: 'm1' });
    expect(fila.endpoint).toBe('POST /api/movements');
  });

  it('una petición en curso que nunca termina acaba en 409, no colgada para siempre', async () => {
    await ds.getRepository(IdempotencyKey).insert({
      key: 'colgada', userId: USER_A, endpoint: 'POST /api/movements',
      // Hash de `{"type":"ENTRY","quantity":10}`, el cuerpo por defecto del helper.
      requestHash: createHash('sha256')
        .update(JSON.stringify({ type: 'ENTRY', quantity: 10 })).digest('hex'),
      status: 'IN_PROGRESS',
    });

    await expect(correr(contexto({ key: 'colgada' }), handler({ movementId: 'x' })))
      .rejects.toBeInstanceOf(ConflictException);
  }, 30_000);
});
