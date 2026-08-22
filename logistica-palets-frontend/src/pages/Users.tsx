import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, listUsers, type AppUser } from "../api/users";
import { listWarehouses, warehouseLabel } from "../api/warehouses";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";
import UserFichaDrawer from "../components/users/UserFichaDrawer";

const ROLES = ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"] as const;
type UserRole = (typeof ROLES)[number];
const MANAGER_ROLES: UserRole[] = ["OPERATOR", "AUDITOR"];

const ROLE_BADGE: Record<string, string> = {
  ADMIN:    "badge badge--role-admin",
  MANAGER:  "badge badge--role-manager",
  OPERATOR: "badge badge--role-operator",
  AUDITOR:  "badge badge--role-auditor",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN:    "Administrador",
  MANAGER:  "Gerente",
  OPERATOR: "Operador",
  AUDITOR:  "Auditor",
};

// Misma política que el backend (`password-policy.ts`): 8+ caracteres, letras y números.
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function initials(user: AppUser) {
  const src = user.fullName?.trim() || user.username;
  return src.slice(0, 2).toUpperCase();
}

/* ══════════════════════════════════════════════════════════════════════════════
   MODAL DE ALTA
   ══════════════════════════════════════════════════════════════════════════════ */
function NewUserModal({ actorRole, onClose, onCreated }: {
  actorRole: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const availableRoles = actorRole === "MANAGER" ? MANAGER_ROLES : ROLES;

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<UserRole>(availableRoles.includes("OPERATOR") ? "OPERATOR" : availableRoles[0]);
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const idFull = useId(); const idUser = useId(); const idPass = useId();
  const idConf = useId(); const idRole = useId();

  const errUsername = !username.trim() ? "El usuario es obligatorio." : username.trim().length < 3 ? "Mínimo 3 caracteres." : "";
  const errPassword = !password ? "La contraseña es obligatoria." : !PASSWORD_PATTERN.test(password) ? "Mínimo 8 caracteres, con letras y números." : "";
  const errConfirm = password !== confirm ? "Las contraseñas no coinciden." : "";
  const hasErrors = !!errUsername || !!errPassword || !!errConfirm;

  const createMut = useMutation({
    mutationFn: () => createUser({
      username: username.trim(),
      password,
      role,
      fullName: fullName.trim() || undefined,
      mustChangePassword,
    }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario creado. Asignale depósitos y permisos en su ficha.");
      onCreated(created.id);
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    createMut.mutate();
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)",
    marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px",
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="new-user-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 id="new-user-title" style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Nuevo usuario</h2>
          <button className="btn" onClick={onClose} aria-label="Cerrar" style={{ padding: "4px 10px" }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor={idFull} style={labelStyle}>Nombre completo <span style={{ fontWeight: 400 }}>(opcional)</span></label>
            <input id={idFull} className="input" style={{ width: "100%" }}
              value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Juan Pérez" disabled={createMut.isPending} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor={idUser} style={labelStyle}>Usuario *</label>
            <input id={idUser} className="input" style={{ width: "100%" }}
              value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
              placeholder="Ej: jperez" disabled={createMut.isPending}
              aria-invalid={submitted && !!errUsername} />
            {submitted && errUsername && <p className="form-error" role="alert">{errUsername}</p>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor={idRole} style={labelStyle}>Rol *</label>
            <select id={idRole} className="input" style={{ width: "100%" }}
              value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={createMut.isPending}>
              {availableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]} ({r})</option>)}
            </select>
          </div>

          <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
              Contraseña temporal *
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <input id={idPass} className="input" type="password" style={{ width: "100%" }}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contraseña" disabled={createMut.isPending}
                  aria-invalid={submitted && !!errPassword} autoComplete="new-password" />
                {submitted && errPassword && <p className="form-error" role="alert">{errPassword}</p>}
              </div>
              <div>
                <input id={idConf} className="input" type="password" style={{ width: "100%" }}
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirmar" disabled={createMut.isPending}
                  aria-invalid={submitted && !!errConfirm} autoComplete="new-password" />
                {submitted && errConfirm && <p className="form-error" role="alert">{errConfirm}</p>}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" checked={mustChangePassword} onChange={(e) => setMustChangePassword(e.target.checked)} disabled={createMut.isPending} />
              Debe cambiarla en su primer ingreso
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" className="btn" onClick={onClose} disabled={createMut.isPending}>Cancelar</button>
            <button type="submit" className="btn btn--primary" disabled={createMut.isPending}>
              {createMut.isPending ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   PÁGINA PRINCIPAL
   ══════════════════════════════════════════════════════════════════════════════ */
export default function UsersPage() {
  const { user: me } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");

  const { data: users = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
  });
  const warehousesQ = useQuery({ queryKey: ["warehouses"], queryFn: listWarehouses });

  const actorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.id, u.fullName || u.username);
    return map;
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !`${u.fullName ?? ""} ${u.username}`.toLowerCase().includes(q)) return false;
      if (estadoFilter === "active" && !u.active) return false;
      if (estadoFilter === "inactive" && u.active) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (warehouseFilter !== "all" && !(u.warehouseIds ?? []).includes(warehouseFilter)) return false;
      return true;
    });
  }, [users, search, estadoFilter, roleFilter, warehouseFilter]);

  const filtersActive = search.trim() !== "" || estadoFilter !== "all" || roleFilter !== "all" || warehouseFilter !== "all";

  return (
    <div>
      {/* ── Encabezado ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Usuarios y Permisos</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Cuentas, roles, depósitos y permisos del sistema.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setCreateOpen(true)} style={{ flexShrink: 0 }}>
          + Nuevo usuario
        </button>
      </div>

      {/* ── Buscador + filtros rápidos ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          className="input"
          style={{ flex: "1 1 220px", minWidth: 180 }}
          placeholder="Buscar por nombre o usuario…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar usuario"
        />
        <select className="input" style={{ width: 150 }} value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as typeof estadoFilter)} aria-label="Filtrar por estado">
          <option value="all">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
        <select className="input" style={{ width: 170 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)} aria-label="Filtrar por rol">
          <option value="all">Todos los roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select className="input" style={{ width: 190 }} value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} aria-label="Filtrar por depósito">
          <option value="all">Todos los depósitos</option>
          {(warehousesQ.data ?? []).map((w) => <option key={w.id} value={w.id}>{warehouseLabel(w)}</option>)}
        </select>
        {filtersActive && (
          <button className="btn" onClick={() => { setSearch(""); setEstadoFilter("all"); setRoleFilter("all"); setWarehouseFilter("all"); }}>
            Limpiar filtros
          </button>
        )}
      </div>

      {/* ── Estados de carga / error ── */}
      {isLoading && <p aria-busy="true" style={{ color: "var(--muted)" }}>Cargando usuarios…</p>}
      {isError && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }} role="alert">
          <p className="form-error" style={{ marginBottom: 0 }}>No se pudo cargar la lista.</p>
          <button className="btn btn--primary" onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      {/* ── Tabla ── */}
      {!isLoading && !isError && (
        filtered.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            {users.length === 0 ? "No hay usuarios registrados." : "Ningún usuario coincide con la búsqueda."}
          </p>
        ) : (
          <table className="table" aria-label="Lista de usuarios">
            <thead>
              <tr>
                <th scope="col" style={{ width: 48 }} />
                <th scope="col">Nombre / Usuario</th>
                <th scope="col">Rol</th>
                <th scope="col">Depósitos</th>
                <th scope="col">Estado</th>
                <th scope="col" style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isSelf = u.id === me?.userId;
                const warehouseCount = u.warehouseIds?.length ?? 0;
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "var(--primary-light)", border: "1.5px solid var(--primary)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 800, color: "var(--primary)",
                        letterSpacing: ".5px", flexShrink: 0,
                      }}>
                        {initials(u)}
                      </div>
                    </td>

                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <strong style={{ fontSize: 14 }}>
                          {u.fullName || u.username}
                          {isSelf && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>(tú)</span>}
                        </strong>
                        {u.fullName && <span style={{ fontSize: 12, color: "var(--muted)" }}>@{u.username}</span>}
                      </div>
                    </td>

                    <td>
                      <span className={ROLE_BADGE[u.role] ?? "badge"}>{ROLE_LABELS[u.role] ?? u.role}</span>
                    </td>

                    <td>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                        {["ADMIN", "MANAGER", "AUDITOR"].includes(u.role)
                          ? "Todos (por rol)"
                          : warehouseCount === 0 ? "Sin asignar" : `${warehouseCount} depósito${warehouseCount !== 1 ? "s" : ""}`}
                      </span>
                    </td>

                    <td>
                      <span className={u.active ? "badge badge--entry" : "badge"}>{u.active ? "Activo" : "Inactivo"}</span>
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <button className="btn" onClick={() => setManagingId(u.id)} style={{ fontSize: 12 }}>
                        Gestionar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}

      {/* ── Summary ── */}
      {!isLoading && !isError && users.length > 0 && (
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          {filtered.length} de {users.length} usuario{users.length !== 1 ? "s" : ""}
          {" · "}{users.filter((u) => u.active).length} activo{users.filter((u) => u.active).length !== 1 ? "s" : ""}
        </p>
      )}

      {createOpen && (
        <NewUserModal
          actorRole={me?.role ?? "OPERATOR"}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); setManagingId(id); }}
        />
      )}

      {managingId && me && (
        <UserFichaDrawer
          userId={managingId}
          onClose={() => setManagingId(null)}
          actor={{ userId: me.userId, role: me.role }}
          actorNames={actorNames}
        />
      )}
    </div>
  );
}
