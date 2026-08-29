import { describe, expect, it } from "vitest";
import {
  deselectPalletForExit,
  exitRowError,
  exitRowIsPartial,
  exitRowTotal,
  fefoSuggest,
  palletExitTake,
  selectPalletForExit,
  type ExitPallet,
  type ExitSelection,
} from "./exitFormModel";

const pallets: ExitPallet[] = [
  { id: "p1", code: "L4537-6C-P1", quantity: 275.65 },
  { id: "p2", code: "L4537-6C-P2", quantity: 285.35 },
  { id: "p3", code: "L4537-6C-P3", quantity: 200.55 },
  { id: "p4", code: "L4537-6C-P4", quantity: 238.45 },
];

const empty = (): ExitSelection => ({ selectedIds: new Set(), qtyByPallet: {} });

describe("selectPalletForExit — tildar carga la cantidad completa, editable a menos", () => {
  it("al tildar, el pallet entra con toda su cantidad", () => {
    const sel = selectPalletForExit(empty(), "p1", 275.65);
    expect(sel.selectedIds.has("p1")).toBe(true);
    expect(sel.qtyByPallet.p1).toBe("275,65");
    expect(exitRowTotal(sel)).toBe(275.65);
  });

  it("tildar un segundo pallet no toca al primero (requisito 7)", () => {
    let sel = selectPalletForExit(empty(), "p1", 275.65);
    sel = selectPalletForExit(sel, "p2", 285.35);
    expect(sel.qtyByPallet.p1).toBe("275,65");
    expect(sel.qtyByPallet.p2).toBe("285,35");
    expect(exitRowTotal(sel)).toBe(561);
  });

  it("no muta la selección de entrada", () => {
    const base = empty();
    selectPalletForExit(base, "p1", 275.65);
    expect(base.selectedIds.size).toBe(0);
    expect(base.qtyByPallet).toEqual({});
  });
});

describe("editar la cantidad de un pallet — el total se recalcula solo (requisito 3)", () => {
  it("bajar P1 a 200 deja el total en 485,35, sin tocar P2 ni la selección", () => {
    let sel = selectPalletForExit(empty(), "p1", 275.65);
    sel = selectPalletForExit(sel, "p2", 285.35);
    // El operador edita solo el campo de P1:
    sel = { ...sel, qtyByPallet: { ...sel.qtyByPallet, p1: "200" } };
    expect(exitRowTotal(sel)).toBe(485.35);
    expect(sel.qtyByPallet.p2).toBe("285,35");
    expect([...sel.selectedIds].sort()).toEqual(["p1", "p2"]);
  });

  it("cantidades enteras: 300 + 238 = 538 exacto (requisito 10)", () => {
    const sel: ExitSelection = {
      selectedIds: new Set(["a", "b"]),
      qtyByPallet: { a: "300", b: "238" },
    };
    expect(exitRowTotal(sel)).toBe(538);
  });

  it("0,1 + 0,2 = 0,3 (sin residuo de coma flotante)", () => {
    const sel: ExitSelection = {
      selectedIds: new Set(["a", "b"]),
      qtyByPallet: { a: "0,1", b: "0,2" },
    };
    expect(exitRowTotal(sel)).toBe(0.3);
  });

  it("acepta coma o punto en el campo del pallet", () => {
    expect(palletExitTake({ x: "200,66" }, "x")).toBe(200.66);
    expect(palletExitTake({ x: "200.66" }, "x")).toBe(200.66);
    expect(palletExitTake({ x: "" }, "x")).toBe(0);
    expect(palletExitTake({}, "x")).toBe(0);
  });
});

