/**
 * Utilidades de formato de fechas para RL Logística.
 *
 * SIEMPRE usan:
 *  - locale  "es-PY"  (Paraguay)
 *  - timeZone "America/Asuncion"
 *
 * Esto garantiza consistencia independientemente de la zona horaria
 * del servidor, del contenedor Docker o del browser del operador.
 *
 * Hay dos clases de valor y NO se tratan igual:
 *
 *  1. Instantes ("2026-08-05T14:30:00Z"): un momento en el tiempo. Se
 *     convierten a la hora de Asunción para mostrarlos.
 *  2. Fechas calendario ("2026-08-05"): un día, sin hora — vencimiento de lote,
 *     fecha de un remito. NO se convierten: el 05/08 es el 05/08 en cualquier
 *     zona. Pasarlas por `new Date("2026-08-05")` las interpreta como
 *     medianoche UTC y al mostrarlas en Asunción retroceden al 04/08 21:00,
 *     que es el desfase que se veía en toda la app.
 */

const LOCALE = "es-PY" as const;
const TZ     = "America/Asuncion" as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza el valor a `{ date, timeZone }` listo para `Intl`.
 * Una fecha calendario se ancla en UTC y se formatea en UTC: así se imprime
 * el mismo día que vino, sin corrimiento.
 */
function resolve(value: string | Date): { date: Date; timeZone: string } {
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) {
    const [y, m, d] = value.trim().split("-").map(Number);
    return { date: new Date(Date.UTC(y, m - 1, d)), timeZone: "UTC" };
  }
  return { date: new Date(value), timeZone: TZ };
}

/**
 * API recomendada — el nombre dice qué tipo de valor espera, así el call site
 * documenta su propia intención en vez de reimplementar la conversión:
 *  - `formatDateOnly`:   fecha calendario ("2027-08-15") → "15/08/2027", SIN
 *    tocar zona horaria. También sirve para mostrar solo el día de un
 *    instante real (ej. columna "Fecha" de una factura): el instante se
 *    convierte a America/Asuncion primero, y de ahí se toma el día.
 *  - `formatDateTimePY`: instante real → "15/08/2027 14:30" en America/Asuncion.
 * Son el mismo cuerpo que `fmtDate`/`fmtDateTime` (abajo): esas quedan por
 * compatibilidad con el código ya existente, no reimplementar ninguna de las dos.
 */
export function formatDateOnly(value: string | Date | null | undefined): string {
  return fmtDate(value);
}
export function formatDateTimePY(value: string | Date | null | undefined): string {
  return fmtDateTime(value);
}

/** DD/MM/AAAA */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const { date, timeZone } = resolve(value);
  return date.toLocaleDateString(LOCALE, {
    timeZone,
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  });
}

/**
 * DD/MM/AAAA HH:MM — `hourCycle: "h23"` fuerza 24hs explícito: sin esto, según
 * la versión de ICU del entorno (Node del backend, o del navegador del
 * operador) puede renderizar en 12hs con AM/PM, o la medianoche como "24:00"
 * en vez de "00:00". El objetivo es que la hora se vea igual sin importar
 * dónde corra — la misma razón por la que `timeZone` siempre es explícito.
 */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const { date, timeZone } = resolve(value);
  return date.toLocaleString(LOCALE, {
    timeZone,
    day:    "2-digit",
    month:  "2-digit",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** DD MMM AAAA — para cards y badges */
export function fmtDateLong(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const { date, timeZone } = resolve(value);
  return date.toLocaleDateString(LOCALE, {
    timeZone,
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

/** DD MMM AAAA HH:MM — historial de movimientos */
export function fmtDateTimeLong(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const { date, timeZone } = resolve(value);
  return date.toLocaleString(LOCALE, {
    timeZone,
    day:    "2-digit",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** DD/MM — formato corto para gráficos */
export function fmtDateShort(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const { date, timeZone } = resolve(value);
  return date.toLocaleDateString(LOCALE, {
    timeZone,
    day:   "2-digit",
    month: "2-digit",
  });
}

/** DD MMM — gráficos con mes abreviado */
export function fmtDateMonthShort(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const { date, timeZone } = resolve(value);
  return date.toLocaleDateString(LOCALE, {
    timeZone,
    day:   "2-digit",
    month: "short",
  });
}

/**
 * Día de hoy como "YYYY-MM-DD" **en Asunción** — para prellenar inputs
 * `<input type="date">`. `new Date().toISOString().slice(0,10)` daría el día
 * en UTC, que después de las 21:00 ya es el día siguiente.
 */
export function todayInputValue(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Aritmética de calendario sobre "YYYY-MM-DD". Se ancla en UTC a propósito:
 * sumar/restar días sobre un día calendario no debe depender de husos ni de
 * cambios de horario — el 05/08 menos 1 día es el 04/08, siempre.
 */
export function shiftInputValue(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Días de calendario entre `from` (por defecto, hoy en Asunción) y `value`
 * — ambos "YYYY-MM-DD". Ancla los dos lados en UTC antes de restar, igual
 * que `shiftInputValue`: así "cuántos días faltan" nunca depende de la hora
 * local ni de a qué hora corre el cálculo. Reemplaza al patrón
 * `new Date(fecha); x.setHours(0,0,0,0)` que aparecía repetido (y roto) en
 * varias páginas — mezclar un `Date` anclado en UTC (fecha calendario) con
 * uno anclado en horario local para "hoy" corre el resultado un día.
 */
export function daysUntil(value?: string | null, from: string = todayInputValue()): number | null {
  if (!value) return null;
  const [vy, vm, vd] = value.slice(0, 10).split("-").map(Number);
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const target = Date.UTC(vy, vm - 1, vd);
  const base = Date.UTC(fy, fm - 1, fd);
  return Math.round((target - base) / 86_400_000);
}

/** Primer día del mes de `value` (por defecto, hoy en Asunción). */
export function startOfMonthInputValue(value = todayInputValue()): string {
  return `${value.slice(0, 7)}-01`;
}

/** Lunes de la semana de `value` (por defecto, hoy en Asunción). */
export function startOfWeekInputValue(value = todayInputValue()): string {
  const [y, m, d] = value.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return shiftInputValue(value, -((dow + 6) % 7));
}

/** Número entero con separador de miles */
export function fmtNum(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString(LOCALE);
}

/** Número con unidad de medida: "1.250 UN" */
export function fmtNumUnit(value: number, unit?: string | null): string {
  return `${fmtNum(value)}${unit ? " " + unit : ""}`;
}

/** "Generado: DD/MM/AAAA HH:MM" — pie de reportes */
export function fmtGeneratedAt(): string {
  return `Generado: ${fmtDateTime(new Date())}`;
}
