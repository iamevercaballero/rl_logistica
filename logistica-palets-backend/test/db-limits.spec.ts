/**
 * Límites de la conexión a PostgreSQL.
 *
 * La auditoría lo dejó anotado como pendiente y era cierto: no había ninguno.
 * Una consulta de reporte con un plan malo se quedaba con su conexión sin
 * límite, y una transacción abandonada retenía además sus bloqueos pesimistas
 * —los que en este código protegen los caminos que tocan stock—, así que con el
 * pool agotado la aplicación deja de responder aunque la base esté sana.
 *
 * Dos mitades se prueban acá. La primera es que la cadena de opciones se arme
 * bien, incluido el caso de un valor inválido: se concatena en los argumentos de
 * arranque de la sesión, de modo que un valor con espacios inyectaría parámetros
 * arbitrarios. La segunda —la que realmente importa— es que PostgreSQL los
 * aplique de verdad: una cadena bien formada que el servidor ignore no sirve de
 * nada, y eso no se ve leyendo el código.
 *
 * La parte que toca la base requiere docker-compose.test.yml levantado.
 */
import { DataSource } from 'typeorm';
import { limitesDeConexion, tiempoValido } from '../src/config/db-limits';

describe('validación de los valores de tiempo', () => {
  it('acepta las formas que entiende PostgreSQL', () => {
    expect(tiempoValido('30s', 'X')).toBe('30s');
    expect(tiempoValido('500ms', 'X')).toBe('500ms');
    expect(tiempoValido('2min', 'X')).toBe('2min');
    expect(tiempoValido('0', 'X')).toBe('0');
  });

  it('recorta los espacios de alrededor', () => {
    expect(tiempoValido('  45s  ', 'X')).toBe('45s');
  });

  it('cae al default ante cualquier cosa que no reconoce', () => {
    // Deliberadamente no falla: un backend que no arranca por un timeout mal
    // escrito es peor que uno que arranca con el valor previsto.
    expect(tiempoValido(undefined, '30s')).toBe('30s');
    expect(tiempoValido('', '30s')).toBe('30s');
    expect(tiempoValido('un rato', '30s')).toBe('30s');
    expect(tiempoValido('30 s', '30s')).toBe('30s');
    expect(tiempoValido('-5s', '30s')).toBe('30s');
  });

  it('no deja inyectar parámetros de arranque', () => {
    // El riesgo concreto: la cadena termina en `options`, que son los argumentos
    // con los que arranca la sesión.
    const malicioso = '30s -c log_statement=all';
    expect(tiempoValido(malicioso, '30s')).toBe('30s');

    const { options } = limitesDeConexion({ DB_STATEMENT_TIMEOUT: malicioso } as NodeJS.ProcessEnv);
    expect(options).not.toContain('log_statement');
    expect(options).toContain('statement_timeout=30s');
  });
});

describe('límites por defecto', () => {
  const vacio = {} as NodeJS.ProcessEnv;

  it('trae timeouts de consulta y de transacción ociosa', () => {
    const { options } = limitesDeConexion(vacio);
    expect(options).toContain('statement_timeout=30s');
    expect(options).toContain('idle_in_transaction_session_timeout=60s');
  });

  it('conserva la zona horaria, y primero', () => {
    // Es la opción que ya estaba y de la que dependen todas las fechas de
    // negocio: agregar límites no puede desplazarla.
    const { options } = limitesDeConexion(vacio);
    expect(options.startsWith('-c timezone=Etc/GMT+3')).toBe(true);
  });

  it('no pone lock_timeout', () => {
    // A propósito: convertiría una espera normal por contención —dos salidas
    // simultáneas sobre el mismo lote, que el motor resuelve con bloqueo
    // pesimista— en un error para el operador.
    expect(limitesDeConexion(vacio).options).not.toContain('lock_timeout');
  });

  it('el pool queda en el default de node-postgres, ahora explícito', () => {
    expect(limitesDeConexion(vacio).poolSize).toBe(10);
  });

  it('una petición deja de esperar para siempre por una conexión libre', () => {
    // Antes era 0, que en node-postgres significa esperar sin límite.
    expect(limitesDeConexion(vacio).connectionTimeoutMillis).toBe(10_000);
  });
});

