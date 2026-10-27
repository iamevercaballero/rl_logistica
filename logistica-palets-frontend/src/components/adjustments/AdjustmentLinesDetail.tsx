import { useQuery } from "@tanstack/react-query";
import { getAdjustment, type AdjustmentType } from "../../api/adjustments";
import { fmtQty } from "../../utils/quantity";

/**
 * Qué se ajusta, material por material y palet por palet.
 *
 * Hasta acá, para aprobar sólo se veía el número de la solicitud, el motivo y
 * un total ("1 material · 1 unid."). Quien aprueba firmaba a ciegas un cambio
 * de stock que es irreversible salvo por otro ajuste — y la segregación de
 * funciones (nadie aprueba lo suyo) sólo sirve si el que firma puede revisar
 * algo. El detalle se pide al abrir y no con el listado: son varias consultas
 * por solicitud y el listado trae decenas.
 */
export default function AdjustmentLinesDetail({ requestId, type }: { requestId: string; type: AdjustmentType }) {
  const q = useQuery({
    queryKey: ["adjustments", "detalle", requestId],
    queryFn: () => getAdjustment(requestId),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }} aria-busy="true">Cargando el detalle…</p>;
  }
  if (q.isError || !q.data) {
    return <p className="form-error" role="alert" style={{ fontSize: 12, margin: "8px 0 0" }}>No se pudo cargar el detalle del ajuste.</p>;
  }

  const suma = type === "ADJUSTMENT_IN" ? "+" : "−";
  const color = type === "ADJUSTMENT_IN" ? "var(--success)" : "var(--danger)";

  return (
    <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <table className="table" style={{ margin: 0, fontSize: 12 }}>
        <thead>
          <tr>
            <th scope="col">Material</th>
            <th scope="col">Lote</th>
            <th scope="col">Pallet</th>
            <th scope="col">Ubicación</th>
            <th scope="col" style={{ textAlign: "right" }}>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {q.data.lines.map((linea) => {
            const detalle = linea.detalle ?? [];
            const material = linea.product
              ? `${linea.product.code} · ${linea.product.description}`
              : linea.productId;
            // Una fila por palet; el material se escribe sólo en la primera.
            return detalle.length === 0 ? (
              <tr key={linea.id}>
                <td style={{ fontWeight: 600 }}>{material}</td>
                <td colSpan={3} style={{ color: "var(--muted)" }}>—</td>
                <td style={{ textAlign: "right", fontWeight: 700, color }}>
                  {suma}{fmtQty(linea.totalQuantity)}
                </td>
              </tr>
            ) : (
              detalle.map((d, i) => (
                <tr key={`${linea.id}-${i}`}>
                  <td style={{ fontWeight: 600 }}>{i === 0 ? material : ""}</td>
                  <td style={{ fontFamily: "monospace" }}>{d.lotCode ?? "—"}</td>
                  <td style={{ fontFamily: "monospace" }}>
                    {d.palletCode ?? "—"}
                    {d.esPalletNuevo && (
                      <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>pallet nuevo</span>
                    )}
                  </td>
                  <td>{d.locationCode ?? linea.locationCode ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color }}>
                    {suma}{fmtQty(d.quantity)}
                    {linea.product?.unitOfMeasure && (
                      <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 4 }}>
                        {linea.product.unitOfMeasure}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
