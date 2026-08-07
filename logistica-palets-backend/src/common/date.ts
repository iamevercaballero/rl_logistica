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

/** Zona horaria operativa del depósito. */
export const APP_TIME_ZONE = 'America/Asuncion';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Offset de la zona (en minutos) para un instante dado. Se calcula con Intl en
 * vez de hardcodear -180 para que siga siendo correcto si Paraguay vuelve a
 * aplicar horario de verano.
 */
function zoneOffsetMinutes(instant: Date, timeZone = APP_TIME_ZONE): number {
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
