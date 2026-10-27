/**
 * Reparto de una diferencia de inventario entre los palets de un lote.
 *
 * El faltante ya tenía este reparto y el sobrante no: sólo dejaba elegir UN
 * palet existente, o registrar uno nuevo. En el depósito no siempre se sabe en
 * qué palet sobró —se cuenta el lote entero—, así que el sobrante necesita lo
 * mismo que el faltante.
 *
 * Los casos del faltante fijan el comportamiento que ya andaba, para que
 * generalizar la tabla no lo cambie sin que se note.
 */
import { describe, expect, it } from "vitest";
import {
  autoDistributeShortage,
  autoDistributeSurplus,
  computeShortageAllocation,
  computeSurplusAllocation,
  type CandidatePallet,
} from "./allocation";

const palet = (id: string, quantity: number): CandidatePallet => ({
  id, code: `P-${id}`, lotId: "lote-1", quantity, status: "AVAILABLE", lotCode: "LOTE-1",
});

/** Lo que la tabla muestra por palet: el conteo físico, como texto. */
const fisico = (pares: Record<string, string>) => pares;

describe("faltante — lo que ya hacía", () => {
  it("toma de cada palet lo que falta respecto de su conteo físico", () => {
    const pallets = [palet("a", 100), palet("b", 50)];
    const { palletItems, total } = computeShortageAllocation(pallets, fisico({ a: "80", b: "45" }));

    expect(palletItems).toEqual([
      { palletId: "a", quantity: 20 },
      { palletId: "b", quantity: 5 },
    ]);
    expect(total).toBe(25);
  });

  it("un palet contado igual o de más no aporta al faltante", () => {
    const pallets = [palet("a", 100), palet("b", 50)];
    const { palletItems } = computeShortageAllocation(pallets, fisico({ a: "100", b: "60" }));
    expect(palletItems).toEqual([]);
  });

  it("sin conteo cargado se asume que el palet está completo", () => {
    expect(computeShortageAllocation([palet("a", 100)], fisico({})).total).toBe(0);
  });

  it("el automático vacía en orden FEFO: el primero entero antes de tocar el segundo", () => {
    const pallets = [palet("a", 100), palet("b", 50)];
    const { physicalByPallet, covered } = autoDistributeShortage(pallets, 120);

    expect(physicalByPallet).toEqual({ a: "0", b: "30" });
    expect(covered).toBe(120);
  });

  it("si los palets no alcanzan, informa cuánto se pudo cubrir", () => {
    const { covered } = autoDistributeShortage([palet("a", 10)], 40);
    expect(covered).toBe(10);
  });

  it("respeta los 3 decimales sin arrastrar residuos de coma flotante", () => {
    const { total } = computeShortageAllocation([palet("a", 0.3)], fisico({ a: "0,1" }));
    expect(total).toBe(0.2);
  });
});

describe("sobrante — el reparto que faltaba", () => {
  it("agrega a cada palet lo que sobra respecto de su conteo físico", () => {
    const pallets = [palet("a", 100), palet("b", 50)];
    const { palletItems, total } = computeSurplusAllocation(pallets, fisico({ a: "110", b: "55" }));

    expect(palletItems).toEqual([
      { palletId: "a", quantity: 10 },
      { palletId: "b", quantity: 5 },
    ]);
    expect(total).toBe(15);
  });

  it("un palet contado igual o de menos no aporta al sobrante", () => {
    const pallets = [palet("a", 100), palet("b", 50)];
    const { palletItems } = computeSurplusAllocation(pallets, fisico({ a: "100", b: "40" }));
    expect(palletItems).toEqual([]);
  });

  /**
   * No hay un FEFO del sobrante: si se contó el lote entero, nadie sabe de qué
   * palet salieron las unidades de más. Repartir en proporción a lo que cada
   * uno ya tiene no inventa que sobró en uno en particular.
   */
  it("el automático reparte en proporción al stock de cada palet", () => {
    const pallets = [palet("a", 100), palet("b", 50)];
    const { physicalByPallet, covered } = autoDistributeSurplus(pallets, 30);

    expect(physicalByPallet).toEqual({ a: "120", b: "60" });
    expect(covered).toBe(30);
  });

  it("el resto de la división no se pierde: el total repartido es exacto", () => {
    const pallets = [palet("a", 10), palet("b", 10), palet("c", 10)];
    const { physicalByPallet, covered } = autoDistributeSurplus(pallets, 10);

    const { total } = computeSurplusAllocation(pallets, physicalByPallet);
    expect(total).toBe(10);
    expect(covered).toBe(10);
  });

  it("con un solo palet va todo ahí", () => {
    expect(autoDistributeSurplus([palet("a", 7)], 3).physicalByPallet).toEqual({ a: "10" });
  });

  it("palets vacíos: reparte igual, en partes iguales", () => {
    const { physicalByPallet } = autoDistributeSurplus([palet("a", 0), palet("b", 0)], 10);
    const { total } = computeSurplusAllocation([palet("a", 0), palet("b", 0)], physicalByPallet);
    expect(total).toBe(10);
  });

  it("sin palets no reparte nada, en vez de romperse", () => {
    expect(autoDistributeSurplus([], 10)).toEqual({ physicalByPallet: {}, covered: 0 });
  });
});