describe("deselectPalletForExit — saca solo ese pallet", () => {
  it("destildar P1 lo quita y borra su cantidad; P2 queda igual", () => {
    let sel = selectPalletForExit(empty(), "p1", 275.65);
    sel = selectPalletForExit(sel, "p2", 285.35);
    sel = deselectPalletForExit(sel, "p1");
    expect(sel.selectedIds.has("p1")).toBe(false);
    expect(sel.qtyByPallet.p1).toBeUndefined();
    expect(sel.selectedIds.has("p2")).toBe(true);
    expect(sel.qtyByPallet.p2).toBe("285,35");
    expect(exitRowTotal(sel)).toBe(285.35);
  });
});

describe("exitRowIsPartial", () => {
  it("false si todos los seleccionados salen completos", () => {
    let sel = selectPalletForExit(empty(), "p1", 275.65);
    sel = selectPalletForExit(sel, "p2", 285.35);
    expect(exitRowIsPartial(sel, pallets)).toBe(false);
  });

  it("true si algún pallet sale parcial", () => {
    let sel = selectPalletForExit(empty(), "p1", 275.65);
    sel = { ...sel, qtyByPallet: { p1: "200" } };
    expect(exitRowIsPartial(sel, pallets)).toBe(true);
  });
});

describe("exitRowError — requisito 8", () => {
  it("null cuando cada pallet retira > 0 y <= su stock", () => {
    let sel = selectPalletForExit(empty(), "p1", 275.65);
    sel = { ...sel, qtyByPallet: { p1: "200" } };
    expect(exitRowError(sel, pallets)).toBeNull();
  });

  it("pallet seleccionado sin cantidad → error con el código", () => {
    const sel: ExitSelection = { selectedIds: new Set(["p1"]), qtyByPallet: { p1: "" } };
    expect(exitRowError(sel, pallets)).toContain("L4537-6C-P1");
    expect(exitRowError(sel, pallets)).toContain("sin cantidad");
  });

  it("pallet que pide más que su stock → error con el código y el disponible", () => {
    const sel: ExitSelection = { selectedIds: new Set(["p3"]), qtyByPallet: { p3: "300" } };
    const err = exitRowError(sel, pallets);
    expect(err).toContain("L4537-6C-P3");
    expect(err).toContain("200,55");
  });

  it("un residuo de coma flotante no cuenta como exceso (retirar exactamente el stock)", () => {
    const sel: ExitSelection = { selectedIds: new Set(["p1"]), qtyByPallet: { p1: "275,65" } };
    expect(exitRowError(sel, pallets)).toBeNull();
  });
});

describe("fefoSuggest — atajo explícito (solo con clic)", () => {
  it("438 sobre [300, 238] → selecciona ambos y reparte 300 + 138", () => {
    const twoPallets: ExitPallet[] = [
      { id: "a", code: "A", quantity: 300 },
      { id: "b", code: "B", quantity: 238 },
    ];
    const sel = fefoSuggest(twoPallets, 438);
    expect([...sel.selectedIds].sort()).toEqual(["a", "b"]);
    expect(sel.qtyByPallet).toEqual({ a: "300", b: "138" });
    expect(exitRowTotal(sel)).toBe(438);
  });

  it("cubre con el primero si alcanza, sin tocar el resto", () => {
    const sel = fefoSuggest(pallets, 200);
    expect([...sel.selectedIds]).toEqual(["p1"]);
    expect(sel.qtyByPallet.p1).toBe("200");
  });

  it("reparto decimal exacto: 500 sobre la foto → P1 completo + P2 parcial", () => {
    const sel = fefoSuggest(pallets, 500);
    expect([...sel.selectedIds].sort()).toEqual(["p1", "p2"]);
    expect(sel.qtyByPallet.p1).toBe("275,65");
    expect(sel.qtyByPallet.p2).toBe("224,35");
    expect(exitRowTotal(sel)).toBe(500);
  });

  it("target <= 0 → selección vacía", () => {
    expect(fefoSuggest(pallets, 0).selectedIds.size).toBe(0);
    expect(fefoSuggest(pallets, -5).selectedIds.size).toBe(0);
  });
});
