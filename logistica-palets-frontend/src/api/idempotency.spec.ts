/**
 * Claves de idempotencia de un envío que manda varias operaciones.
 *
 * El caso real: una diferencia de inventario que toca dos depósitos manda dos
 * solicitudes. Si una sale bien y la otra falla, la que salió bien se saca del
 * carrito y se reintenta sólo el resto. Numerando las claves por posición
 * (`base-0`, `base-1`, …) la que antes era la 1 pasa a ser la 0 y reusa la
 * clave de una operación YA completada: el backend contesta 422 "La clave de
 * idempotencia ya se usó para otra operación" y el operador no entiende por qué.
 */
import { describe, expect, it } from "vitest";
import { claveDerivada, nuevaClaveIdempotencia } from "./idempotency";

const BASE = "11111111-2222-4333-8444-555555555555";

const ajuste = (warehouseId: string, productId: string) => ({
  type: "ADJUSTMENT_OUT",
  reason: "DIFERENCIA_INVENTARIO",
  warehouseId,
  lines: [{ productId, palletItems: [{ palletId: "p1", quantity: 1 }] }],
});

describe("claveDerivada", () => {
  it("el mismo contenido da la misma clave — el doble clic sigue deduplicado", () => {
    const a = ajuste("dep-1", "mat-1");
    expect(claveDerivada(BASE, a)).toBe(claveDerivada(BASE, { ...a }));
  });

  it("contenidos distintos dan claves distintas", () => {
    expect(claveDerivada(BASE, ajuste("dep-1", "mat-1")))
      .not.toBe(claveDerivada(BASE, ajuste("dep-2", "mat-1")));
  });

  /** La regresión: antes esto rompía porque la clave salía de la posición. */
  it("una operación conserva su clave aunque su hermana desaparezca del envío", () => {
    const primera = ajuste("dep-1", "mat-1");
    const segunda = ajuste("dep-2", "mat-2");

    // Envío 1: las dos juntas. Envío 2 (reintento): sólo la segunda, porque la
    // primera ya se creó y salió del carrito.
    const antes = [primera, segunda].map((b) => claveDerivada(BASE, b));
    const despues = [segunda].map((b) => claveDerivada(BASE, b));

    expect(despues[0]).toBe(antes[1]);          // la segunda sigue siendo la segunda
    expect(despues[0]).not.toBe(antes[0]);      // y nunca toma la clave de la primera
  });

  it("dos bases distintas nunca comparten clave aunque el contenido sea igual", () => {
    const a = ajuste("dep-1", "mat-1");
    expect(claveDerivada(BASE, a)).not.toBe(claveDerivada(nuevaClaveIdempotencia(), a));
  });

  it("la clave entra en la columna del backend (varchar 200)", () => {
    const grande = ajuste("dep-1", "mat-1");
    grande.lines = Array.from({ length: 200 }, (_, i) => ({
      productId: `mat-${i}`,
      palletItems: [{ palletId: `p-${i}`, quantity: i }],
    }));
    expect(claveDerivada(BASE, grande).length).toBeLessThanOrEqual(200);
  });

  it("no se cae con un contenido que no es serializable", () => {
    expect(() => claveDerivada(BASE, undefined)).not.toThrow();
  });
});

describe("nuevaClaveIdempotencia", () => {
  it("genera claves distintas", () => {
    const claves = new Set(Array.from({ length: 50 }, () => nuevaClaveIdempotencia()));
    expect(claves.size).toBe(50);
  });
});
