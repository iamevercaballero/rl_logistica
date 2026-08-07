/**
 * Fecha y hora — el caso concreto que se reportó: una operación cargada el
 * 05/08 aparecía como 04/08 a las 21:00 porque `new Date('2026-08-05')` se
 * interpreta como medianoche UTC y Asunción está en UTC-3.
 *
 * No necesita base de datos: son funciones puras.
 */
import {
  APP_TIME_ZONE,
  businessToday,
  parseBusinessDate,
  toBusinessDateString,
} from '../src/common/date';

/**
 * Cómo se ve un instante en el depósito (Asunción).
 * `hourCycle: 'h23'` explícito: con `hour12: false` algunas versiones de ICU
 * muestran la medianoche como "24:00" en vez de "00:00".
 */
const inAsuncion = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);

describe('fecha/hora — parseBusinessDate', () => {
  it('el 05/08 sigue siendo 05/08 y no el 04/08 a las 21:00', () => {
    const instante = parseBusinessDate('2026-08-05');
    expect(inAsuncion(instante)).toBe('2026-08-05, 00:00');
  });

  it('el regresivo ingenuo (new Date) es justamente el que falla', () => {
    // Deja documentado el bug que esto corrige.
    expect(inAsuncion(new Date('2026-08-05'))).toBe('2026-08-04, 21:00');
  });

  it('guarda en UTC el desplazamiento correcto', () => {
    // Medianoche en Asunción (UTC-3) es 03:00 UTC del mismo día.
    expect(parseBusinessDate('2026-08-05').toISOString()).toBe('2026-08-05T03:00:00.000Z');
  });

  it('respeta un instante completo sin tocarlo', () => {
    const iso = '2026-08-05T14:30:00.000Z';
    expect(parseBusinessDate(iso).toISOString()).toBe(iso);
  });

  it('sin fecha devuelve el momento actual', () => {
    const antes = Date.now();
    const ahora = parseBusinessDate(undefined).getTime();
    expect(ahora).toBeGreaterThanOrEqual(antes);
  });

  it('funciona en los bordes de mes y de año', () => {
    expect(inAsuncion(parseBusinessDate('2026-01-01'))).toBe('2026-01-01, 00:00');
    expect(inAsuncion(parseBusinessDate('2025-12-31'))).toBe('2025-12-31, 00:00');
  });
});

describe('fecha/hora — toBusinessDateString', () => {
  it('un instante de las 22:00 de Asunción sigue siendo el mismo día', () => {
    // 2026-08-05 22:00 en Asunción = 2026-08-06 01:00 UTC.
    // Con toISOString().slice(0,10) daría 06/08 — un día de más.
    const instante = new Date('2026-08-06T01:00:00.000Z');
    expect(toBusinessDateString(instante)).toBe('2026-08-05');
  });

  it('devuelve una fecha calendario tal cual, sin convertir', () => {
    expect(toBusinessDateString('2026-08-05')).toBe('2026-08-05');
  });

  it('null/vacío devuelve null', () => {
    expect(toBusinessDateString(null)).toBeNull();
    expect(toBusinessDateString(undefined)).toBeNull();
  });

  it('un valor inválido devuelve null en vez de "Invalid Date"', () => {
    expect(toBusinessDateString('no-es-fecha')).toBeNull();
  });

  it('ida y vuelta: parsear y volver a formatear conserva el día', () => {
    for (const dia of ['2026-08-05', '2026-01-01', '2026-12-31', '2026-02-28']) {
      expect(toBusinessDateString(parseBusinessDate(dia))).toBe(dia);
    }
  });
});

describe('fecha/hora — businessToday', () => {
  it('devuelve el día de Asunción, no el de UTC', () => {
    expect(businessToday()).toBe(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date()),
    );
  });

  it('tiene formato YYYY-MM-DD', () => {
    expect(businessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
