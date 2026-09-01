import { corsOrigins, isOriginAllowed, corsOriginCallback } from '../src/config/cors';

/**
 * Orígenes permitidos (RL-A-11).
 *
 * El hallazgo original era que sin `CORS_ORIGIN` la API reflejaba cualquier
 * origen con credenciales. Esa parte ya la cerró RL-C-02: `env.validation.ts`
 * exige la variable y aborta el arranque en producción si falta.
 *
 * Lo que quedaba era el gateway de WebSocket, y ahí había un defecto más
 * concreto que el de seguridad: pasaba `CORS_ORIGIN` cruda a socket.io, así que
 * con dos dominios el navegador comparaba su origen contra la cadena entera y
 * la conexión fallaba para todo el mundo. Estos casos fijan las dos cosas.
 */

describe('lectura de CORS_ORIGIN', () => {
  it('parte la lista por comas y recorta espacios', () => {
    expect(corsOrigins('https://app.x.com, https://otro.x.com')).toEqual([
      'https://app.x.com',
      'https://otro.x.com',
    ]);
  });

  it('un solo dominio da una lista de uno, no la cadena suelta', () => {
    // Es el bug del gateway: pasar la cadena en vez de la lista.
    expect(corsOrigins('https://app.x.com')).toEqual(['https://app.x.com']);
  });

  it('descarta entradas vacías de una lista mal escrita', () => {
    expect(corsOrigins('https://app.x.com,,  ,https://otro.x.com')).toEqual([
      'https://app.x.com',
      'https://otro.x.com',
    ]);
  });

  it('sin valor, o sólo espacios, no hay lista', () => {
    expect(corsOrigins(undefined)).toBeNull();
    expect(corsOrigins('')).toBeNull();
    expect(corsOrigins('   ')).toBeNull();
    expect(corsOrigins(' , , ')).toBeNull();
  });
});

describe('decisión sobre un origen', () => {
  const LISTA = 'https://app.x.com,https://otro.x.com';

  it('acepta cualquiera de los dominios de la lista', () => {
    // El caso que estaba roto en el gateway: el segundo dominio.
    expect(isOriginAllowed('https://app.x.com', LISTA)).toBe(true);
    expect(isOriginAllowed('https://otro.x.com', LISTA)).toBe(true);
  });

  it('rechaza un dominio que no está', () => {
    expect(isOriginAllowed('https://malicioso.com', LISTA)).toBe(false);
  });

  it('no acepta la cadena entera como si fuera un origen', () => {
    expect(isOriginAllowed(LISTA, LISTA)).toBe(false);
  });

  it('distingue esquema, host y puerto: no hay coincidencias parciales', () => {
    expect(isOriginAllowed('http://app.x.com', LISTA)).toBe(false);
    expect(isOriginAllowed('https://app.x.com:8443', LISTA)).toBe(false);
    expect(isOriginAllowed('https://app.x.com.malicioso.com', LISTA)).toBe(false);
    expect(isOriginAllowed('https://sub.app.x.com', LISTA)).toBe(false);
  });

  it('sin lista configurada acepta cualquiera: es el modo de desarrollo', () => {
    // En producción no puede pasar — el arranque aborta si falta la variable.
    expect(isOriginAllowed('https://cualquiera.com', undefined)).toBe(true);
  });

  it('una petición sin cabecera Origin se acepta', () => {
    // curl, healthchecks, apps móviles: CORS protege al navegador y acá no hay
    // navegador que proteger.
    expect(isOriginAllowed(undefined, LISTA)).toBe(true);
  });
});

describe('callback que consumen Express y socket.io', () => {
  const conEntorno = (valor: string | undefined, fn: () => void) => {
    const previo = process.env.CORS_ORIGIN;
    if (valor === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = valor;
    try {
      fn();
    } finally {
      if (previo === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = previo;
    }
  };

  it('permite un origen de la lista', () => {
    conEntorno('https://app.x.com', () => {
      const cb = jest.fn();
      corsOriginCallback('https://app.x.com', cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  it('niega sin lanzar un error, para no convertir un 403 en un 500', () => {
    conEntorno('https://app.x.com', () => {
      const cb = jest.fn();
      corsOriginCallback('https://malicioso.com', cb);
      expect(cb).toHaveBeenCalledWith(null, false);
    });
  });

  it('lee el entorno en cada llamada, no al importar el módulo', () => {
    // Es el motivo de que sea una función: el decorador @WebSocketGateway se
    // evalúa al importar, antes de que ConfigModule haya leído el .env. Un
    // valor calculado ahí quedaría congelado con lo que hubiera en ese momento.
    const cb1 = jest.fn();
    conEntorno('https://uno.com', () => corsOriginCallback('https://dos.com', cb1));
    expect(cb1).toHaveBeenCalledWith(null, false);

    const cb2 = jest.fn();
    conEntorno('https://dos.com', () => corsOriginCallback('https://dos.com', cb2));
    expect(cb2).toHaveBeenCalledWith(null, true);
  });
});
