import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWarehouse,
  deleteWarehouse,
  getWarehouseLayout,
  listWarehouses,
  type LayoutLocation,
  type Warehouse,
} from "../api/warehouses";
import { generateLocations, updateLocation, zoneMeta, LOCATION_ZONES, type LocationZone } from "../api/locations";
import { listPallets } from "../api/pallets";
import { useAuth } from "../auth/AuthContext";
import { canCreate, canDelete } from "../auth/rbac";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

/* ── Colores de celda según ocupación ──────────────────────────────────── */
function cellStyle(l: LayoutLocation): React.CSSProperties {
  if (!l.active) {
    return { background: "var(--panel)", border: "1px dashed var(--border)", color: "var(--muted)", opacity: 0.55 };
  }
  if (l.pallets === 0) {
    return { background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)" };
  }
  if (l.capacityPallets && l.pallets >= l.capacityPallets) {
    return { background: "var(--badge-adjout-bg)", border: "1.5px solid var(--warning)", color: "var(--badge-adjout-text)", fontWeight: 800 };
  }
  return { background: "var(--primary-light)", border: "1.5px solid var(--primary)", color: "var(--primary)", fontWeight: 800 };
}

export default function WarehousesPage() {
  const { user } = useAuth();
  const role = user?.role;
  const allowCreate = role ? canCreate("warehouses", role) : false;
  const allowDelete = role ? canDelete("warehouses", role) : false;
  const allowStructure = role ? canCreate("locations", role) : false;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const nameId = useId();

  /* ── Depósitos ── */
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nameError = useMemo(() => {
    const value = name.trim();
    if (!value) return "Ingresá un nombre.";
    if (value.length < 2 || value.length > 80) return "El nombre debe tener entre 2 y 80 caracteres.";
    return "";
  }, [name]);

  const { data: items = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["warehouses"],
    queryFn: listWarehouses,
  });

  // Auto-seleccionar el primer depósito
  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId]);

  /* ── Layout del depósito seleccionado ── */
  const layoutQ = useQuery({
    queryKey: ["warehouse-layout", selectedId],
    queryFn: () => getWarehouseLayout(selectedId!),
    enabled: !!selectedId,
    staleTime: 15_000,
  });
  const layout = layoutQ.data;
  const [zoneFilter, setZoneFilter] = useState<string>("ALL");

  /* ── Detalle de ubicación (drawer) ── */
  const [locDetail, setLocDetail] = useState<LayoutLocation | null>(null);
  const locPalletsQ = useQuery({
    queryKey: ["pallets", "by-location", locDetail?.id],
    queryFn: () => listPallets({ locationId: locDetail!.id }),
    enabled: !!locDetail,
    staleTime: 10_000,
  });

  /* ── Generador de estructura ── */
  const [showGen, setShowGen] = useState(false);
  const [genZone, setGenZone] = useState<LocationZone>("ALMACENAMIENTO");
  const [genPrefix, setGenPrefix] = useState("");
  const [genAisles, setGenAisles] = useState("A");
  const [genRacks, setGenRacks] = useState("2");
  const [genLevels, setGenLevels] = useState("3");
  const [genPositions, setGenPositions] = useState("4");
  const [genCapacity, setGenCapacity] = useState("1");

  const genAisleList = genAisles.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
  const genIsRack = genAisleList.length > 0;
  const genTotal = (genAisleList.length || 1)
    * (genIsRack ? Math.max(1, Number(genRacks) || 1) : 1)
    * (genIsRack ? Math.max(1, Number(genLevels) || 1) : 1)
    * Math.max(1, Number(genPositions) || 1);
  const genExample = [
    genPrefix.trim().toUpperCase() || null,
    genIsRack ? genAisleList[0] : null,
    genIsRack ? "R1" : null,
    genIsRack ? "N1" : null,
    "P1",
  ].filter(Boolean).join("-");

  function invalidateLayout() {
    void queryClient.invalidateQueries({ queryKey: ["warehouse-layout"] });
    void queryClient.invalidateQueries({ queryKey: ["locations"] });
  }

  const createMut = useMutation({
    mutationFn: createWarehouse,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      toast.success(`Depósito ${created.name} creado`);
      setName(""); setAddress(""); setSubmitted(false);
      setSelectedId(created.id);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWarehouse(id),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      if (selectedId === id) setSelectedId(null);
      toast.success("Depósito eliminado");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const genMut = useMutation({
    mutationFn: generateLocations,
    onSuccess: (res) => {
      toast.success(`Estructura generada: ${res.created} ubicación(es) nueva(s)${res.skipped > 0 ? ` · ${res.skipped} ya existían` : ""}`);
      invalidateLayout();
      setShowGen(false);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const toggleLocMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateLocation(id, { active }),
    onSuccess: (loc) => {
      toast.success(`Ubicación ${loc.code} ${loc.active ? "activada" : "desactivada"}`);
      invalidateLayout();
      setLocDetail((d) => (d && d.id === loc.id ? { ...d, active: loc.active ?? true } : d));
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || deleteMut.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!allowCreate || nameError) return;
    createMut.mutate({ name: name.trim(), address: address.trim(), active: true });
  }

  function handleDelete(item: Warehouse) {
    if (!allowDelete) return;
    if (!window.confirm(`Eliminar depósito ${item.name}?`)) return;
    deleteMut.mutate(item.id);
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    genMut.mutate({
      warehouseId: selectedId,
      zone: genZone,
      codePrefix: genPrefix.trim() || undefined,
      aisles: genIsRack ? genAisleList : undefined,
      racks: genIsRack ? Math.max(1, Number(genRacks) || 1) : undefined,
      levels: genIsRack ? Math.max(1, Number(genLevels) || 1) : undefined,
      positions: Math.max(1, Number(genPositions) || 1),
      capacityPallets: Number(genCapacity) > 0 ? Number(genCapacity) : undefined,
    });
  }

  /* ── Datos del mapa (filtrados por zona) ── */
  const filteredLocs = useMemo(() => {
    const locs = layout?.locations ?? [];
    if (zoneFilter === "ALL") return locs;
    return locs.filter((l) => (l.zone ?? "SIN_ZONA") === zoneFilter);
  }, [layout, zoneFilter]);

  /** Pasillo → Rack → posiciones (estructuradas) */
  const aisleGroups = useMemo(() => {
    const structured = filteredLocs.filter((l) => l.aisle);
    const byAisle = new Map<string, Map<string, LayoutLocation[]>>();
    for (const l of structured) {
      const aisle = l.aisle!;
      const rack = l.rack ?? "—";
      const racks = byAisle.get(aisle) ?? new Map<string, LayoutLocation[]>();
      const cells = racks.get(rack) ?? [];
      cells.push(l);
      racks.set(rack, cells);
      byAisle.set(aisle, racks);
    }
    return [...byAisle.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([aisle, racks]) => ({
        aisle,
        racks: [...racks.entries()]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([rack, cells]) => ({ rack, cells })),
      }));
  }, [filteredLocs]);

  /** Ubicaciones sin estructura (sin pasillo): chips simples */
  const flatLocs = useMemo(() => filteredLocs.filter((l) => !l.aisle), [filteredLocs]);

  const summary = layout?.summary;
  const occupancyPct = summary && summary.totalLocations > 0
    ? Math.round((summary.occupied / summary.totalLocations) * 100)
    : 0;

  /* ── Celda del mapa ── */
  function renderCell(l: LayoutLocation, size: number = 38) {
    return (
      <button
        key={l.id}
        type="button"
        onClick={() => setLocDetail(l)}
        title={`${l.code} · ${l.pallets} pallet(s) · ${l.units.toLocaleString("es-PY")} unid.${l.capacityPallets ? ` · cap. ${l.capacityPallets}` : ""}${l.active ? "" : " · INACTIVA"}`}
        style={{
          width: size, height: size, borderRadius: 6, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontFamily: "monospace", padding: 0,
          ...cellStyle(l),
        }}
        aria-label={`Ubicación ${l.code}, ${l.pallets} pallets`}
      >
        {l.pallets > 0 ? l.pallets : ""}
      </button>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Depósitos</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>
          {!allowCreate ? "Modo lectura." : "Estructura, ocupación y mapa del depósito: zonas, pasillos, racks, niveles y posiciones."}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>

        {/* ── Columna izquierda: lista + alta ── */}
        <div style={{ display: "grid", gap: 10 }}>
          {allowCreate && (
            <form onSubmit={handleSubmit} className="card" style={{ display: "grid", gap: 8, padding: 14 }} aria-label="Nuevo depósito">
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Nuevo depósito</div>
              <input
                id={nameId}
                className="input"
                disabled={saving}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre"
                aria-label="Nombre del depósito"
                aria-invalid={submitted && !!nameError}
              />
              <input
                className="input"
                disabled={saving}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Dirección"
                aria-label="Dirección"
              />
              {submitted && nameError ? <p className="form-error" role="alert" style={{ margin: 0 }}>{nameError}</p> : null}
              <button className="btn btn--primary" type="submit" disabled={saving}>
                {createMut.isPending ? "Guardando..." : "Guardar"}
              </button>
            </form>
          )}

          {isLoading ? <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando…</p> : null}
          {isError ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
              <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar.</p>
              <button className="btn btn--primary" onClick={() => refetch()}>Reintentar</button>
            </div>
          ) : null}

          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSelectedId(item.id)}
              className="card"
              style={{
                padding: "12px 14px", cursor: "pointer",
                border: `1.5px solid ${selectedId === item.id ? "var(--primary)" : "var(--border)"}`,
                background: selectedId === item.id ? "var(--primary-light)" : undefined,
              }}
              aria-label={`Ver depósito ${item.name}`}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{item.name}</strong>
                <span className={item.active ? "badge badge--entry" : "badge"} style={{ fontSize: 10 }}>
                  {item.active ? "Activo" : "Inactivo"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{item.address || "—"}</div>
              {selectedId === item.id && summary && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                  {summary.totalLocations} ubicaciones · {summary.totalPallets} pallets
                </div>
              )}
              {allowDelete && (
                <button
                  className="btn"
                  onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                  disabled={saving}
                  style={{ fontSize: 11, padding: "3px 10px", color: "var(--danger)", marginTop: 8 }}
                  aria-label={`Eliminar depósito ${item.name}`}
                >
                  Eliminar
                </button>
              )}
            </div>
          ))}
          {!isLoading && !isError && items.length === 0 && <p>No hay registros</p>}
        </div>

        {/* ── Columna derecha: layout del depósito ── */}
        <div className="card" style={{ minHeight: 400 }}>
          {!selectedId ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Seleccioná un depósito para ver su estructura.</p>
          ) : layoutQ.isLoading ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }} aria-busy="true">Cargando layout...</p>
          ) : !layout ? (
            <p className="form-error">No se pudo cargar el layout.</p>
          ) : (
            <>
              {/* KPIs */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{layout.warehouse.name}</h3>
                {allowStructure && (
                  <button type="button" className="btn btn--primary" style={{ fontSize: 13 }} onClick={() => setShowGen(true)}>
                    ⚙ Generar estructura
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Ubicaciones", value: summary!.totalLocations.toLocaleString("es-PY") },
                  { label: "Ocupadas", value: summary!.occupied.toLocaleString("es-PY") },
                  { label: "Libres", value: (summary!.totalLocations - summary!.occupied).toLocaleString("es-PY") },
                  { label: "Pallets", value: summary!.totalPallets.toLocaleString("es-PY") },
                  { label: "Unidades", value: summary!.totalUnits.toLocaleString("es-PY") },
                  { label: "Ocupación", value: `${occupancyPct}%` },
                ].map((k) => (
                  <div key={k.label} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{k.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Filtro por zona */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => setZoneFilter("ALL")}
                  className="btn"
                  style={{
                    fontSize: 12, padding: "4px 12px",
                    background: zoneFilter === "ALL" ? "var(--primary)" : undefined,
                    color: zoneFilter === "ALL" ? "#fff" : undefined,
                  }}
                >
                  Todas ({summary!.totalLocations})
                </button>
                {summary!.byZone.map((z) => {
                  const meta = zoneMeta(z.zone);
                  return (
                    <button
                      key={z.zone}
                      type="button"
                      onClick={() => setZoneFilter(z.zone)}
                      className="btn"
                      style={{
                        fontSize: 12, padding: "4px 12px",
                        background: zoneFilter === z.zone ? "var(--primary)" : undefined,
                        color: zoneFilter === z.zone ? "#fff" : undefined,
                      }}
                    >
                      {meta ? `${meta.icon} ${meta.label}` : z.zone === "SIN_ZONA" ? "Sin zona" : z.zone} ({z.locations})
                    </button>
                  );
                })}
              </div>

              {/* Leyenda */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "var(--bg)", border: "1px solid var(--border)", verticalAlign: "middle", marginRight: 4 }} />Libre</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "var(--primary-light)", border: "1.5px solid var(--primary)", verticalAlign: "middle", marginRight: 4 }} />Ocupada (n pallets)</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "var(--badge-adjout-bg)", border: "1.5px solid var(--warning)", verticalAlign: "middle", marginRight: 4 }} />Llena (≥ capacidad)</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "var(--panel)", border: "1px dashed var(--border)", verticalAlign: "middle", marginRight: 4 }} />Inactiva</span>
              </div>

              {/* Mapa */}
              {filteredLocs.length === 0 ? (
                <div style={{ background: "var(--bg)", border: "1px dashed var(--border)", borderRadius: 10, padding: "28px 20px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  {layout.locations.length === 0
                    ? <>Este depósito todavía no tiene ubicaciones.{allowStructure && <> Usá <strong>⚙ Generar estructura</strong> para crear zonas, pasillos, racks y posiciones en un paso.</>}</>
                    : "No hay ubicaciones en esta zona."}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {/* Pasillos estructurados */}
                  {aisleGroups.map((g) => (
                    <div key={g.aisle} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ background: "var(--bg)", padding: "7px 12px", fontSize: 13, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>
                        Pasillo {g.aisle}
                        <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
                          {g.racks.length} rack{g.racks.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 14, padding: 12, flexWrap: "wrap" }}>
                        {g.racks.map((r) => {
                          const levels = [...new Set(r.cells.map((c) => c.level ?? 1))].sort((a, b) => b - a);
                          return (
                            <div key={r.rack}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 4, textAlign: "center" }}>{r.rack}</div>
                              <div style={{ display: "grid", gap: 3 }}>
                                {levels.map((lvl) => {
                                  const cells = r.cells
                                    .filter((c) => (c.level ?? 1) === lvl)
                                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                                  return (
                                    <div key={lvl} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                                      <span style={{ fontSize: 9, color: "var(--muted)", width: 20, fontFamily: "monospace" }}>N{lvl}</span>
                                      {cells.map((c) => renderCell(c))}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Ubicaciones sin estructura */}
                  {flatLocs.length > 0 && (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ background: "var(--bg)", padding: "7px 12px", fontSize: 13, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>
                        {aisleGroups.length > 0 ? "Otras ubicaciones" : "Ubicaciones"}
                      </div>
                      <div style={{ display: "flex", gap: 6, padding: 12, flexWrap: "wrap" }}>
                        {flatLocs.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => setLocDetail(l)}
                            style={{
                              borderRadius: 7, cursor: "pointer", padding: "6px 10px",
                              fontSize: 12, fontFamily: "monospace", fontWeight: 600,
                              ...cellStyle(l),
                            }}
                            title={`${l.pallets} pallet(s) · ${l.units.toLocaleString("es-PY")} unid.`}
                          >
                            {l.code}{l.pallets > 0 ? ` · ${l.pallets}` : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Drawer: detalle de ubicación ── */}
      {locDetail && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }} onClick={() => setLocDetail(null)}>
          <div style={{ flex: 1, background: "rgba(0,0,0,0.45)" }} />
          <div
            style={{ width: "min(480px, 100vw)", background: "var(--bg-base)", display: "flex", flexDirection: "column", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>{locDetail.code}</h3>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  {zoneMeta(locDetail.zone) ? `${zoneMeta(locDetail.zone)!.icon} ${zoneMeta(locDetail.zone)!.label}` : "Sin zona"}
                  {locDetail.aisle && <> · Pasillo {locDetail.aisle}</>}
                  {locDetail.rack && <> · {locDetail.rack}</>}
                  {locDetail.level != null && <> · Nivel {locDetail.level}</>}
                  {locDetail.position != null && <> · Pos. {locDetail.position}</>}
                </p>
              </div>
              <button onClick={() => setLocDetail(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
            </div>

            <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Pallets</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>
                    {locDetail.pallets}{locDetail.capacityPallets ? <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}> / {locDetail.capacityPallets}</span> : null}
                  </div>
                </div>
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Unidades</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{locDetail.units.toLocaleString("es-PY")}</div>
                </div>
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Estado</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: locDetail.active ? "var(--success)" : "var(--danger)" }}>
                    {locDetail.active ? "Activa" : "Inactiva"}
                  </div>
                </div>
              </div>

              {allowStructure && (
                <button
                  type="button"
                  className="btn"
                  style={{ justifySelf: "start", fontSize: 12, color: locDetail.active ? "var(--danger)" : "var(--success)" }}
                  disabled={toggleLocMut.isPending}
                  onClick={() => toggleLocMut.mutate({ id: locDetail.id, active: !locDetail.active })}
                >
                  {toggleLocMut.isPending ? "Guardando..." : locDetail.active ? "Desactivar ubicación" : "Activar ubicación"}
                </button>
              )}

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
                  Pallets ubicados {locPalletsQ.data ? `(${locPalletsQ.data.filter((p) => p.status !== "EXITED" && p.status !== "EMPTY").length})` : ""}
                </div>
                {locPalletsQ.isLoading ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>Cargando...</p>
                ) : (locPalletsQ.data ?? []).filter((p) => p.status !== "EXITED" && p.status !== "EMPTY").length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>Ubicación libre — sin pallets.</p>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {(locPalletsQ.data ?? [])
                      .filter((p) => p.status !== "EXITED" && p.status !== "EMPTY")
                      .map((p) => (
                        <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{p.code}</span>
                            <span style={{ fontWeight: 800, fontSize: 13, marginLeft: "auto" }}>{p.quantity.toLocaleString("es-PY")} unid.</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            {p.productCode} · {p.productDescription}
                            {p.lotCode && <> · Lote {p.lotCode}</>}
                            {p.fechaVencimiento && <> · Vence {new Date(p.fechaVencimiento).toLocaleDateString("es-PY", { timeZone: "America/Asuncion" })}</>}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: generar estructura ── */}
      {showGen && selectedId && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowGen(false)}
        >
          <form
            className="card"
            style={{ width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 12 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleGenerate}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>⚙ Generar estructura</h3>
              <button type="button" onClick={() => setShowGen(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }} aria-label="Cerrar">×</button>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
              Crea las posiciones de una zona en lote. Las que ya existen se saltean (podés re-ejecutar sin duplicar).
            </p>

            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Zona *</label>
              <select className="input" value={genZone} onChange={(e) => setGenZone(e.target.value as LocationZone)}>
                {LOCATION_ZONES.map((z) => <option key={z.value} value={z.value}>{z.icon} {z.label}</option>)}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Prefijo de código</label>
                <input className="input" value={genPrefix} onChange={(e) => setGenPrefix(e.target.value)} placeholder="Ej: REC (opcional)" maxLength={10} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Pasillos (separados por coma)</label>
                <input className="input" value={genAisles} onChange={(e) => setGenAisles(e.target.value)} placeholder='Ej: A,B,C — vacío = zona plana' />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: genIsRack ? "1fr 1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
              {genIsRack && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Racks / pasillo</label>
                    <input className="input" type="number" min={1} max={50} value={genRacks} onChange={(e) => setGenRacks(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Niveles / rack</label>
                    <input className="input" type="number" min={1} max={10} value={genLevels} onChange={(e) => setGenLevels(e.target.value)} />
                  </div>
                </>
              )}
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>{genIsRack ? "Posiciones / nivel" : "Posiciones"}</label>
                <input className="input" type="number" min={1} max={100} value={genPositions} onChange={(e) => setGenPositions(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: 3 }}>Capacidad (pallets)</label>
                <input className="input" type="number" min={0} value={genCapacity} onChange={(e) => setGenCapacity(e.target.value)} placeholder="0 = sin límite" />
              </div>
            </div>

            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
              Se generarán <strong>{genTotal.toLocaleString("es-PY")}</strong> ubicaciones
              {" "}· código de ejemplo: <strong style={{ fontFamily: "monospace" }}>{genExample}</strong>
              {genTotal > 2000 && <div style={{ color: "var(--danger)", fontWeight: 700, marginTop: 4 }}>Máximo 2000 por tanda — reducí la estructura.</div>}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn--primary" type="submit" disabled={genMut.isPending || genTotal > 2000}>
                {genMut.isPending ? "Generando..." : `Generar ${genTotal.toLocaleString("es-PY")} ubicaciones`}
              </button>
              <button type="button" className="btn" onClick={() => setShowGen(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
