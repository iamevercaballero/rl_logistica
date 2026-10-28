import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMovements } from "../api/movements";
import { getMovementsReport } from "../api/reports";
import { paginaEntradas, paginaMovimientos, paginaSalidas } from "./reportsExport";

vi.mock("../api/movements", () => ({ getMovements: vi.fn() }));
vi.mock("../api/reports", () => ({ getMovementsReport: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("exportaciones con búsqueda libre", () => {
  it("Entradas mantiene búsqueda, fechas y depósito en cada página exportada", async () => {
    const read = paginaEntradas("deposito-a", { search: "  Z0513  ", dateFrom: "2026-10-01", dateTo: "2026-10-27" });
    await read(1, 100);
    await read(2, 100);
    for (const [params] of vi.mocked(getMovements).mock.calls) {
      expect(params).toMatchObject({ type: "ENTRY", search: "Z0513", warehouseId: "deposito-a", dateFrom: "2026-10-01", dateTo: "2026-10-27", limit: 100 });
    }
    expect(vi.mocked(getMovements).mock.calls.map(([p]) => p.page)).toEqual([1, 2]);
  });

  it("Salidas combina búsqueda con el estado de Documento Material", async () => {
    await paginaSalidas("deposito-b", { search: "  azucar  ", dateFrom: "", dateTo: "", documentoMaterialStatus: "PENDING" })(3, 100);
    expect(getMovements).toHaveBeenCalledWith(expect.objectContaining({ type: "EXIT", search: "azucar", documentoMaterialStatus: "PENDING", warehouseId: "deposito-b", page: 3 }));
  });

  it("Historial mantiene búsqueda y tipo de movimiento", async () => {
    await paginaMovimientos("deposito-a", { productId: "", search: "  prov-aaa  ", dateFrom: "", dateTo: "", type: "TRANSFER" })(1, 100);
    expect(getMovementsReport).toHaveBeenCalledWith(expect.objectContaining({ search: "prov-aaa", type: "TRANSFER", warehouseId: "deposito-a" }));
  });

  it("limpiar la búsqueda elimina el filtro en la exportación", async () => {
    await paginaEntradas("deposito-a", { search: "  ", dateFrom: "", dateTo: "" })(1, 100);
    expect(getMovements).toHaveBeenCalledWith(expect.objectContaining({ search: undefined }));
  });
});
