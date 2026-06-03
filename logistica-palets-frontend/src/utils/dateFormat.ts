/**
 * Utilidades de formato de fechas para RL Logística.
 *
 * SIEMPRE usan:
 *  - locale  "es-PY"  (Paraguay)
 *  - timeZone "America/Asuncion"  (UTC-4 / UTC-3 DST)
 *
 * Esto garantiza consistencia independientemente de la zona horaria
 * del servidor, del contenedor Docker o del browser del operador.
 */

const LOCALE = "es-PY" as const;
const TZ     = "America/Asuncion" as const;

/** DD/MM/AAAA */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  });
}

/** DD/MM/AAAA HH:MM */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(LOCALE, {
    timeZone: TZ,
    day:    "2-digit",
    month:  "2-digit",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

/** DD MMM AAAA — para cards y badges */
export function fmtDateLong(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

/** DD MMM AAAA HH:MM — historial de movimientos */
export function fmtDateTimeLong(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(LOCALE, {
    timeZone: TZ,
    day:    "2-digit",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

/** DD/MM — formato corto para gráficos */
export function fmtDateShort(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day:   "2-digit",
    month: "2-digit",
  });
}

/** DD MMM — gráficos con mes abreviado */
export function fmtDateMonthShort(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day:   "2-digit",
    month: "short",
  });
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
