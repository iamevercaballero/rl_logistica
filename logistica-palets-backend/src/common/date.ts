/**
 * Fecha y hora del sistema — una sola forma de parsear y formatear.
 *
 * El problema que resuelve: `new Date('2026-08-05')` se interpreta como
 * medianoche **UTC**, y al mostrarlo en Asunción (UTC-3) retrocede al día
 * anterior a las 21:00. Una entrada cargada el 05/08 aparecía como 04/08.
 *
 * Regla: los instantes se guardan en UTC; una fecha sin hora ("YYYY-MM-DD")
 * representa ese día **en la zona del depósito**, así que se ancla a la
 * medianoche local, no a la UTC.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Zona IANA del depósito — la buena, mientras el runtime la conozca al día. */
const IANA_TIME_ZONE = 'America/Asuncion';

/**
 * UTC-3 fijo, sin reglas de DST. En los identificadores `Etc/GMT±N` el signo va
 * invertido por convención POSIX: `Etc/GMT+3` **es** UTC-3. Existe en todas las
 * versiones de tzdata, así que sirve de red incluso en un runtime sin zoneinfo.
 */
const FIXED_TIME_ZONE = 'Etc/GMT+3';

/** Offset vigente de Paraguay, todo el año. */
const EXPECTED_OFFSET_MINUTES = -180;

/**
 * Offset de la zona (en minutos) para un instante dado. Se calcula con Intl en
 * vez de hardcodear -180 para que siga siendo correcto si Paraguay vuelve a
 * aplicar horario de verano.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string = APP_TIME_ZONE): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Se re-arma la lectura local como si fuera UTC: la diferencia contra el
  // instante original es exactamente el offset de la zona en ese momento.
  const asIfUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour') % 24,
    pick('minute'),
    pick('second'),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * Zona horaria operativa del depósito.
 *
 * Paraguay derogó el horario de verano en octubre de 2024 (Ley 7324): desde
 * entonces es UTC-3 **todo el año**. Un runtime con tzdata anterior a 2024b
 * sigue aplicando la regla derogada y devuelve UTC-4 entre marzo y octubre, con
 * lo cual toda la app muestra una hora menos. Es lo que pasa en las imágenes
 * `*-alpine` sin el paquete `tzdata` y en cualquier Node cuyo ICU quedó atrás,
 * y por qué los reportes y el historial de movimientos se veían atrasados.
 *
 * Por eso la zona no se toma por dada: se verifica una vez, al cargar el
 * módulo, contra un día de invierno conocido. Si el runtime está
 * desactualizado se cae al offset fijo, que no depende de reglas de DST.
 */
function resolveAppTimeZone(): string {
  // 15/07: pleno invierno en Paraguay. Con tzdata ≥2024b da -180; con la regla
  // vieja (horario de verano de octubre a marzo), -240.
  const winter = new Date('2025-07-15T12:00:00Z');
  try {
    return zoneOffsetMinutes(winter, IANA_TIME_ZONE) === EXPECTED_OFFSET_MINUTES
      ? IANA_TIME_ZONE
      : FIXED_TIME_ZONE;
  } catch {
    // El runtime no conoce la zona (contenedor sin zoneinfo): Intl tira RangeError.
    return FIXED_TIME_ZONE;
  }
}

export const APP_TIME_ZONE = resolveAppTimeZone();

/** `true` si el runtime resolvió la zona IANA correctamente — para diagnóstico. */
export const APP_TIME_ZONE_IS_IANA = APP_TIME_ZONE === IANA_TIME_ZONE;

/**
 * Convierte lo que llega del cliente en el instante correcto.
 *
 * - `"2026-08-05"`            → medianoche del 05/08 **en Asunción**.
 * - `"2026-08-05T14:30:00Z"`  → ese instante exacto, sin tocar.
 * - `undefined`/vacío         → ahora.
 */
