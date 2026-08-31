import { validateEnv } from '../src/config/env.validation';

/**
 * `validateEnv()` corre en main.ts antes de crear la app: es lo único que separa
 * un arranque en producción con configuración peligrosa de una base de inventario
 * alterada o de una API abierta a cualquier origen. Estas pruebas fijan ese
 * contrato — si alguien relaja una regla, se entera acá y no en el VPS.
 */

/** Config de producción válida: la base sobre la que cada caso rompe una sola cosa. */
const VALIDA = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  DB_PASSWORD: 'una-contraseña-cualquiera',
  CORS_ORIGIN: 'https://app.ejemplo.com',
  DB_SYNCHRONIZE: 'false',
} as const;

const CLAVES = [
  'NODE_ENV',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_PASSWORD',
  'CORS_ORIGIN',
  'DB_SYNCHRONIZE',
] as const;

let original: Record<string, string | undefined>;

/** Deja process.env exactamente con `env`, borrando las claves que no estén. */
function aplicar(env: Record<string, string | undefined>): void {
  for (const k of CLAVES) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  original = Object.fromEntries(CLAVES.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  aplicar(original);
});

describe('validateEnv — fuera de producción no corta nada', () => {
  it.each(['development', 'test', undefined])('NODE_ENV=%s deja pasar una config que en prod sería inválida', (nodeEnv) => {
    aplicar({ ...VALIDA, NODE_ENV: nodeEnv, JWT_SECRET: 'corto', JWT_REFRESH_SECRET: 'corto', DB_SYNCHRONIZE: 'true', CORS_ORIGIN: undefined, DB_PASSWORD: undefined });
    expect(() => validateEnv()).not.toThrow();
  });
});

describe('validateEnv — producción con config válida', () => {
  it('no lanza', () => {
    aplicar(VALIDA);
    expect(() => validateEnv()).not.toThrow();
  });
});

describe('validateEnv — secretos JWT', () => {
  it('rechaza JWT_SECRET ausente', () => {
    aplicar({ ...VALIDA, JWT_SECRET: undefined });
    expect(() => validateEnv()).toThrow(/configuración/i);
  });

  it('rechaza un secreto más corto que 32 caracteres', () => {
    aplicar({ ...VALIDA, JWT_SECRET: 'a'.repeat(31) });
    expect(() => validateEnv()).toThrow();
  });

  it('acepta exactamente 32 caracteres (el límite, no un caracter menos)', () => {
    aplicar({ ...VALIDA, JWT_SECRET: 'a'.repeat(32) });
    expect(() => validateEnv()).not.toThrow();
  });

  it('rechaza un valor por defecto conocido aunque fuera largo', () => {
    aplicar({ ...VALIDA, JWT_SECRET: 'changeme' });
    expect(() => validateEnv()).toThrow();
  });

  it('rechaza que access y refresh compartan el mismo secreto', () => {
    aplicar({ ...VALIDA, JWT_REFRESH_SECRET: VALIDA.JWT_SECRET });
    expect(() => validateEnv()).toThrow();
  });
});

describe('validateEnv — DB_SYNCHRONIZE (RL-C-02)', () => {
  it('aborta el arranque si es "true": TypeORM podría descartar columnas con datos', () => {
    aplicar({ ...VALIDA, DB_SYNCHRONIZE: 'true' });
    expect(() => validateEnv()).toThrow();
  });

  it('acepta "false"', () => {
    aplicar({ ...VALIDA, DB_SYNCHRONIZE: 'false' });
    expect(() => validateEnv()).not.toThrow();
  });

  it('acepta que no esté definida (app.module lo lee como false)', () => {
    aplicar({ ...VALIDA, DB_SYNCHRONIZE: undefined });
    expect(() => validateEnv()).not.toThrow();
  });
});

describe('validateEnv — CORS_ORIGIN (RL-A-11)', () => {
  it('aborta si falta: main.ts caería en origin:true con credentials', () => {
    aplicar({ ...VALIDA, CORS_ORIGIN: undefined });
    expect(() => validateEnv()).toThrow();
  });

  it('aborta si está en blanco — main.ts hace .trim() y lo trata como vacío', () => {
    aplicar({ ...VALIDA, CORS_ORIGIN: '   ' });
    expect(() => validateEnv()).toThrow();
  });

  it('acepta una lista separada por comas', () => {
    aplicar({ ...VALIDA, CORS_ORIGIN: 'https://app.ejemplo.com,https://api.ejemplo.com' });
    expect(() => validateEnv()).not.toThrow();
  });
});

describe('validateEnv — DB_PASSWORD', () => {
  it('aborta si falta', () => {
    aplicar({ ...VALIDA, DB_PASSWORD: undefined });
    expect(() => validateEnv()).toThrow();
  });
});

describe('validateEnv — el mensaje sirve para arreglar el problema', () => {
  it('nombra todas las variables mal configuradas, no sólo la primera', () => {
    aplicar({ ...VALIDA, JWT_SECRET: undefined, CORS_ORIGIN: undefined, DB_SYNCHRONIZE: 'true' });
    // El detalle por variable va al logger; el error resumen lleva la cuenta.
    expect(() => validateEnv()).toThrow(/3 problema/);
  });

  it('nunca incluye el valor de un secreto en el mensaje', () => {
    const secreto = 'valor-secreto-que-no-debe-aparecer-en-ningun-log-1234';
    aplicar({ ...VALIDA, JWT_SECRET: secreto, JWT_REFRESH_SECRET: secreto });

    let mensaje = '';
    try {
      validateEnv();
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }

    expect(mensaje).not.toBe('');
    expect(mensaje).not.toContain(secreto);
  });
});
