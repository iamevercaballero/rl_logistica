/**
 * Fecha y hora — el caso concreto que se reportó: una operación cargada el
 * 05/08 aparecía como 04/08 a las 21:00 porque `new Date('2026-08-05')` se
 * interpreta como medianoche UTC y Asunción está en UTC-3.
 *
 * No necesita base de datos: son funciones puras.
 */
import {
  APP_TIME_ZONE,
  businessDateTimeParts,
  businessDaysUntil,
  businessToday,
  endOfBusinessDay,
  formatBusinessDate,
  parseBusinessDate,
  parseExcelDateCell,
  shiftBusinessDate,
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

describe('fecha/hora — formatBusinessDate (DD/MM/AAAA para notas de auditoría)', () => {
  it('2027-08-15 (mediodía UTC, sin ambigüedad de zona) se muestra 15/08/2027', () => {
    expect(formatBusinessDate(new Date('2027-08-15T12:00:00.000Z'))).toBe('15/08/2027');
  });

  it('2026-08-10 se muestra 10/08/2026', () => {
    expect(formatBusinessDate(new Date('2026-08-10T12:00:00.000Z'))).toBe('10/08/2026');
  });

  it('coincide con toBusinessDateString reordenado — misma fuente de verdad', () => {
    const instante = new Date('2026-08-05T14:30:00.000Z');
    const [y, m, d] = toBusinessDateString(instante)!.split('-');
    expect(formatBusinessDate(instante)).toBe(`${d}/${m}/${y}`);
  });
});

describe('fecha/hora — shiftBusinessDate', () => {
  it('suma y resta días de calendario', () => {
    expect(shiftBusinessDate('2026-08-10', 1)).toBe('2026-08-11');
    expect(shiftBusinessDate('2026-08-10', -1)).toBe('2026-08-09');
  });

  it('cruza bordes de mes y de año', () => {
    expect(shiftBusinessDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftBusinessDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('fecha/hora — businessDaysUntil (Control Frescura, KPIs, alertas de vencimiento)', () => {
  it('un lote que vence HOY da 0, no -1 — el bug que tenía reports.service.ts::freshness()', () => {
    expect(businessDaysUntil('2026-08-10', '2026-08-10')).toBe(0);
  });

  it('cuenta los días correctamente en ambas direcciones', () => {
    expect(businessDaysUntil('2026-08-15', '2026-08-10')).toBe(5);
    expect(businessDaysUntil('2026-08-05', '2026-08-10')).toBe(-5);
  });

  it('cruza correctamente un borde de año', () => {
    expect(businessDaysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('null/undefined → null, no NaN', () => {
    expect(businessDaysUntil(null)).toBeNull();
    expect(businessDaysUntil(undefined)).toBeNull();
  });

  it('usa hoy-en-Asunción como base por defecto', () => {
    expect(businessDaysUntil(businessToday())).toBe(0);
  });
});

describe('fecha/hora — endOfBusinessDay (rangos de fecha en reportes/movimientos/ajustes)', () => {
  it('incluye un movimiento cargado a las 23:59 de Asunción dentro del filtro "hasta hoy"', () => {
    // 23:59 en Asunción cae dentro de [inicio, fin] del mismo día calendario.
    const offsetMin = (parseBusinessDate('2026-08-10').getTime() - Date.UTC(2026, 7, 10)) / 60_000;
    const veintitresYCincuentaYNueve = new Date(Date.UTC(2026, 7, 11) - offsetMin * 60_000 - 60_000);
    const fin = endOfBusinessDay('2026-08-10');
    expect(veintitresYCincuentaYNueve.getTime()).toBeLessThanOrEqual(fin.getTime());
    expect(veintitresYCincuentaYNueve.getTime()).toBeGreaterThanOrEqual(parseBusinessDate('2026-08-10').getTime());
  });

  it('excluye la medianoche del día siguiente', () => {
    const fin = endOfBusinessDay('2026-08-10');
    const medianocheSiguiente = parseBusinessDate('2026-08-11');
    expect(fin.getTime()).toBeLessThan(medianocheSiguiente.getTime());
  });
});

describe('fecha/hora — businessDateTimeParts (SIFEN / xml-generator)', () => {
  it('separa fecha y hora en Asunción para un instante real', () => {
    const instante = new Date('2026-08-05T14:30:00.000Z');
    const { date, time } = businessDateTimeParts(instante);
    expect(date).toBe(toBusinessDateString(instante));
    expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('la medianoche se muestra 00:00:00, no 24:00:00 (gotcha de ICU con hour12)', () => {
    // Medianoche exacta en Asunción del 2026-08-10.
    const medianoche = parseBusinessDate('2026-08-10');
    const { date, time } = businessDateTimeParts(medianoche);
    expect(date).toBe('2026-08-10');
    expect(time).toBe('00:00:00');
  });
});

describe('fecha/hora — parseExcelDateCell (carga inicial de stock desde Excel)', () => {
  it('"05/08/2026" es 5 de agosto, NO 8 de mayo — el bug crítico confirmado por el audit', () => {
    // new Date("05/08/2026") lo interpretaría como MM/DD (inglés) = 8 de mayo.
    expect(parseExcelDateCell('05/08/2026')).toBe('2026-08-05');
    expect(parseExcelDateCell('05/08/2026')).not.toBe('2026-05-08');
  });

  it('un día > 12 también se parsea DD/MM (ya funcionaba, pero confirma la convención)', () => {
    expect(parseExcelDateCell('25/08/2026')).toBe('2026-08-25');
  });

  it('acepta guión como separador', () => {
    expect(parseExcelDateCell('05-08-2026')).toBe('2026-08-05');
  });

  it('acepta un Date real (si SheetJS alguna vez entrega cellDates)', () => {
    expect(parseExcelDateCell(new Date('2026-08-05T12:00:00.000Z'))).toBe('2026-08-05');
  });

  it('acepta ya-YYYY-MM-DD sin tocarlo', () => {
    expect(parseExcelDateCell('2026-08-05')).toBe('2026-08-05');
  });

  it('celda vacía → undefined (sin vencimiento, no es un error)', () => {
    expect(parseExcelDateCell('')).toBeUndefined();
    expect(parseExcelDateCell(null)).toBeUndefined();
    expect(parseExcelDateCell(undefined)).toBeUndefined();
  });

  it('mes o día fuera de rango → null (valor inválido, no se adivina)', () => {
    expect(parseExcelDateCell('32/13/2026')).toBeNull();
  });
});
