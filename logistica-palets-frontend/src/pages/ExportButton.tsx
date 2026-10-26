import type { PaginaRespuesta } from "../lib/fetchAllPages";
import { fmtFilas, type useExportCompleto } from "./reportsExport";

type Props<T> = {
  /** Identifica este botón mientras corre, para mostrarle el avance sólo a él. */
  id: string;
  /** Texto normal del botón (" PDF", " Excel", " CSV"). */
  etiqueta: string;
  /** Filas que el servidor dice que hay con los filtros puestos. */
  total: number;
  /** Cómo nombrarlas en el tooltip ("filas", "entradas", "salidas"). */
  nombre: string;
  /** Lector por página del listado — ya con los filtros aplicados. */
  leer: (page: number, limit: number) => Promise<PaginaRespuesta<T>>;
  /** Arma el archivo con TODAS las filas. */
  escribir: (filas: T[]) => void | Promise<void>;
  ctx: ReturnType<typeof useExportCompleto>;
};

/**
 * Botón de exportación de un reporte.
 *
 * Existe para que los siete botones de Reportes no repitan el mismo bloque de
 * `disabled` + `title` + avance: el tooltip dice cuántas filas va a traer, y
 * mientras corre el botón muestra el avance en vez de quedarse mudo.
 */
export default function ExportButton<T>({ id, etiqueta, total, nombre, leer, escribir, ctx }: Props<T>) {
  const { exportando, exportarCompleto, etiquetaExport } = ctx;
  return (
    <button
      className="btn"
      disabled={!!exportando}
      title={`Exportar las ${fmtFilas(total)} ${nombre} del reporte, no sólo esta página`}
      onClick={() => void exportarCompleto(id, leer, escribir)}
    >
      {etiquetaExport(id, etiqueta)}
    </button>
  );
}
