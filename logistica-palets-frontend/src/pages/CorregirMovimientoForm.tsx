import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMovements, voidMovement, type Movement, type MovementType } from "../api/movements";
import MovementEditorModal from "./MovementEditorModal";
import DispatchLogDrawer from "../components/DispatchLogDrawer";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { fmtDateTime } from "../utils/dateFormat";

interface Props {
  onTypeChange: (t: MovementType | "INVENTORY_ADJUSTMENT") => void;
}

const PAGE_SIZE = 20;
type TypeFilter = "ALL" | "ENTRY" | "EXIT";

export default function CorregirMovimientoForm({ onTypeChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [voidingMovement, setVoidingMovement] = useState<Movement | null>(null);
  const [logMovement, setLogMovement] = useState<Movement | null>(null);

  const voidMut = useMutation({
    mutationFn: (id: string) => voidMovement(id),
    onSuccess: (res) => {
      if (res.warnings.length > 0) {
        toast.warning(`Solicitud ${res.code} enviada a aprobación. Advertencias: ${res.warnings.join(" | ")}`);
      } else {
        toast.success(`Solicitud de anulación ${res.code} enviada al MANAGER para aprobación`);
      }
      setVoidingMovement(null);
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
    },
    onError: (err) => {
      toast.error(getFriendlyApiError(err));
      setVoidingMovement(null);
    },
  });

  const movementsQ = useQuery({
    queryKey: ["movements", "correction-list", { typeFilter, search, page }],
    queryFn: () =>
      getMovements({
        type: typeFilter === "ALL" ? ["ENTRY", "EXIT"] : typeFilter,
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      }),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const movements = movementsQ.data?.data ?? [];
  const meta = movementsQ.data?.meta;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  function switchFilter(f: TypeFilter) {
    setTypeFilter(f);
    setPage(1);
  }

  const isVoidingExit = voidingMovement?.type === "EXIT";

  return (
    <>
      {logMovement && (
        <DispatchLogDrawer
          entityType="MOVEMENT"
          entityId={logMovement.id}
          title={`${logMovement.material.code} · ${fmtDateTime(logMovement.createdAt ?? logMovement.date)}`}
          onClose={() => setLogMovement(null)}
        />
      )}

      {editing && (
        <MovementEditorModal
          movement={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            movementsQ.refetch();
          }}
        />
      )}

      {/* Modal confirmación anulación */}
      {voidingMovement && (
        <div className="modal-overlay" onClick={() => setVoidingMovement(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
              ¿Anular {isVoidingExit ? "esta salida" : "esta entrada"}?
            </h3>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              Se generará automáticamente una solicitud de ajuste compensatorio ({isVoidingExit ? "RLAI" : "RLAO"}) en estado{" "}
              <strong>Pendiente de aprobación</strong>. El stock <strong>no cambia</strong> hasta que el MANAGER apruebe.
            </p>
            {isVoidingExit ? (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                Los pallets anulados se recrearán con un nuevo código vinculado al lote original.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: "var(--warning)", fontWeight: 600 }}>
                ⚠ Si hay pallets ya despachados, recibirás un aviso pero podrás continuar.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                className="btn btn--primary"
                style={{ color: "var(--danger)", borderColor: "var(--danger)", background: "transparent" }}
                onClick={() => voidingMovement && voidMut.mutate(voidingMovement.id)}
                disabled={voidMut.isPending}
              >
                {voidMut.isPending ? "Procesando..." : "Sí, solicitar anulación"}
              </button>
              <button className="btn" onClick={() => setVoidingMovement(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        {/* Header + type switcher */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Corregir Movimiento</h3>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Buscá una entrada o salida ya registrada y editá sus datos. Cada cambio queda auditado.
            </p>
          </div>
          <select
            className="input"
            value="ADJUSTMENT_IN"
            onChange={(e) => onTypeChange(e.target.value as MovementType)}
            style={{ width: 190 }}
            aria-label="Tipo de movimiento"
          >
            <option value="ENTRY">Entrada</option>
            <option value="EXIT">Salida</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="ADJUSTMENT_IN">Corregir movimiento</option>
            <option value="INVENTORY_ADJUSTMENT">Diferencia de inventario</option>
          </select>
        </div>

        {/* Diferenciación con Diferencia de Inventario */}
        <div style={{ background: "var(--panel-hi)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
          Corregí una entrada o salida <strong style={{ color: "var(--text)" }}>ya registrada</strong> (cantidades, lotes, datos de transporte). Para
          corregir stock por un conteo físico, merma o rotura <strong style={{ color: "var(--text)" }}>sin un movimiento puntual de origen</strong>, usá{" "}
          <strong style={{ color: "var(--text)" }}>Diferencia de Inventario</strong>.
        </div>

        {/* Filtro Todas / Entradas / Salidas */}
        <div
          role="tablist"
          style={{ display: "inline-flex", gap: 4, background: "var(--panel)", padding: 4, borderRadius: 8, border: "1px solid var(--border)", marginBottom: 14 }}
        >
          {([["ALL", "Todas"], ["ENTRY", "Entradas"], ["EXIT", "Salidas"]] as [TypeFilter, string][]).map(([f, label]) => (
            <button
              key={f} type="button" role="tab" aria-selected={typeFilter === f}
              onClick={() => switchFilter(f)}
              className="btn"
              style={{ fontSize: 12, fontWeight: 700, border: "none", background: typeFilter === f ? "var(--primary)" : "transparent", color: typeFilter === f ? "#fff" : "var(--muted)" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Buscador */}
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Buscar por producto, código, lote, proveedor/destino o N° MIC/Factura/Remito..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Buscar movimientos"
          />
          <button className="btn btn--primary" type="submit" style={{ whiteSpace: "nowrap" }}>Buscar</button>
          {search && <button type="button" className="btn" onClick={clearSearch}>Limpiar</button>}
        </form>

        {search && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "-8px 0 10px" }}>
            Resultados para <strong>"{search}"</strong>
            {meta && ` — ${meta.total} encontrado${meta.total !== 1 ? "s" : ""}`}
          </p>
        )}

        {/* Lista */}
        {movementsQ.isFetching && movements.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando movimientos...</p>
        ) : movements.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 14 }}>
            {search ? "Sin resultados para esa búsqueda." : "No hay movimientos registrados."}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 6, opacity: movementsQ.isFetching ? 0.6 : 1, transition: "opacity 0.15s" }}>
              {movements.map((m) => (
                <MovementRow
                  key={m.id} movement={m}
                  onEdit={() => setEditing(m)}
                  onVoid={() => setVoidingMovement(m)}
                  onLog={() => setLogMovement(m)}
                  voiding={voidMut.isPending && voidingMovement?.id === m.id}
                />
              ))}
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, justifyContent: "center" }}>
                <button className="btn" style={{ fontSize: 12, padding: "4px 12px" }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Pág. {meta.page} / {meta.totalPages}</span>
                <button className="btn" style={{ fontSize: 12, padding: "4px 12px" }} disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function MovementRow({ movement: m, onEdit, onVoid, onLog, voiding }: {
  movement: Movement; onEdit: () => void; onVoid: () => void; onLog: () => void; voiding: boolean;
}) {
  const isEntry = m.type === "ENTRY";
  const isPending = isEntry && m.status === "PENDING_REGULARIZATION";
  const isVoidPending = m.voidStatus === "VOID_PENDING";
  const isVoided = m.voidStatus === "VOIDED";
  const canVoid = !isVoidPending && !isVoided;

  const borderColor = isVoided ? "var(--muted)"
    : isVoidPending ? "var(--warning)"
    : isPending ? "var(--warning)"
    : "var(--border)";

  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8,
        border: `1.5px solid ${borderColor}`,
        background: isVoided ? "var(--panel)" : isPending ? "var(--badge-adjout-bg)" : "var(--bg)",
        opacity: isVoided ? 0.6 : 1,
        cursor: isVoided ? "default" : "pointer",
      }}
      onClick={isVoided ? undefined : onEdit}
      role={isVoided ? undefined : "button"} tabIndex={isVoided ? undefined : 0}
      onKeyDown={(e) => !isVoided && e.key === "Enter" && onEdit()}
      aria-label={`Editar ${isEntry ? "entrada" : "salida"} de ${m.material.code}`}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="badge" style={{ fontSize: 10, background: isEntry ? "var(--success)" : "var(--danger)", color: "#fff" }}>
            {isEntry ? "ENTRADA" : "SALIDA"}
          </span>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{m.material.code}</span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{m.material.description}</span>
          {m.lotCode && <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--primary)", background: "var(--primary-light)", padding: "1px 6px", borderRadius: 4 }}>{m.lotCode}</span>}
          {isEntry && m.sapLot && <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>SAP: {m.sapLot}</span>}
          {isPending && !isVoided && <span className="badge badge--adj-out" style={{ fontSize: 10 }}>PROVISORIO</span>}
          {isVoidPending && <span className="badge" style={{ fontSize: 10, background: "var(--warning)", color: "#000" }}>ANULACIÓN PENDIENTE</span>}
          {isVoided && <span className="badge" style={{ fontSize: 10, background: "var(--muted)", color: "#fff" }}>ANULADO</span>}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
          <span>{fmtDateTime(m.createdAt ?? m.date)}</span>
          {isEntry && m.warehouse && <span>{m.warehouse.name}{m.location ? ` / ${m.location.code}` : ""}</span>}
          {!isEntry && m.destination && <span>→ {m.destination}</span>}
          {m.documentNumber && <span>MIC/Fac/Rem. {m.documentNumber}</span>}
          {isEntry && m.supplier && <span>{m.supplier}</span>}
          {!isEntry && m.carrier && <span>{m.carrier}</span>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: !isEntry && !isVoided ? "var(--danger)" : undefined, textDecoration: isVoided ? "line-through" : undefined }}>
            {isEntry ? "" : "-"}{m.quantity.toLocaleString("es-PY")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.material.unitOfMeasure ?? "unid."}</div>
        </div>
        <button className="btn" style={{ fontSize: 12, padding: "5px 10px" }} onClick={(e) => { e.stopPropagation(); onLog(); }} title="Ver bitácora y adjuntos"></button>
        {!isVoided && (
          <button className="btn" style={{ fontSize: 12, padding: "5px 10px" }} onClick={(e) => { e.stopPropagation(); onEdit(); }}> Editar</button>
        )}
        {canVoid && (
          <button className="btn" style={{ fontSize: 12, padding: "5px 10px", color: "var(--danger)", whiteSpace: "nowrap" }}
            onClick={(e) => { e.stopPropagation(); onVoid(); }} disabled={voiding}>
            {voiding ? "..." : "⊘ Anular"}
          </button>
        )}
      </div>
    </div>
  );
}
