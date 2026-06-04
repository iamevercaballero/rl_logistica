import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAllEvents, type DocumentEvent, type AttachmentEntityType } from "../api/attachments";
import DispatchLogDrawer from "../components/DispatchLogDrawer";

// ── Configuración visual ────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  CREADO:               "🟢",
  EDITADO:              "✏️",
  FOTO_ADJUNTADA:       "📎",
  ARCHIVO_ELIMINADO:    "🗑️",
  ENVIADO_APROBACION:   "📤",
  APROBADO:             "✅",
  RECHAZADO:            "❌",
  ANULACION_SOLICITADA: "⊘",
  ANULADO:              "🔴",
  NOTA_IMPRESA:         "🖨️",
};

const EVENT_LABELS: Record<string, string> = {
  CREADO:               "Creado",
  EDITADO:              "Editado",
  FOTO_ADJUNTADA:       "Archivo adjuntado",
  ARCHIVO_ELIMINADO:    "Archivo eliminado",
  ENVIADO_APROBACION:   "Enviado a aprobación",
  APROBADO:             "Aprobado",
  RECHAZADO:            "Rechazado",
  ANULACION_SOLICITADA: "Anulación solicitada",
  ANULADO:              "Anulado",
  NOTA_IMPRESA:         "Nota impresa",
};

const ENTITY_LABELS: Record<string, { label: string; color: string }> = {
  DOCUMENT:   { label: "Remito",   color: "var(--primary)" },
  ADJUSTMENT: { label: "Ajuste",   color: "var(--warning)" },
  MOVEMENT:   { label: "Movimiento", color: "var(--muted)" },
};

const EVENT_TYPES = Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }));
const PAGE_SIZE = 50;

// ── Componente ──────────────────────────────────────────────────────────────

