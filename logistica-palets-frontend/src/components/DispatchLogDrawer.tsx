import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDispatchLog,
  deleteAttachment,
  openAttachmentBlob,
  ATTACHMENT_CATEGORIES,
  type AttachmentEntityType,
} from "../api/attachments";
import AttachmentUploader from "./AttachmentUploader";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { useAuth } from "../auth/AuthContext";

interface Props {
  entityType: AttachmentEntityType;
  entityId: string;
  title: string;           // Ej: "RLNE-2026-000001 · Entrada"
  onClose: () => void;
}

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
  INSPECCION:           "🔍",
};

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.includes("pdf"))      return "📄";
  if (mimeType.includes("word"))     return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "📊";
  return "📎";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DispatchLogDrawer({ entityType, entityId, title, onClose }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canDelete = user?.role === "ADMIN" || user?.role === "MANAGER";

  const logQ = useQuery({
    queryKey: ["dispatch-log", entityType, entityId],
    queryFn: () => getDispatchLog(entityType, entityId),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAttachment(id),
    onSuccess: () => {
      toast.success("Archivo eliminado");
      void queryClient.invalidateQueries({ queryKey: ["dispatch-log", entityType, entityId] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const { events = [], attachments = [] } = logQ.data ?? {};

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }}
      onClick={onClose}
    >
      {/* Overlay */}
      <div style={{ flex: 1, background: "rgba(0,0,0,0.45)" }} />

      {/* Panel deslizable derecho */}
      <div
        style={{ width: "min(560px, 100vw)", background: "var(--bg-base)", display: "flex", flexDirection: "column", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Bitácora de despacho</h3>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>{title}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
        </div>

        <div style={{ padding: "16px 20px", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── ADJUNTAR ARCHIVO ─────────────────────────── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>
              Adjuntar archivo
            </div>
            <AttachmentUploader entityType={entityType} entityId={entityId} />
          </div>

          {/* ── ARCHIVOS ADJUNTOS ────────────────────────── */}
          {attachments.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>
                Archivos adjuntos ({attachments.length})
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {attachments.map((a) => {
                  const cat = ATTACHMENT_CATEGORIES.find((c) => c.value === a.category);
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
                      <span style={{ fontSize: 20 }}>{fileIcon(a.mimeType)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {cat?.icon} {cat?.label} · {a.originalName} · {formatBytes(a.fileSize)}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {new Date(a.createdAt).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => void openAttachmentBlob(a.id)}
                          title="Ver archivo"
                        >
                          Ver
                        </button>
                        {canDelete && (
                          <button
                            className="btn"
                            style={{ fontSize: 12, padding: "4px 8px", color: "var(--danger)" }}
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
            </div>
          )}

          {/* ── BITÁCORA DE EVENTOS ──────────────────────── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>
              Historial de eventos {events.length > 0 && `(${events.length})`}
            </div>

            {logQ.isLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando...</p>
            ) : events.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin eventos registrados.</p>
            ) : (
              <div style={{ position: "relative" }}>
                {/* Línea vertical */}
                <div style={{ position: "absolute", left: 15, top: 0, bottom: 0, width: 2, background: "var(--border)" }} />
                <div style={{ display: "grid", gap: 0 }}>
                  {events.map((ev, idx) => (
                    <div key={ev.id} style={{ display: "flex", gap: 12, paddingBottom: idx < events.length - 1 ? 16 : 0, position: "relative" }}>
                      {/* Ícono del evento */}
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--panel)", border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, zIndex: 1 }}>
                        {EVENT_ICONS[ev.eventType] ?? "●"}
                      </div>
                      <div style={{ flex: 1, paddingTop: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{ev.description}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, display: "flex", gap: 10 }}>
                          <span>{new Date(ev.createdAt).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          {ev.username && <span>· {ev.username}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
