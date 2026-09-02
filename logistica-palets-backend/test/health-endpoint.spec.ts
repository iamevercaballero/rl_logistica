import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from '../src/app.controller';
import { esperaDeReintento } from '../src/modules/cache/cache.service';

/**
 * Endpoint de salud y reconexión a Redis (RL-B-01).
 *
 * RL-B-01 pide monitoreo externo, y eso depende del VPS. Lo que no depende es
 * que haya algo útil para monitorear, y al revisarlo aparecieron dos cosas.
 *
 * La primera: `retryStrategy` devolvía `null` tras tres intentos. En ioredis
 * eso no pospone la reconexión, la cancela para siempre. Verificado deteniendo
 * y volviendo a levantar un Redis de prueba: el cliente no se recuperaba y la
 * caché quedaba muerta hasta reiniciar el backend, en silencio, porque todas
 * las operaciones hacen no-op. Con el techo de memoria de RL-A-10, que el
 * kernel mate a Redis dejó de ser hipotético.
 *
 * La segunda: `/api/health` no decía nada de Redis, así que esa degradación no
 * era observable desde afuera de ninguna forma. Ahora se informa, pero sin
 * tocar el `status`: sacar la app de rotación por una caché caída convertiría
 * una degradación en una caída.
 */

describe('espera de reintento a Redis', () => {
  it('nunca cancela la reconexión', () => {
    // El defecto exacto: `times < 3 ? 500 : null`. Cualquier valor no numérico
    // acá significa que Redis no vuelve solo nunca más.
    for (const intento of [1, 2, 3, 4, 10, 100, 10_000]) {
      const espera = esperaDeReintento(intento);
      expect(typeof espera).toBe('number');
      expect(espera).toBeGreaterThan(0);
    }
  });

  it('espacia los intentos pero no más de diez segundos', () => {
    expect(esperaDeReintento(1)).toBe(500);
    expect(esperaDeReintento(4)).toBe(2000);
    expect(esperaDeReintento(20)).toBe(10_000);
    expect(esperaDeReintento(1000)).toBe(10_000);
  });
});

describe('endpoint de salud', () => {
  const conBase = (ok: boolean) =>
    ({
      query: ok
        ? jest.fn().mockResolvedValue([{ '?column?': 1 }])
        : jest.fn().mockRejectedValue(new Error('password authentication failed for user "rl_prod"')),
    }) as never;
  const conCache = (listo: boolean) => ({ isReady: listo }) as never;

  it('todo arriba: status ok y los dos checks en ok', async () => {
    const r = (await new AppController(conBase(true), conCache(true)).health()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    expect(r.status).toBe('ok');
    expect(r.checks.database.status).toBe('ok');
    expect(r.checks.redis.status).toBe('ok');
  });

  it('Redis caído se informa pero NO tumba el health', async () => {
    const r = (await new AppController(conBase(true), conCache(false)).health()) as {
      status: string;
      checks: Record<string, { status: string; note?: string }>;
    };
    // Lo importante: sigue devolviendo 200 y status ok. Si esto cambiara, una
    // caché caída sacaría la aplicación de rotación.
    expect(r.status).toBe('ok');
    expect(r.checks.redis.status).toBe('down');
    expect(r.checks.redis.note).toMatch(/sigue operativo/);
  });

  it('la base caída sí devuelve 503', async () => {
    await expect(
      new AppController(conBase(false), conCache(true)).health(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('la respuesta no filtra el mensaje del driver (RL-M-04)', async () => {
    // El endpoint no pide autenticación y está exento del límite de tasa, así
    // que el error crudo de PostgreSQL —que nombra usuario, host y base—
    // quedaba al alcance de cualquiera.
    let cuerpo = '';
    try {
      await new AppController(conBase(false), conCache(true)).health();
    } catch (e) {
      cuerpo = JSON.stringify((e as ServiceUnavailableException).getResponse());
    }
    expect(cuerpo).not.toMatch(/password authentication/i);
    expect(cuerpo).not.toMatch(/rl_prod/);
    expect(cuerpo).toMatch(/"status":"down"/);
  });
});
