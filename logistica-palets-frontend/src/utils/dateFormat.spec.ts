/**
 * Regresión del bug reportado: un lote cargado con vencimiento 15/08/2027
 * aparecía como 14/08/2027 en la Nota de Entrada (y en otras vistas). Causa:
 * `new Date("2027-08-15")` se interpreta como medianoche UTC; formatearlo con
 * `timeZone: "America/Asuncion"` (UTC-3/-4) lo retrocede al día anterior.
 *
 * Estos tests no reimportan la lógica interna del módulo (no hay nada que
 * mockear: son funciones puras basadas en `Intl`), y para los casos de
 * timestamps calculan el resultado esperado de forma independiente — no
 * comparan el código contra sí mismo.
 */
import { describe, expect, it } from "vitest";
import {
  daysUntil,
  fmtDate,
  fmtDateLong,
  fmtDateMonthShort,
  fmtDateShort,
  fmtDateTime,
  fmtDateTimeLong,
  formatDateOnly,
  formatDateTimePY,
  shiftInputValue,
  startOfMonthInputValue,
  startOfWeekInputValue,
  todayInputValue,
} from "./dateFormat";

const TZ = "America/Asuncion";

/** Hora de pared en Asunción de un instante — oráculo independiente, no usa `resolve()` del módulo. */
function wallClockInAsuncion(iso: string): { fecha: string; hora: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const pick = (t: string) => parts.find((p) => p.type === t)!.value;
  return { fecha: `${pick("year")}-${pick("month")}-${pick("day")}`, hora: `${pick("hour")}:${pick("minute")}` };
}

/** Offset (minutos) de Asunción respecto a UTC en un instante dado — mismo método que common/date.ts del backend, reimplementado acá para no depender de él. */
function asuncionOffsetMinutesAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asIfUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
  return (asIfUtc - instant.getTime()) / 60_000;
}

describe("fecha calendario — formatDateOnly / fmtDate (nunca cruzan zona horaria)", () => {
  it("2027-08-15 se muestra siempre 15/08/2027 — el caso reportado", () => {
    expect(formatDateOnly("2027-08-15")).toBe("15/08/2027");
    expect(fmtDate("2027-08-15")).toBe("15/08/2027");
  });

  it("2026-08-10 se muestra siempre 10/08/2026", () => {
    expect(formatDateOnly("2026-08-10")).toBe("10/08/2026");
  });

  it("ningún día del año se corre, incluidos bordes de mes/año y bisiesto", () => {
    const dias = [
      "2026-01-01", "2026-02-28", "2026-03-01", "2026-06-30",
      "2026-08-15", "2026-12-31", "2027-08-15", "2028-02-29",
    ];
    for (const dia of dias) {
      const [y, m, d] = dia.split("-");
      expect(formatDateOnly(dia)).toBe(`${d}/${m}/${y}`);
    }
  });

  it("documenta el bug real para que no se reintroduzca: new Date(fecha) + timeZone explícita SÍ se corre", () => {
    const patronRoto = new Date("2027-08-15").toLocaleDateString("es-PY", {
      timeZone: "America/Asuncion",
      day: "2-digit", month: "2-digit", year: "numeric",
    });
    expect(patronRoto).toBe("14/08/2027"); // el bug tal cual aparecía en PrintDocument.tsx, Lots.tsx, etc.
    expect(formatDateOnly("2027-08-15")).toBe("15/08/2027");
    expect(formatDateOnly("2027-08-15")).not.toBe(patronRoto);
  });

  it("null / undefined / vacío → \"-\"", () => {
    expect(formatDateOnly(null)).toBe("-");
    expect(formatDateOnly(undefined)).toBe("-");
    expect(formatDateOnly("")).toBe("-");
  });

  it("formatDateOnly y fmtDate son la misma función (alias) — un solo punto de verdad", () => {
    for (const v of ["2027-08-15", "2026-01-01", null, undefined]) {
      expect(formatDateOnly(v)).toBe(fmtDate(v));
    }
  });
});

