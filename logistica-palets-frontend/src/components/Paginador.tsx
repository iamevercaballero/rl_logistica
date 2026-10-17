/**
 * Pie de paginación de los listados largos.
 *
 * Existe porque Materiales metía las 2.100 filas del catálogo en el DOM de una
 * sola vez —31.728 nodos y 250.000 px de alto—, y Lotes y Palets crecen más
 * rápido que el catálogo en cuanto el depósito opera.
 */
export type PaginaInfo = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function Paginador({
  info,
  onPagina,
  cargando = false,
  etiqueta = "registros",
}: {
  info: PaginaInfo;
  onPagina: (pagina: number) => void;
  cargando?: boolean;
  /** Qué se está listando, para el texto: "1–50 de 2.102 materiales". */
  etiqueta?: string;
}) {
  const { total, page, limit, totalPages } = info;
  if (total === 0) return null;

  const desde = (page - 1) * limit + 1;
  const hasta = Math.min(page * limit, total);
  const fmt = (n: number) => n.toLocaleString("es-PY");

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap", padding: "12px 4px 4px",
        borderTop: "1px solid var(--border)", marginTop: 8,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {fmt(desde)}–{fmt(hasta)} de <strong style={{ color: "var(--text)" }}>{fmt(total)}</strong> {etiqueta}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="btn"
          disabled={page <= 1 || cargando}
          onClick={() => onPagina(page - 1)}
          aria-label="Página anterior"
        >
          ← Anterior
        </button>
        <span style={{ fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums", minWidth: 110, textAlign: "center" }}>
          Página {fmt(page)} de {fmt(totalPages)}
        </span>
        <button
          className="btn"
          disabled={page >= totalPages || cargando}
          onClick={() => onPagina(page + 1)}
          aria-label="Página siguiente"
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}
