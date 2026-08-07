import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDocuments, type LogisticsDocument } from "../api/movements";
import {
  getDispatchLog,
  deleteAttachment,
  openAttachmentBlob,
  ATTACHMENT_CATEGORIES,
  type AttachmentEntityType,
} from "../api/attachments";
import AttachmentUploader from "../components/AttachmentUploader";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useAuth } from "../auth/AuthContext";

// ── Helpers de formato ───────────────────────────────────────────────────────

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleDateString("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Etiqueta corta del tipo de archivo — se muestra como texto, no como emoji. */
function fileKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "IMG";
  if (mimeType.includes("pdf"))      return "PDF";
  if (mimeType.includes("word"))     return "DOC";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "XLS";
  return "ARCH";
}

const fileKindChip: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, fontFamily: "monospace", letterSpacing: 0.3,
  color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 4,
  padding: "2px 5px", flexShrink: 0,
};

// ── Configuración visual ─────────────────────────────────────────────────────

const TYPE_CFG: Record<string, { label: string; color: string; bg: string; arrow: string }> = {
  ENTRY: { label: "Entrada", color: "#166534", bg: "#dcfce7", arrow: "↓" },
  EXIT:  { label: "Salida",  color: "#991b1b", bg: "#fee2e2", arrow: "↑" },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  BORRADOR:             { label: "Borrador",     color: "#6b7280", bg: "#f3f4f6" },
  PENDIENTE_APROBACION: { label: "Pend. aprob.", color: "#854d0e", bg: "#fef9c3" },
  APROBADO:             { label: "Aprobado",     color: "#166534", bg: "#dcfce7" },
  RECHAZADO:            { label: "Rechazado",    color: "#991b1b", bg: "#fee2e2" },
  ANULADO:              { label: "Anulado",      color: "#4b5563", bg: "#e5e7eb" },
};


// ── Panel expandido de un documento ─────────────────────────────────────────

