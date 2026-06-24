import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransport,
  deleteTransport,
  listTransports,
  updateTransport,
  getTransportHistory,
  registerInspection,
  TRANSPORT_STATUSES,
  transportStatusMeta,
  type Transport,
  type TransportDriver,
  type TransportStatus,
} from "../api/transports";
import {
  getDispatchLog,
  deleteAttachment,
  openAttachmentBlob,
  fetchAttachmentObjectUrl,
  ATTACHMENT_CATEGORIES,
} from "../api/attachments";
import AttachmentUploader from "../components/AttachmentUploader";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import { formatParaguayPhone, isValidParaguayPhone } from "../utils/phone";

/* ── Helpers ───────────────────────────────────────────────────────────── */
function fmtDate(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(s: string): string {
  return new Date(s).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function fileIcon(m: string): string {
  if (m.startsWith("image/")) return "🖼️";
  if (m.includes("pdf")) return "📄";
  if (m.includes("word")) return "📝";
  if (m.includes("excel") || m.includes("spreadsheet")) return "📊";
  return "📎";
}

const EVENT_ICONS: Record<string, string> = {
  CREADO: "🟢", EDITADO: "✏️", FOTO_ADJUNTADA: "📎", ARCHIVO_ELIMINADO: "🗑️", INSPECCION: "🔍",
};

/* ── Foto del camión: descarga autenticada → blob URL ─────────────────────── */
function VehiclePhoto({ attachmentId }: { attachmentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    fetchAttachmentObjectUrl(attachmentId).then((u) => {
      if (active) { objUrl = u; setUrl(u); } else URL.revokeObjectURL(u);
    }).catch(() => {});
    return () => { active = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [attachmentId]);

  if (!url) return <div style={{ height: 180, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>Cargando foto…</div>;
  return <img src={url} alt="Foto del camión" style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} />;
}

type Tab = "ficha" | "choferes" | "docs" | "historial" | "inspecciones";

export default function TransportsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("transports", role) : false;
  const allowDelete = role ? canDelete("transports", role) : false;
  const allowEdit = allowCreate;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ficha");
  const [search, setSearch] = useState("");

  /* Alta rápida */
  const [showNew, setShowNew] = useState(false);
  const [nPlate, setNPlate] = useState("");
  const [nType, setNType] = useState("");
  const [nDesc, setNDesc] = useState("");

  const { data: items = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["transports"],
    queryFn: listTransports,
  });

  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId]);

  const selected = useMemo(() => items.find((t) => t.id === selectedId) ?? null, [items, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) =>
      t.plate.toLowerCase().includes(q) ||
      t.type.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q));
  }, [items, search]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["transports"] });
  }

  const createMut = useMutation({
    mutationFn: createTransport,
    onSuccess: (created) => {
      invalidate();
      toast.success(`Vehículo ${created.plate} registrado`);
      setShowNew(false); setNPlate(""); setNType(""); setNDesc("");
      setSelectedId(created.id);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTransport(id),
    onSuccess: (_r, id) => {
      invalidate();
      if (selectedId === id) setSelectedId(null);
      toast.success("Vehículo eliminado");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!nPlate.trim() || !nType.trim()) { toast.error("Patente y tipo son obligatorios."); return; }
    createMut.mutate({ plate: nPlate.trim().toUpperCase(), type: nType.trim(), description: nDesc.trim() || undefined });
  }

  function handleDelete(t: Transport) {
    if (!window.confirm(`Eliminar vehículo ${t.plate}?`)) return;
    deleteMut.mutate(t.id);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Transportes</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Flota: ficha, capacidad, choferes, documentos, historial de viajes e inspecciones.
          </p>
        </div>
        {allowCreate && (
          <button className="btn btn--primary" onClick={() => setShowNew((s) => !s)}>
            {showNew ? "Cerrar" : "+ Nuevo vehículo"}
          </button>
        )}
      </div>

      {/* Alta rápida */}
      {showNew && allowCreate && (
        <form onSubmit={handleCreate} className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, padding: 14 }}>
          <input className="input" placeholder="Patente *" value={nPlate} onChange={(e) => setNPlate(e.target.value)} style={{ width: 160 }} />
          <input className="input" placeholder="Tipo (Scania, Camión…) *" value={nType} onChange={(e) => setNType(e.target.value)} style={{ width: 200 }} />
          <input className="input" placeholder="Descripción / transportadora" value={nDesc} onChange={(e) => setNDesc(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn btn--primary" type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? "Guardando…" : "Registrar"}
          </button>
        </form>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>

        {/* ── Lista de flota ── */}
        <div style={{ display: "grid", gap: 8 }}>
          <input className="input" placeholder="Buscar patente, tipo…" value={search} onChange={(e) => setSearch(e.target.value)} />

          {isLoading ? <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando…</p> : null}
          {isError ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
              <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
              <button className="btn btn--primary" onClick={() => refetch()}>Reintentar</button>
            </div>
          ) : null}

          {filtered.map((t) => {
            const meta = transportStatusMeta(t.status);
            return (
              <div
                key={t.id}
                onClick={() => { setSelectedId(t.id); setTab("ficha"); }}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}
                className="card"
                style={{
                  padding: "12px 14px", cursor: "pointer",
                  border: `1.5px solid ${selectedId === t.id ? "var(--primary)" : "var(--border)"}`,
                  background: selectedId === t.id ? "var(--primary-light)" : undefined,
                  opacity: t.active ? 1 : 0.6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 15, fontFamily: "monospace" }}>{t.plate}</strong>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.icon} {meta.label}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  {t.type}{t.description ? ` · ${t.description}` : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "flex", gap: 10 }}>
                  {t.drivers.length > 0 && <span>👤 {t.drivers.length} chofer{t.drivers.length !== 1 ? "es" : ""}</span>}
                  {t.capacityPallets != null && <span>📦 {t.capacityPallets} pal.</span>}
                </div>
              </div>
            );
          })}
          {!isLoading && filtered.length === 0 && <p style={{ color: "var(--muted)" }}>Sin vehículos.</p>}
        </div>

        {/* ── Detalle del vehículo ── */}
        <div className="card" style={{ minHeight: 420 }}>
          {!selected ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Seleccioná un vehículo para ver su ficha completa.</p>
          ) : (
            <VehicleDetail
              key={selected.id}
              vehicle={selected}
              tab={tab}
              onTab={setTab}
              allowEdit={allowEdit}
              allowDelete={allowDelete}
              onDelete={() => handleDelete(selected)}
              onChanged={invalidate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Detalle del vehículo (ficha + tabs)
   ═══════════════════════════════════════════════════════════════════════════ */
function VehicleDetail({
  vehicle, tab, onTab, allowEdit, allowDelete, onDelete, onChanged,
}: {
  vehicle: Transport;
  tab: Tab;
  onTab: (t: Tab) => void;
  allowEdit: boolean;
  allowDelete: boolean;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const meta = transportStatusMeta(vehicle.status);

  const TABS: { id: Tab; label: string }[] = [
    { id: "ficha", label: "Ficha & Capacidad" },
    { id: "choferes", label: "Choferes" },
    { id: "docs", label: "Documentos & Foto" },
    { id: "historial", label: "Historial de viajes" },
    { id: "inspecciones", label: "Inspecciones" },
  ];

  /* Bitácora + adjuntos del vehículo */
  const logQ = useQuery({
    queryKey: ["dispatch-log", "VEHICLE", vehicle.id],
    queryFn: () => getDispatchLog("VEHICLE", vehicle.id),
  });
  const attachments = logQ.data?.attachments ?? [];
  const events = logQ.data?.events ?? [];
  // Foto del camión: prioriza una imagen con categoría CAMION; si no, cualquier imagen
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const photo = images.find((a) => a.category === "CAMION") ?? images[0];

  /* Mutación de estado operativo rápido */
  const statusMut = useMutation({
    mutationFn: (status: TransportStatus) => updateTransport(vehicle.id, { status }),
    onSuccess: () => { toast.success("Estado actualizado"); onChanged(); void queryClient.invalidateQueries({ queryKey: ["dispatch-log", "VEHICLE", vehicle.id] }); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, fontFamily: "monospace" }}>{vehicle.plate}</h2>
            <span style={{ fontSize: 13, fontWeight: 700, color: meta.color, border: `1.5px solid ${meta.color}`, borderRadius: 20, padding: "2px 12px" }}>
              {meta.icon} {meta.label}
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            {vehicle.type}{vehicle.description ? ` · ${vehicle.description}` : ""}
          </p>
        </div>
        {/* Cambio rápido de estado operativo */}
        {allowEdit && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {TRANSPORT_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className="btn"
                onClick={() => vehicle.status !== s.value && statusMut.mutate(s.value)}
                disabled={statusMut.isPending}
                title={`Marcar como ${s.label}`}
                style={{
                  fontSize: 11, padding: "4px 10px",
                  background: vehicle.status === s.value ? s.color : undefined,
                  color: vehicle.status === s.value ? "#fff" : undefined,
                  borderColor: vehicle.status === s.value ? s.color : undefined,
                }}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 14px", fontSize: 13, fontWeight: tab === t.id ? 800 : 500,
              color: tab === t.id ? "var(--primary)" : "var(--muted)",
              borderBottom: `2px solid ${tab === t.id ? "var(--primary)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.id === "docs" && attachments.length > 0 && <span style={{ marginLeft: 5, fontSize: 11 }}>({attachments.length})</span>}
          </button>
        ))}
      </div>

      {tab === "ficha" && <FichaTab vehicle={vehicle} allowEdit={allowEdit} allowDelete={allowDelete} onDelete={onDelete} onChanged={onChanged} />}
      {tab === "choferes" && <ChoferesTab vehicle={vehicle} allowEdit={allowEdit} onChanged={onChanged} />}
      {tab === "docs" && (
        <DocsTab vehicleId={vehicle.id} attachments={attachments} photo={photo} loading={logQ.isLoading} allowEdit={allowEdit} />
      )}
      {tab === "historial" && <HistorialTab vehicleId={vehicle.id} />}
      {tab === "inspecciones" && <InspeccionesTab vehicle={vehicle} events={events} allowEdit={allowEdit} onChanged={onChanged} />}
    </div>
  );
}

/* ── Ficha & Capacidad ─────────────────────────────────────────────────────── */
function FichaTab({ vehicle, allowEdit, allowDelete, onDelete, onChanged }: {
  vehicle: Transport; allowEdit: boolean; allowDelete: boolean; onDelete: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState(vehicle.type);
  const [description, setDescription] = useState(vehicle.description ?? "");
  const [capacityPallets, setCapacityPallets] = useState(vehicle.capacityPallets != null ? String(vehicle.capacityPallets) : "");
  const [capacityKg, setCapacityKg] = useState(vehicle.capacityKg != null ? String(vehicle.capacityKg) : "");
  const [notes, setNotes] = useState(vehicle.notes ?? "");

  const mut = useMutation({
    mutationFn: () => updateTransport(vehicle.id, {
      type: type.trim(),
      description: description.trim() || undefined,
      capacityPallets: capacityPallets.trim() ? Number(capacityPallets) : undefined,
      capacityKg: capacityKg.trim() ? Number(capacityKg) : undefined,
      notes: notes.trim() || undefined,
    }),
    onSuccess: () => { toast.success("Ficha actualizada"); onChanged(); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const label: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 };

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 640 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={label}>Tipo de vehículo</label>
          <input className="input" value={type} disabled={!allowEdit} onChange={(e) => setType(e.target.value)} />
        </div>
        <div>
          <label style={label}>Transportadora / descripción</label>
          <input className="input" value={description} disabled={!allowEdit} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label style={label}>Capacidad (pallets)</label>
          <input className="input" type="number" min={1} value={capacityPallets} disabled={!allowEdit} onChange={(e) => setCapacityPallets(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label style={label}>Capacidad (kg)</label>
          <input className="input" type="number" min={1} value={capacityKg} disabled={!allowEdit} onChange={(e) => setCapacityKg(e.target.value)} placeholder="—" />
        </div>
      </div>
      <div>
        <label style={label}>Notas / observaciones</label>
        <textarea className="input" rows={3} value={notes} disabled={!allowEdit} onChange={(e) => setNotes(e.target.value)} placeholder="Seguro, RUA, mantenimiento programado…" />
      </div>
      {allowEdit && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn--primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Guardando…" : "✓ Guardar ficha"}
          </button>
          {allowDelete && (
            <button className="btn" style={{ color: "var(--danger)", marginLeft: "auto" }} onClick={onDelete}>
              Eliminar vehículo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Choferes asociados ────────────────────────────────────────────────────── */
function ChoferesTab({ vehicle, allowEdit, onChanged }: { vehicle: Transport; allowEdit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<TransportDriver[]>(vehicle.drivers);

  const mut = useMutation({
    mutationFn: (next: TransportDriver[]) => updateTransport(vehicle.id, { drivers: next }),
    onSuccess: () => { toast.success("Choferes actualizados"); onChanged(); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function setRow(i: number, field: keyof TransportDriver, val: string) {
    setDrivers((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));
  }
  function addRow() { setDrivers((d) => [...d, { name: "", document: "", phone: "", license: "", licenseExpiry: "", status: "ACTIVO" }]); }
  function removeRow(i: number) { setDrivers((d) => d.filter((_, idx) => idx !== i)); }

  // Validaciones: nombre y CI obligatorios; teléfono válido si se ingresó.
  const invalidPhone = (d: TransportDriver) => !!d.phone?.trim() && !isValidParaguayPhone(d.phone);
  const hasErrors = drivers.some((d) => !d.name.trim() || !d.document?.trim() || invalidPhone(d));

  function save() {
    if (hasErrors) { toast.error("Revisá nombre, CI y formato de teléfono de los choferes."); return; }
    const clean = drivers
      .map((d) => ({
        name: d.name.trim(),
        document: d.document?.trim() || undefined,
        phone: d.phone?.trim() || undefined,
        license: d.license?.trim() || undefined,
        licenseExpiry: d.licenseExpiry?.trim() || undefined,
        status: d.status || "ACTIVO",
      }))
      .filter((d) => d.name);
    mut.mutate(clean);
  }

  const label: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 };

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 760 }}>
      {drivers.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Sin choferes asociados.</p>}
      {drivers.map((d, i) => (
        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Nombre completo *</label>
              <input className="input" value={d.name} disabled={!allowEdit} onChange={(e) => setRow(i, "name", e.target.value)}
                aria-invalid={!d.name.trim()} />
            </div>
            <div>
              <label style={label}>Número de CI *</label>
              <input className="input" value={d.document ?? ""} disabled={!allowEdit} onChange={(e) => setRow(i, "document", e.target.value)}
                aria-invalid={!d.document?.trim()} placeholder="Ej: 1234567" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Teléfono</label>
              <input className="input" value={d.phone ?? ""} disabled={!allowEdit}
                onChange={(e) => setRow(i, "phone", formatParaguayPhone(e.target.value))}
                onFocus={(e) => { if (!e.target.value) setRow(i, "phone", "+595 "); }}
                placeholder="+595 981 123456" inputMode="tel" aria-invalid={invalidPhone(d)} />
              {invalidPhone(d) && <span style={{ fontSize: 11, color: "var(--danger)" }}>Formato: +595 981 123456</span>}
            </div>
            <div>
              <label style={label}>Licencia</label>
              <input className="input" value={d.license ?? ""} disabled={!allowEdit} onChange={(e) => setRow(i, "license", e.target.value)}
                placeholder="N° de licencia" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
            <div>
              <label style={label}>Vencimiento de licencia</label>
              <input className="input" type="date" value={d.licenseExpiry ?? ""} disabled={!allowEdit} onChange={(e) => setRow(i, "licenseExpiry", e.target.value)} />
            </div>
            <div>
              <label style={label}>Estado</label>
              <select className="input" value={d.status ?? "ACTIVO"} disabled={!allowEdit} onChange={(e) => setRow(i, "status", e.target.value)}>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </div>
            {allowEdit && (
              <button type="button" className="btn" style={{ color: "var(--danger)", padding: "6px 12px" }} onClick={() => removeRow(i)} aria-label="Quitar chofer">Quitar</button>
            )}
          </div>
        </div>
      ))}
      {allowEdit && (
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn" onClick={addRow}>+ Agregar chofer</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={mut.isPending || hasErrors}>
            {mut.isPending ? "Guardando…" : "✓ Guardar choferes"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Documentos & Foto ─────────────────────────────────────────────────────── */
function DocsTab({ vehicleId, attachments, photo, loading, allowEdit }: {
  vehicleId: string;
  attachments: { id: string; name: string; originalName: string; category: string; mimeType: string; fileSize: number; createdAt: string }[];
  photo?: { id: string };
  loading: boolean;
  allowEdit: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const delMut = useMutation({
    mutationFn: (id: string) => deleteAttachment(id),
    onSuccess: () => { toast.success("Archivo eliminado"); void queryClient.invalidateQueries({ queryKey: ["dispatch-log", "VEHICLE", vehicleId] }); },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Foto del camión */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>Foto del camión</div>
        {photo ? <VehiclePhoto attachmentId={photo.id} /> : (
          <div style={{ height: 120, borderRadius: 10, background: "var(--bg)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>
            Sin foto — subí una imagen con categoría “Camión”.
          </div>
        )}
      </div>

      {/* Subir documento */}
      {allowEdit && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>Adjuntar documento o foto del vehículo</div>
          <AttachmentUploader entityType="VEHICLE" entityId={vehicleId} categories={["CAMION", "OTRO"]} defaultCategory="CAMION" />
        </div>
      )}

      {/* Lista de documentos */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Documentos {attachments.length > 0 && `(${attachments.length})`}
        </div>
        {loading ? <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando…</p> : attachments.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin documentos. Cédula verde, seguro, habilitación, RUA…</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {attachments.map((a) => {
              const cat = ATTACHMENT_CATEGORIES.find((c) => c.value === a.category);
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
                  <span style={{ fontSize: 20 }}>{fileIcon(a.mimeType)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{cat?.icon} {cat?.label} · {a.originalName} · {formatBytes(a.fileSize)} · {fmtDate(a.createdAt)}</div>
                  </div>
                  <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => void openAttachmentBlob(a.id)}>Ver</button>
                  {allowEdit && (
                    <button className="btn" style={{ fontSize: 12, padding: "4px 8px", color: "var(--danger)" }} onClick={() => delMut.mutate(a.id)} disabled={delMut.isPending}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Historial de entradas/salidas ─────────────────────────────────────────── */
function HistorialTab({ vehicleId }: { vehicleId: string }) {
  const histQ = useQuery({
    queryKey: ["transport-history", vehicleId],
    queryFn: () => getTransportHistory(vehicleId),
  });

  if (histQ.isLoading) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Cargando historial…</p>;
  if (histQ.isError || !histQ.data) return <p className="form-error">No se pudo cargar el historial.</p>;

  const { documents, summary } = histQ.data;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
        {[
          { label: "Viajes", value: summary.totalTrips },
          { label: "Entradas", value: summary.entries },
          { label: "Salidas", value: summary.exits },
          { label: "Último viaje", value: fmtDate(summary.lastTrip) },
        ].map((k) => (
          <div key={k.label} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {documents.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Sin viajes registrados. Al cargar un remito de entrada/salida con este vehículo en “Datos logísticos”, aparecerá acá.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ margin: 0 }}>
            <thead>
              <tr><th>Remito</th><th>Tipo</th><th>Fecha</th><th>Origen / Destino</th><th style={{ textAlign: "right" }}>Ítems</th></tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{d.code}</td>
                  <td>
                    <span className="badge" style={{ background: d.type === "ENTRY" ? "var(--badge-entry-bg, #dcfce7)" : "var(--badge-exit-bg, #fee2e2)", color: d.type === "ENTRY" ? "#166534" : "#991b1b", fontSize: 11 }}>
                      {d.type === "ENTRY" ? "Entrada" : "Salida"}
                    </span>
                  </td>
                  <td>{fmtDate(d.date)}</td>
                  <td style={{ color: "var(--muted)", fontSize: 13 }}>{d.supplier || d.destination || "—"}</td>
                  <td style={{ textAlign: "right" }}>{d.totalLines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Bitácora de inspecciones ──────────────────────────────────────────────── */
function InspeccionesTab({ vehicle, events, allowEdit, onChanged }: {
  vehicle: Transport;
  events: { id: string; eventType: string; description: string; createdAt: string; username?: string | null }[];
  allowEdit: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<"APROBADA" | "CON_OBSERVACIONES" | "RECHAZADA">("APROBADA");
  const [notes, setNotes] = useState("");
  const [setStatus, setSetStatus] = useState<TransportStatus | "">("");

  const mut = useMutation({
    mutationFn: () => registerInspection(vehicle.id, {
      result,
      notes: notes.trim() || undefined,
      setStatus: setStatus || undefined,
    }),
    onSuccess: () => {
      toast.success("Inspección registrada");
      setNotes(""); setSetStatus("");
      void queryClient.invalidateQueries({ queryKey: ["dispatch-log", "VEHICLE", vehicle.id] });
      onChanged();
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const RESULTS: { value: typeof result; label: string; color: string }[] = [
    { value: "APROBADA", label: "✓ Aprobada", color: "var(--success)" },
    { value: "CON_OBSERVACIONES", label: "⚠ Con observaciones", color: "var(--warning)" },
    { value: "RECHAZADA", label: "✗ Rechazada", color: "var(--danger)" },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Registrar inspección */}
      {allowEdit && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>🔍 Registrar inspección</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {RESULTS.map((r) => (
              <button
                key={r.value}
                type="button"
                className="btn"
                onClick={() => setResult(r.value)}
                style={{
                  fontSize: 12,
                  background: result === r.value ? r.color : undefined,
                  color: result === r.value ? "#fff" : undefined,
                  borderColor: result === r.value ? r.color : undefined,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea className="input" rows={2} placeholder="Observaciones de la inspección (frenos, neumáticos, limpieza, temperatura…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select className="input" value={setStatus} onChange={(e) => setSetStatus(e.target.value as TransportStatus | "")} style={{ width: 220 }}>
              <option value="">No cambiar estado operativo</option>
              {TRANSPORT_STATUSES.map((s) => <option key={s.value} value={s.value}>Marcar: {s.icon} {s.label}</option>)}
            </select>
            <button className="btn btn--primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? "Registrando…" : "Registrar inspección"}
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>
          Bitácora {events.length > 0 && `(${events.length})`}
        </div>
        {events.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin eventos registrados.</p>
        ) : (
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 15, top: 0, bottom: 0, width: 2, background: "var(--border)" }} />
            <div style={{ display: "grid", gap: 0 }}>
              {events.map((ev, idx) => (
                <div key={ev.id} style={{ display: "flex", gap: 12, paddingBottom: idx < events.length - 1 ? 16 : 0, position: "relative" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--panel)", border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, zIndex: 1 }}>
                    {EVENT_ICONS[ev.eventType] ?? "●"}
                  </div>
                  <div style={{ flex: 1, paddingTop: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{ev.description}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, display: "flex", gap: 10 }}>
                      <span>{fmtDateTime(ev.createdAt)}</span>
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
  );
}