export default function BitacoraPage() {
  const [entityType, setEntityType] = useState("");
  const [eventType,  setEventType]  = useState("");
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [search,     setSearch]     = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page,       setPage]       = useState(1);

  // Drawer para ver la bitácora completa de una entidad
  const [drawer, setDrawer] = useState<{ entityType: AttachmentEntityType; entityId: string; title: string } | null>(null);

  const q = useQuery({
    queryKey: ["bitacora", { entityType, eventType, from, to, search, page }],
    queryFn: () => getAllEvents({
      entityType: entityType || undefined,
      eventType:  eventType  || undefined,
      from:       from       || undefined,
      to:         to         || undefined,
      search:     search     || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    placeholderData: (prev) => prev,
  });

  const events = q.data?.data ?? [];
  const meta   = q.data?.meta;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function applyFilters() { setPage(1); }

  function openDrawer(ev: DocumentEvent) {
    setDrawer({
      entityType: ev.entityType as AttachmentEntityType,
      entityId:   ev.entityId,
      title:      ev.entityCode
        ? `${ev.entityCode} · ${ENTITY_LABELS[ev.entityType]?.label ?? ev.entityType}`
        : `${ENTITY_LABELS[ev.entityType]?.label ?? ev.entityType} · ${ev.entityId.slice(0, 8)}...`,
    });
  }

  return (
    <div>
      {drawer && (
        <DispatchLogDrawer
          entityType={drawer.entityType}
          entityId={drawer.entityId}
          title={drawer.title}
          onClose={() => setDrawer(null)}
        />
      )}

      {/* Encabezado */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Bitácora</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          Historial de eventos del sistema — remitos, ajustes y movimientos.
        </p>
      </div>

      {/* Filtros */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
          {/* Búsqueda */}
          <form onSubmit={handleSearch} style={{ gridColumn: "span 2", display: "flex", gap: 6 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Buscar por código, descripción, usuario..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button className="btn btn--primary" type="submit" style={{ whiteSpace: "nowrap" }}>Buscar</button>
            {search && (
              <button type="button" className="btn" onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}>✕</button>
            )}
          </form>

          {/* Tipo entidad */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Entidad</div>
            <select className="input" value={entityType} onChange={(e) => { setEntityType(e.target.value); applyFilters(); }}>
              <option value="">Todas</option>
              <option value="DOCUMENT">Remitos (RLNE/RLNS)</option>
              <option value="ADJUSTMENT">Ajustes (RLAI/RLAO)</option>
              <option value="MOVEMENT">Movimientos</option>
            </select>
          </div>

          {/* Tipo evento */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Evento</div>
            <select className="input" value={eventType} onChange={(e) => { setEventType(e.target.value); applyFilters(); }}>
              <option value="">Todos</option>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{EVENT_ICONS[t.value]} {t.label}</option>
              ))}
            </select>
          </div>

          {/* Fechas */}
          <div style={{ display: "flex", gap: 6, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Desde</div>
              <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); applyFilters(); }} style={{ width: 140 }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Hasta</div>
              <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); applyFilters(); }} style={{ width: 140 }} />
            </div>
          </div>
        </div>

        {/* Resumen activo */}
        {(search || entityType || eventType || from || to) && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Filtros activos:</span>
            {search     && <span className="badge">{search}</span>}
            {entityType && <span className="badge">{ENTITY_LABELS[entityType]?.label ?? entityType}</span>}
            {eventType  && <span className="badge">{EVENT_LABELS[eventType] ?? eventType}</span>}
            {(from || to) && <span className="badge">{from || "..."} → {to || "..."}</span>}
            <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={() => { setEntityType(""); setEventType(""); setFrom(""); setTo(""); setSearch(""); setSearchInput(""); setPage(1); }}>
              Limpiar todo
            </button>
          </div>
        )}
      </section>

      {/* Tabla de eventos */}
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
            Eventos {meta && <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 13 }}>— {meta.total.toLocaleString("es-PY")} total</span>}
          </h3>
          {q.isFetching && <span style={{ fontSize: 12, color: "var(--muted)" }}>Actualizando...</span>}
        </div>

        {q.isLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando...</p>
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 14 }}>
            {search || entityType || eventType ? "Sin resultados para esos filtros." : "Aún no hay eventos registrados."}
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Descripción</th>
                    <th>Entidad</th>
                    <th>Código</th>
                    <th>Usuario</th>
                    <th>Fecha</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => {
                    const entityMeta = ENTITY_LABELS[ev.entityType];
                    return (
                      <tr
                        key={ev.id}
                        style={{ cursor: "pointer", opacity: q.isFetching ? 0.6 : 1 }}
                        onClick={() => openDrawer(ev)}
                      >
                        <td style={{ textAlign: "center", fontSize: 16 }}>
                          {EVENT_ICONS[ev.eventType] ?? "●"}
                        </td>
                        <td style={{ fontSize: 13 }}>{ev.description}</td>
                        <td>
                          {entityMeta && (
                            <span className="badge" style={{ color: entityMeta.color, borderColor: entityMeta.color, background: "transparent" }}>
                              {entityMeta.label}
                            </span>
                          )}
                        </td>
                        <td>
                          {ev.entityCode ? (
                            <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>{ev.entityCode}</span>
                          ) : (
                            <span style={{ color: "var(--muted)", fontSize: 11 }}>{ev.entityId.slice(0, 8)}...</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>{ev.username ?? "—"}</td>
                        <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {new Date(ev.createdAt).toLocaleDateString("es-PY", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                        <td>
                          <button
                            className="btn"
                            style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={(e) => { e.stopPropagation(); openDrawer(ev); }}
                            title="Ver bitácora completa"
                          >
                            📎 Ver
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {meta && meta.totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, justifyContent: "center" }}>
                <button className="btn" style={{ fontSize: 12 }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Pág. {meta.page} / {meta.totalPages}</span>
                <button className="btn" style={{ fontSize: 12 }} disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