function DocPanel({ doc, onClose }: { doc: LogisticsDocument; onClose: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canDelete = user?.role === "ADMIN" || user?.role === "MANAGER";
  const typeCfg = TYPE_CFG[doc.type];

  const logQ = useQuery({
    queryKey: ["dispatch-log", "DOCUMENT", doc.id],
    queryFn: () => getDispatchLog("DOCUMENT" as AttachmentEntityType, doc.id),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAttachment(id),
    onSuccess: () => {
      toast.success("Archivo eliminado");
      void queryClient.invalidateQueries({ queryKey: ["dispatch-log", "DOCUMENT", doc.id] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const { events = [], attachments = [] } = logQ.data ?? {};

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: "var(--panel-hi, rgba(0,0,0,0.03))",
    }}>
      {/* Cabecera de desglose */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 20, flex: 1, flexWrap: "wrap" }}>
          {/* Stat: productos */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>
              {doc.totalLines}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, marginTop: 2 }}>
              Productos
            </div>
          </div>
          <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch" }} />
          {/* Stat: unidades */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>
              {doc.totalQuantity.toLocaleString("es-PY")}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, marginTop: 2 }}>
              Unidades
            </div>
          </div>
          <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch" }} />
          {/* Stat: adjuntos */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>
              {logQ.isLoading ? "…" : attachments.length}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, marginTop: 2 }}>
              Adjuntos
            </div>
          </div>
          <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch" }} />
          {/* Stat: eventos */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>
              {logQ.isLoading ? "…" : events.length}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, marginTop: 2 }}>
              Eventos
            </div>
          </div>
        </div>

        {/* Acciones de impresión */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            className="btn btn--primary"
            style={{ fontSize: 13, padding: "7px 14px" }}
            onClick={() => window.open(`/print/document/${doc.id}`, "_blank")}
          >
            🖨 Nota de {typeCfg?.label.toLowerCase() ?? "documento"}
          </button>
          <button
            className="btn btn--primary"
            style={{ fontSize: 13, padding: "7px 14px" }}
            onClick={() => window.open(`/print/labels/${doc.id}`, "_blank")}
          >
             Etiquetas
          </button>
        </div>
      </div>

      {/* Cuerpo: adjuntos + historial en dos columnas */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        minHeight: 180,
      }}>

        {/* ── Adjuntos ─────────────────────────────── */}
        <div style={{ padding: "16px 20px", borderRight: "1px solid var(--border)" }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: "var(--muted)",
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12,
          }}>
             Archivos adjuntos
          </div>

          {logQ.isLoading ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Cargando...</p>
          ) : attachments.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Sin archivos adjuntos aún.</p>
          ) : (
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {attachments.map((a) => {
                const cat = ATTACHMENT_CATEGORIES.find((c) => c.value === a.category);
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 7,
                      border: "1px solid var(--border)",
                      background: "var(--bg-base, var(--bg))",
                    }}
                  >
                    <span style={fileKindChip}>{fileKind(a.mimeType)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.name}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>
                        {cat?.label} · {formatBytes(a.fileSize)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        className="btn"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        onClick={() => void openAttachmentBlob(a.id)}
                      >
                        Ver
                      </button>
                      {canDelete && (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: "3px 6px", color: "var(--danger)" }}
                          onClick={() => deleteMut.mutate(a.id)}
                          disabled={deleteMut.isPending}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <AttachmentUploader
            entityType={"DOCUMENT" as AttachmentEntityType}
            entityId={doc.id}
          />
        </div>

        {/* ── Historial de eventos ──────────────────── */}
        <div style={{ padding: "16px 20px" }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: "var(--muted)",
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12,
          }}>
             Historial de eventos
          </div>

          {logQ.isLoading ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Cargando...</p>
          ) : events.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Sin eventos registrados.</p>
          ) : (
            <div style={{ position: "relative" }}>
              {/* Línea vertical de timeline */}
              <div style={{
                position: "absolute", left: 11, top: 6, bottom: 6,
                width: 2, background: "var(--border)",
              }} />
              <div style={{ display: "grid", gap: 14 }}>
                {events.map((ev) => (
                  <div key={ev.id} style={{ display: "flex", gap: 10, position: "relative" }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: "var(--panel, var(--bg))",
                      border: "2px solid var(--border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, flexShrink: 0, zIndex: 1,
                    }}>
                      ●
                    </div>
                    <div style={{ paddingTop: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                        {ev.description}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        {fmtDateTime(ev.createdAt)}
                        {ev.username ? ` · ${ev.username}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pie: cerrar */}
      <div style={{
        padding: "10px 20px", borderTop: "1px solid var(--border)",
        display: "flex", justifyContent: "flex-end",
      }}>
        <button className="btn" style={{ fontSize: 12 }} onClick={onClose}>
          Cerrar ↑
        </button>
      </div>
    </div>
  );
}

// ── Fila de documento ────────────────────────────────────────────────────────

function DocRow({
  doc, idx, total, isExpanded, onToggle,
}: {
  doc: LogisticsDocument;
  idx: number;
  total: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const typeCfg   = TYPE_CFG[doc.type];
  const statusCfg = STATUS_CFG[doc.status] ?? { label: doc.status, color: "#6b7280", bg: "#f3f4f6" };

  // Identificador principal: N° externo > proveedor/destino > código interno
  const mainId =
    doc.documentNumber
      ? `MIC/Fac/Rem. ${doc.documentNumber}`
      : doc.type === "ENTRY"
      ? doc.supplier ?? doc.code
      : doc.destination ?? doc.code;

  // Identificador secundario (contraparte comercial)
  const counterpart =
    doc.documentNumber
      ? (doc.type === "ENTRY" ? doc.supplier : doc.destination)
      : null;

  return (
    <div style={{ borderBottom: idx < total - 1 ? "1px solid var(--border)" : "none" }}>
      {/* Fila principal — clickeable */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: "13px 20px",
          cursor: "pointer",
          background: isExpanded ? "var(--panel-hi, rgba(0,0,0,0.03))" : undefined,
          transition: "background 0.15s",
        }}
      >
        {/* Badge de tipo */}
        <div style={{
          minWidth: 64, textAlign: "center",
          background: typeCfg?.bg ?? "#f3f4f6",
          color: typeCfg?.color ?? "#6b7280",
          borderRadius: 6, padding: "5px 6px",
          fontSize: 11, fontWeight: 800,
          lineHeight: 1.2,
        }}>
          <div style={{ fontSize: 16 }}>{typeCfg?.arrow}</div>
          {typeCfg?.label ?? doc.type}
        </div>

        {/* Bloque de información */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Fila 1: identificador principal + status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ fontWeight: 900, fontSize: 15, color: "var(--text)" }}>
              {mainId}
            </span>
            {counterpart && (
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
                · {counterpart}
              </span>
            )}
            <span style={{
              display: "inline-block", padding: "2px 8px", borderRadius: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              background: statusCfg.bg, color: statusCfg.color,
            }}>
              {statusCfg.label}
            </span>
            {/* El status del documento (arriba) no cambia si después se anula una de sus
                líneas — sigue siendo un remito válido. Esto es la señal aparte: "Aprobado"
                ya no implica que las N líneas originales sigan todas vigentes. */}
            {!!doc.voidedLines && (
              <span
                title="Al menos un movimiento de este documento fue anulado después de aprobado — el stock ya no refleja todas las líneas originales."
                style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 4,
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                  background: "var(--panel-hi)", color: "var(--muted)", border: "1px dashed var(--border)",
                }}
              >
                ⊘ {doc.voidedLines} línea{doc.voidedLines !== 1 ? "s" : ""} anulada{doc.voidedLines !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Fila 2: código interno + stats discretos */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{
              fontFamily: "monospace", fontSize: 11,
              color: "var(--primary)", fontWeight: 600,
            }}>
              {doc.code}
            </span>
            <span style={{ fontSize: 11, color: "var(--border)" }}>·</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {doc.totalLines} prod.
            </span>
            <span style={{ fontSize: 11, color: "var(--border)" }}>·</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {doc.totalQuantity.toLocaleString("es-PY")} un.
            </span>
            <span style={{ fontSize: 11, color: "var(--border)" }}>·</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {fmtDateTime(doc.createdAt ?? doc.date)}
            </span>
            {(doc.carrier || doc.vehiclePlate) && (
              <>
                <span style={{ fontSize: 11, color: "var(--border)" }}>·</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                   {doc.carrier ?? doc.vehiclePlate}
                </span>
              </>
            )}
            {doc.notes && (
              <>
                <span style={{ fontSize: 11, color: "var(--border)" }}>·</span>
                <span
                  style={{ fontSize: 11, color: "var(--muted)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={doc.notes}
                >
                   {doc.notes}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Botones rápidos de impresión */}
        <div
          style={{ display: "flex", gap: 6, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="btn"
            title={`Imprimir nota de ${typeCfg?.label.toLowerCase() ?? "documento"}`}
            style={{ fontSize: 14, padding: "5px 10px" }}
            onClick={() => window.open(`/print/document/${doc.id}`, "_blank")}
          >
            🖨
          </button>
          <button
            className="btn"
            title="Imprimir etiquetas de pallet"
            style={{ fontSize: 14, padding: "5px 10px" }}
            onClick={() => window.open(`/print/labels/${doc.id}`, "_blank")}
          >
            
          </button>
        </div>

        {/* Chevron */}
        <div style={{
          color: "var(--muted)", fontSize: 18, flexShrink: 0,
          transition: "transform 0.2s",
          transform: isExpanded ? "rotate(180deg)" : "none",
          lineHeight: 1,
        }}>
          ▾
        </div>
      </div>

      {/* Panel expandido */}
      {isExpanded && (
        <DocPanel doc={doc} onClose={onToggle} />
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function BitacoraPage() {
  const [typeFilter, setTypeFilter] = useState<"" | "ENTRY" | "EXIT">("");
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [search,     setSearch]     = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const docsQ = useQuery({
    queryKey: ["bitacora-docs", { typeFilter, from, to, search }],
    queryFn: () => getDocuments({
      type:   typeFilter || undefined,
      from:   from       || undefined,
      to:     to         || undefined,
      search: search     || undefined,
    }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const documents: LogisticsDocument[] = docsQ.data ?? [];
  // Orden descendente por fecha de creación
  const sorted = [...documents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  function clearFilters() {
    setTypeFilter(""); setFrom(""); setTo("");
    setSearch(""); setSearchInput("");
  }

  const hasFilters = !!(typeFilter || from || to || search);

  return (
    <div>
      {/* Encabezado */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>
          Estante de Registros
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          Archivo de remitos de entrada y salida — trazabilidad, adjuntos y acceso a imprimibles.
        </p>
      </div>

      {/* Filtros */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* Búsqueda por N° remito / proveedor */}
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 6, flex: "1 1 280px" }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="N° MIC/Factura/Remito, proveedor, destino..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button className="btn btn--primary" type="submit">Buscar</button>
            {search && (
              <button type="button" className="btn" onClick={() => { setSearchInput(""); setSearch(""); }}>✕</button>
            )}
          </form>

          {/* Tipo */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>
              Tipo
            </div>
            <select
              className="input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as "" | "ENTRY" | "EXIT")}
            >
              <option value="">Todos</option>
              <option value="ENTRY">Entradas</option>
              <option value="EXIT">Salidas</option>
            </select>
          </div>

          {/* Desde */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>
              Desde
            </div>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ width: 140 }}
            />
          </div>

          {/* Hasta */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>
              Hasta
            </div>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ width: 140 }}
            />
          </div>

          {hasFilters && (
            <button className="btn" style={{ fontSize: 12 }} onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Chips de filtros activos */}
        {hasFilters && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Activos:</span>
            {search     && <span className="badge">{search}</span>}
            {typeFilter && <span className="badge">{TYPE_CFG[typeFilter]?.label ?? typeFilter}</span>}
            {from       && <span className="badge">Desde {from}</span>}
            {to         && <span className="badge">Hasta {to}</span>}
          </div>
        )}
      </section>

      {/* Lista de documentos */}
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Cabecera de la lista */}
        <div style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
            Registros{" "}
            {docsQ.data !== undefined && (
              <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 13 }}>
                — {sorted.length} total
              </span>
            )}
          </h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {docsQ.isFetching && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Actualizando...</span>
            )}
            <button
              className="btn"
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => void docsQ.refetch()}
            >
              ↺ Actualizar
            </button>
          </div>
        </div>

        {/* Contenido */}
        {docsQ.isLoading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Cargando registros...
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: "56px 0", textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              Sin registros
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
              {hasFilters
                ? "No hay documentos que coincidan con esos filtros."
                : "Aún no hay remitos registrados en el sistema."}
            </div>
          </div>
        ) : (
          <div>
            {sorted.map((doc, idx) => (
              <DocRow
                key={doc.id}
                doc={doc}
                idx={idx}
                total={sorted.length}
                isExpanded={expandedId === doc.id}
                onToggle={() => setExpandedId((prev) => (prev === doc.id ? null : doc.id))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