export function parseBusinessDate(input?: string | Date | null): Date {
  if (!input) return new Date();
  if (input instanceof Date) return input;

  const value = input.trim();
  if (!DATE_ONLY.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  const [y, m, d] = value.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // El offset se evalúa en el propio día para no errar en un cambio de horario.
  const offset = zoneOffsetMinutes(new Date(utcMidnight));
  return new Date(utcMidnight - offset * 60_000);
}

/**
 * Día calendario (YYYY-MM-DD) de un instante, **según la zona del depósito**.
 * Reemplaza a `toISOString().slice(0, 10)`, que devuelve el día en UTC y por
 * lo tanto adelanta un día toda operación hecha después de las 21:00.
 */
export function toBusinessDateString(input?: string | Date | null): string | null {
  if (!input) return null;
  if (typeof input === 'string' && DATE_ONLY.test(input.trim())) return input.trim();

  const instant = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts; // en-CA ya formatea como YYYY-MM-DD
}

/** Día de hoy (YYYY-MM-DD) en la zona del depósito. */
export function businessToday(): string {
  return toBusinessDateString(new Date())!;
}

/**
 * DD/MM/AAAA legible para texto de auditoría/notas (ej. "Anulación... del
 * 15/08/2026") — un instante real, convertido a la zona del depósito antes
 * de tomar el día. Reemplaza `new Date(x).toLocaleDateString('es-PY')` sin
 * `timeZone`, que usa la zona implícita del proceso (UTC en producción).
 */
export function formatBusinessDate(input: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(input);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('day')}/${pick('month')}/${pick('year')}`;
}

/**
 * Suma/resta días de calendario a "YYYY-MM-DD". Ancla en UTC a propósito:
 * es aritmética de calendario, no debe depender del huso del proceso.
 */
export function shiftBusinessDate(value: string, days: number): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Días de calendario entre `from` (por defecto, hoy en el depósito) y `value`
 * — ambos "YYYY-MM-DD". Ancla los dos lados en UTC antes de restar, para que
 * "cuántos días faltan para el vencimiento" no dependa de a qué hora ni en
 * qué huso corre el proceso. Reemplaza al patrón `new Date(fechaVencimiento)`
 * comparado contra `new Date()` que tenían `reports.service.ts` (freshness,
 * kpis) y `alerts.service.ts` — mezclar una fecha calendario anclada en UTC
 * con un instante real corre el resultado un día.
 */
export function businessDaysUntil(value?: string | null, from: string = businessToday()): number | null {
  if (!value) return null;
  const [vy, vm, vd] = value.slice(0, 10).split('-').map(Number);
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(vy, vm - 1, vd) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Normaliza una columna `date` de Postgres leída por una consulta cruda
 * (`dataSource.query`/`getRawMany`): esas no pasan por los transformers de
 * TypeORM, así que en vez de la string "YYYY-MM-DD" que entrega una consulta
 * por Repository/QueryBuilder normal, `pg` la devuelve como un `Date` —
 * anclado a la **medianoche local del proceso**, no UTC. Por eso se lee con
 * los getters locales (`getFullYear`/`getMonth`/`getDate`): usar
 * `toISOString()` o los getters UTC corre el resultado un día salvo que el
 * proceso corra justo en UTC+0. Sin este paso, pasarla tal cual a
 * `businessDaysUntil` tira `TypeError: value.slice is not a function` — el
 * bug real detrás de `freshness()` (reports) y `evaluateExpiryAlerts`
 * (alerts), las dos consultas crudas que tocan `fechaVencimiento`/`fechaFabricacion`.
 */
export function rawDateColumnToString(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Medianoche del día siguiente a `value` menos 1ms, en la zona del depósito:
 * el límite superior (inclusive) de "todo el día `value` en Asunción". Junto
 * con `parseBusinessDate(value)` como límite inferior, arma un rango
 * [inicio, fin] correcto para filtrar timestamps por fecha calendario —
 * reemplaza los `toStartDate`/`toEndDate` que anclaban en UTC (duplicados en
 * movements.service.ts y reports.service.ts) mezclando el día calendario
 * pedido con timestamps guardados en la zona del depósito.
 */
export function endOfBusinessDay(value: string): Date {
  return new Date(parseBusinessDate(value).getTime() + 86_400_000 - 1);
}

/**
 * Parsea una celda de fecha de un Excel/CSV importado (carga inicial de
 * stock, `stockSnapshotFromLotList`). SheetJS entrega estas celdas como
 * texto ya formateado con el formato regional de la planilla — DD/MM/AAAA,
 * como el resto de la app — no como el `Date` que sugeriría `cellDates`.
 *
 * `new Date("05/08/2026")` lo interpreta como MM/DD/AAAA (inglés) e invierte
 * día y mes **en silencio** para cualquier día ≤12: un vencimiento 05/08
 * (5 de agosto) se guardaba como 08/05 (8 de mayo). Por eso acá se parsea
 * DD/MM/AAAA explícitamente antes de delegar a cualquier otro formato.
 *
 * `undefined` = celda vacía (sin vencimiento); `null` = valor presente pero inválido.
 */
export function parseExcelDateCell(value: unknown): string | null | undefined {
  if (value instanceof Date) return toBusinessDateString(value);
  const str = String(value ?? '').trim();
  if (!str) return undefined;

  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const day = Number(d);
    const month = Number(m);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return toBusinessDateString(str);
}

/**
 * Fecha y hora de un instante, como componentes separados en la zona del
 * depósito — para armar XML/exports que necesitan la fecha y la hora en
 * campos distintos (ej. SIFEN). `hourCycle: 'h23'` evita que ICU renderice
 * la medianoche como "24:00".
 */
export function businessDateTimeParts(input: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(input);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}:${pick('second')}`,
  };
}