describe('límites configurados por entorno', () => {
  it('respeta los tres valores', () => {
    const l = limitesDeConexion({
      DB_STATEMENT_TIMEOUT: '5min',
      DB_IDLE_TX_TIMEOUT: '2min',
      DB_POOL_SIZE: '25',
      DB_CONNECTION_TIMEOUT_MS: '3000',
    } as NodeJS.ProcessEnv);
    expect(l.options).toContain('statement_timeout=5min');
    expect(l.options).toContain('idle_in_transaction_session_timeout=2min');
    expect(l.poolSize).toBe(25);
    expect(l.connectionTimeoutMillis).toBe(3000);
  });

  it('admite desactivar el timeout, que es el escape para una migración larga', () => {
    const l = limitesDeConexion({ DB_STATEMENT_TIMEOUT: '0' } as NodeJS.ProcessEnv);
    expect(l.options).toContain('statement_timeout=0');
  });

  it('descarta un pool inválido en vez de dejar el backend sin conexiones', () => {
    for (const valor of ['0', '-3', 'muchas', '2.5', '']) {
      expect(limitesDeConexion({ DB_POOL_SIZE: valor } as NodeJS.ProcessEnv).poolSize).toBe(10);
    }
  });

  it('permite volver a la espera sin límite de forma explícita', () => {
    const l = limitesDeConexion({ DB_CONNECTION_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv);
    expect(l.connectionTimeoutMillis).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
//  Contra PostgreSQL real
// ─────────────────────────────────────────────────────────────
describe('PostgreSQL los aplica de verdad', () => {
  let ds: DataSource;

  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  /** Conexión desnuda con las opciones puestas, sin entidades ni synchronize. */
  const conectar = async (env: NodeJS.ProcessEnv) => {
    const limites = limitesDeConexion(env);
    ds = new DataSource({
      type: 'postgres',
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT) || 5434,
      username: process.env.TEST_DB_USERNAME || 'rl_test',
      password: process.env.TEST_DB_PASSWORD || 'test_password_change_me',
      database: process.env.TEST_DB_DATABASE || 'logistica_palets_test',
      entities: [],
      synchronize: false,
      logging: false,
      extra: {
        options: limites.options,
        connectionTimeoutMillis: limites.connectionTimeoutMillis,
      },
    });
    await ds.initialize();
    return ds;
  };

  it('la sesión arranca con los tres parámetros puestos', async () => {
    const c = await conectar({} as NodeJS.ProcessEnv);
    const [{ statement_timeout }] = await c.query('SHOW statement_timeout');
    const [{ idle_in_transaction_session_timeout: idle }] = await c.query(
      'SHOW idle_in_transaction_session_timeout',
    );
    const [{ TimeZone }] = await c.query('SHOW TimeZone');

    expect(statement_timeout).toBe('30s');
    expect(idle).toBe('1min'); // PostgreSQL normaliza 60s
    expect(TimeZone).toBe('Etc/GMT+3'); // la que ya estaba, intacta
  }, 30_000);

  it('una consulta que se pasa del límite se corta', async () => {
    // La prueba que da sentido a todo: con un timeout de 500 ms, dormir un
    // segundo tiene que fallar. Sin esto, la cadena podría estar bien formada y
    // el servidor ignorarla.
    const c = await conectar({ DB_STATEMENT_TIMEOUT: '500ms' } as NodeJS.ProcessEnv);
    await expect(c.query('SELECT pg_sleep(1)')).rejects.toThrow(/statement timeout/i);
  }, 30_000);

  it('una consulta normal no se ve afectada', async () => {
    const c = await conectar({} as NodeJS.ProcessEnv);
    const [{ ok }] = await c.query('SELECT 1 AS ok');
    expect(ok).toBe(1);
  }, 30_000);
});
