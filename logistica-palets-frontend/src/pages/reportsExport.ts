import { useState } from "react";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { fetchAllPages, type PaginaRespuesta } from "../lib/fetchAllPages";
import { getMovements, type MovementType } from "../api/movements";
import { getMovementsReport } from "../api/reports";

/** Cantidad de filas en formato regional, para los avisos del export. */
export const fmtFilas = (n: number) => n.toLocaleString("es-PY");

/**
 * Exportar el reporte ENTERO, no la página que se está viendo.
 *
 * Los botones de PDF/Excel/CSV de Reportes recibían `…Q.data.data` —la página
 * actual—, así que un reporte de varias páginas salía partido en un archivo por
 * página. Esto recorre el listado completo con los mismos filtros aplicados y
 * se lo pasa de una sola vez al exportador, que no cambia: sigue recibiendo
 * filas y armando el archivo.
 *
 * Vive fuera de `Reports.tsx` porque ese archivo ya estaba contra el tope de
 * líneas del linter.
 */
export function useExportCompleto() {
  const { toast } = useToast();
  const [exportando, setExportando] = useState<{ id: string; cargadas: number; total: number } | null>(null);

  async function exportarCompleto<T>(
    id: string,
    fetchPage: (page: number, limit: number) => Promise<PaginaRespuesta<T>>,
    escribir: (filas: T[]) => void | Promise<void>,
  ) {
    setExportando({ id, cargadas: 0, total: 0 });
    try {
      const { rows, total, truncado } = await fetchAllPages(fetchPage, {
        onProgress: (cargadas, t) => setExportando({ id, cargadas, total: t }),
      });
      if (rows.length === 0) {
        toast.error("No hay filas para exportar con esos filtros.");
        return;
      }
      await escribir(rows);
      // El tope se avisa: un archivo recortado en silencio es peor que uno que
      // no sale, porque nadie se entera de lo que falta.
      if (truncado) {
        toast.error(
          `Se exportaron las primeras ${fmtFilas(rows.length)} de ${fmtFilas(total)} filas. ` +
          "Acotá el rango de fechas para bajar el resto.",
        );
      } else {
        toast.success(`${fmtFilas(rows.length)} ${rows.length === 1 ? "fila exportada" : "filas exportadas"}.`);
      }
    } catch (err) {
      toast.error(getFriendlyApiError(err));
    } finally {
      setExportando(null);
    }
  }

  /** Texto del botón mientras se recorre el listado. */
  const etiquetaExport = (id: string, normal: string) =>
    exportando?.id === id
      ? exportando.total > 0
        ? `${fmtFilas(exportando.cargadas)}/${fmtFilas(exportando.total)}…`
        : "Generando…"
      : normal;

  return { exportando, exportarCompleto, etiquetaExport };
}

/*
 * Lectores por página de los tres reportes paginados. Repiten los filtros de su
 * query: el export tiene que traer exactamente lo que el usuario está mirando,
 * pero completo.
 */

export const paginaMovimientos = (
  warehouseId: string | undefined,
  f: { productId: string; type: string; dateFrom: string; dateTo: string; search: string },
) => (page: number, limit: number) => getMovementsReport({
  page, limit, warehouseId,
  productId: f.productId || undefined,
  // El filtro de la pantalla es un `string` (viene de un `<select>`); vacío
  // significa "todos los tipos".
  type:      (f.type || undefined) as MovementType | undefined,
  dateFrom:  f.dateFrom || undefined,
  dateTo:    f.dateTo   || undefined,
  search:    f.search.trim() || undefined,
});

export const paginaEntradas = (
  warehouseId: string | undefined,
  f: { productId?: string; search?: string; dateFrom: string; dateTo: string },
) => (page: number, limit: number) => getMovements({
  type: "ENTRY", page, limit, warehouseId,
  productId: f.productId || undefined,
  search:    f.search?.trim() || undefined,
  dateFrom:  f.dateFrom  || undefined,
  dateTo:    f.dateTo    || undefined,
});

export const paginaSalidas = (
  warehouseId: string | undefined,
  f: { productId?: string; search?: string; dateFrom: string; dateTo: string; documentoMaterialStatus: string },
) => (page: number, limit: number) => getMovements({
  type: "EXIT", page, limit, warehouseId,
  productId: f.productId || undefined,
  search:    f.search?.trim() || undefined,
  dateFrom:  f.dateFrom  || undefined,
  dateTo:    f.dateTo    || undefined,
  documentoMaterialStatus: (f.documentoMaterialStatus || undefined) as "PENDING" | "COMPLETED" | undefined,
});
