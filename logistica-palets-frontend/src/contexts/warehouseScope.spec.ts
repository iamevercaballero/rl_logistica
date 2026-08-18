/**
 * Reglas del Depósito Activo en el frontend.
 *
 * Cubren las dos formas en que un cambio de depósito puede filtrar datos del
 * anterior: quedarse con un depósito que ya no corresponde, o servir de la
 * caché de TanStack Query algo que se pidió para otro depósito.
 */
import { describe, expect, it } from "vitest";
import { isWarehouseScopedKey, resolveActiveWarehouseId } from "./warehouseScope";

const WH_01 = "11111111-1111-1111-1111-111111111111";
const WH_02 = "22222222-2222-2222-2222-222222222222";
const WH_03 = "33333333-3333-3333-3333-333333333333";

describe("resolveActiveWarehouseId — el guardado es preferencia, no autorización", () => {
  it("respeta el depósito guardado si sigue permitido", () => {
    expect(resolveActiveWarehouseId(WH_02, [WH_01, WH_02])).toBe(WH_02);
  });

  it("descarta el guardado si el usuario perdió el acceso y cae al primero permitido", () => {
    // Caso: un ADMIN le revocó el acceso al 02 mientras la sesión estaba abierta.
    expect(resolveActiveWarehouseId(WH_02, [WH_01])).toBe(WH_01);
  });

  it("descarta un localStorage manipulado con un depósito que no existe", () => {
    expect(resolveActiveWarehouseId("no-soy-un-deposito", [WH_01, WH_03])).toBe(WH_01);
  });

  it("sin nada guardado usa el primero permitido", () => {
    expect(resolveActiveWarehouseId(null, [WH_03, WH_01])).toBe(WH_03);
  });

  it("sin depósitos permitidos no hay activo (el usuario no puede operar)", () => {
    expect(resolveActiveWarehouseId(WH_01, [])).toBeNull();
    expect(resolveActiveWarehouseId(null, [])).toBeNull();
  });

  it("un OPERATOR con un solo depósito siempre resuelve a ese", () => {
    expect(resolveActiveWarehouseId(WH_02, [WH_01])).toBe(WH_01);
    expect(resolveActiveWarehouseId(null, [WH_01])).toBe(WH_01);
  });
});

describe("isWarehouseScopedKey — qué se descarta al cambiar de depósito", () => {
  it("descarta todo lo operativo", () => {
    const operativas = [
      ["kpis", WH_01, "today"],
      ["stock", "report", WH_01],
      ["movements", "report", WH_01, { page: 1 }],
      ["lots", WH_01],
      ["pallets", "kpis", WH_01],
      ["locations", "map", WH_01],
      ["alerts", "active", WH_01],
      ["adjustments", "BORRADOR"],
      ["reports", "freshness", WH_01],
      ["bitacora", WH_01, {}],
      ["documents", WH_01],
    ];
    for (const key of operativas) {
      expect(isWarehouseScopedKey(key)).toBe(true);
    }
  });

  it("conserva los catálogos maestros, que no dependen del depósito", () => {
    // Volver a pedirlos al cambiar de depósito sería trabajo al pedo: son los
    // mismos productos/usuarios/transportes en los dos depósitos.
    const maestros = [
      ["products"],
      ["users", "active"],
      ["transports"],
      ["suppliers"],
      ["destinations"],
      ["warehouses", "allowed", "user-1"],
    ];
    for (const key of maestros) {
      expect(isWarehouseScopedKey(key)).toBe(false);
    }
  });

  it("una key vacía o no-string no se considera operativa", () => {
    expect(isWarehouseScopedKey([])).toBe(false);
    expect(isWarehouseScopedKey([{ scope: "kpis" }])).toBe(false);
  });

  it("los datos del depósito anterior nunca sobreviven al cambio", () => {
    // Simula el cache de TanStack: al cambiar de depósito se remueve todo lo
    // que matchee, así no queda nada del 01 para mostrar mientras carga el 02.
    const cache = [
      ["kpis", WH_01, "today"],
      ["stock", "report", WH_01],
      ["products"],
      ["transports"],
    ];
    const sobreviven = cache.filter((key) => !isWarehouseScopedKey(key));

    expect(sobreviven).toEqual([["products"], ["transports"]]);
    expect(sobreviven.some((key) => key.includes(WH_01))).toBe(false);
  });
});