describe("timestamps reales — formatDateTimePY / fmtDateTime (siempre America/Asuncion)", () => {
  it("un instante UTC se muestra con la fecha y hora de pared correctas de Paraguay", () => {
    for (const iso of ["2026-08-05T14:30:00.000Z", "2026-01-01T00:00:00.000Z", "2026-06-15T12:00:00.000Z"]) {
      const { fecha, hora } = wallClockInAsuncion(iso);
      const [y, m, d] = fecha.split("-");
      expect(formatDateTimePY(iso)).toBe(`${d}/${m}/${y}, ${hora}`);
    }
  });

  it("borde 00:00 en Paraguay: un minuto después de medianoche sigue siendo el mismo día", () => {
    const offsetMin = asuncionOffsetMinutesAt(new Date("2026-08-10T12:00:00Z"));
    const medianocheAsuncion = new Date(Date.UTC(2026, 7, 10, 0, 0, 0) - offsetMin * 60_000);
    const unMinutoDespues = new Date(medianocheAsuncion.getTime() + 60_000);
    expect(formatDateTimePY(unMinutoDespues.toISOString())).toBe("10/08/2026, 00:01");
  });

  it("borde 23:59 en Paraguay: un minuto antes de medianoche NO adelanta al día siguiente", () => {
    const offsetMin = asuncionOffsetMinutesAt(new Date("2026-08-11T12:00:00Z"));
    const medianocheSiguiente = new Date(Date.UTC(2026, 7, 11, 0, 0, 0) - offsetMin * 60_000);
    const unMinutoAntes = new Date(medianocheSiguiente.getTime() - 60_000);
    expect(formatDateTimePY(unMinutoAntes.toISOString())).toBe("10/08/2026, 23:59");
  });

  it("null / undefined / vacío → \"-\"", () => {
    expect(formatDateTimePY(null)).toBe("-");
    expect(formatDateTimePY(undefined)).toBe("-");
  });

  it("formatDateTimePY y fmtDateTime son la misma función (alias)", () => {
    const iso = "2026-08-05T14:30:00.000Z";
    expect(formatDateTimePY(iso)).toBe(fmtDateTime(iso));
  });
});

describe("misma operación, misma fecha en todas las vistas", () => {
  it("una fecha calendario se ve igual en las variantes larga y corta (sin corrimiento en ninguna)", () => {
    // fmtDate / fmtDateLong / fmtDateShort son las que consumen Movimientos, Reportes,
    // Bitácora, la Nota de Entrada/Salida y las Etiquetas — deben coincidir en el día.
    expect(fmtDate("2027-08-15")).toBe("15/08/2027");
    expect(fmtDateLong("2027-08-15")).toBe("15 ago. 2027");
    expect(fmtDateShort("2027-08-15")).toBe("15/8");
    expect(fmtDateMonthShort("2027-08-15")).toBe("15-ago.");
  });

  it("un timestamp se ve igual en las variantes con y sin nombre de mes", () => {
    const iso = "2026-08-05T14:30:00.000Z";
    const { fecha, hora } = wallClockInAsuncion(iso);
    const [y, m, d] = fecha.split("-");
    expect(fmtDateTime(iso)).toBe(`${d}/${m}/${y}, ${hora}`);
    expect(fmtDateTimeLong(iso)).toContain(`${d} `);
    expect(fmtDateTimeLong(iso)).toContain(hora);
  });
});

describe("daysUntil — aritmética de calendario sin desplazamiento", () => {
  // El patrón viejo que tenían Lots.tsx, Locations.tsx y Dashboard.tsx —
  // `new Date(fechaCalendario); x.setHours(0,0,0,0)` — ancla la fecha en UTC
  // pero "hoy" en el horario LOCAL del proceso que ejecuta el código. Cuánto
  // se desvía depende de en qué huso corra ese proceso (navegador del
  // operador, contenedor del backend, etc.), así que no es reproducible de
  // forma determinística acá — por eso `daysUntil` no ancla nada en horario
  // local: todo el cálculo pasa por Date.UTC de punta a punta (ver abajo).
  it("no depende del huso del proceso: todo el cálculo es UTC de punta a punta", () => {
    expect(daysUntil("2026-08-11", "2026-08-10")).toBe(1);
  });

  it("cuenta los días correctamente en ambas direcciones", () => {
    expect(daysUntil("2026-08-15", "2026-08-10")).toBe(5);
    expect(daysUntil("2026-08-05", "2026-08-10")).toBe(-5);
    expect(daysUntil("2026-08-10", "2026-08-10")).toBe(0);
  });

  it("cruza correctamente un borde de mes y de año", () => {
    expect(daysUntil("2026-09-01", "2026-08-31")).toBe(1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("null / undefined → null (no lanza ni devuelve NaN)", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });

  it("usa hoy-en-Asunción como base por defecto", () => {
    expect(daysUntil(todayInputValue())).toBe(0);
  });
});

describe("todayInputValue / shiftInputValue / startOf*InputValue", () => {
  it("todayInputValue tiene formato YYYY-MM-DD y coincide con el día de Asunción", () => {
    expect(todayInputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const esperado = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    expect(todayInputValue()).toBe(esperado);
  });

  it("shiftInputValue suma y resta días de calendario sin depender de la hora", () => {
    expect(shiftInputValue("2026-08-10", 1)).toBe("2026-08-11");
    expect(shiftInputValue("2026-08-10", -1)).toBe("2026-08-09");
    expect(shiftInputValue("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftInputValue("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("startOfMonthInputValue devuelve el día 01 del mes dado", () => {
    expect(startOfMonthInputValue("2026-08-15")).toBe("2026-08-01");
  });

  it("startOfWeekInputValue devuelve el lunes de esa semana", () => {
    // 2026-08-10 es lunes.
    expect(startOfWeekInputValue("2026-08-10")).toBe("2026-08-10");
    expect(startOfWeekInputValue("2026-08-15")).toBe("2026-08-10"); // sábado → mismo lunes
    expect(startOfWeekInputValue("2026-08-16")).toBe("2026-08-10"); // domingo → mismo lunes
  });
});
