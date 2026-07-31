import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, deleteUser, listUsers, updateUser, type AppUser } from "../api/users";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

const ROLES = ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"] as const;
type UserRole = (typeof ROLES)[number];

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

/* ── Iniciales para avatar ─────────────────────────────────────────────────── */
function initials(user: AppUser) {
  const src = user.fullName?.trim() || user.username;
  return src.slice(0, 2).toUpperCase();
}

/* ── Formulario vacío ──────────────────────────────────────────────────────── */
function emptyForm() {
  return { fullName: "", username: "", password: "", confirm: "", role: "OPERATOR" as UserRole, active: true };
}

type FormState = ReturnType<typeof emptyForm>;

/* ══════════════════════════════════════════════════════════════════════════════
   MODAL DE USUARIO
   ══════════════════════════════════════════════════════════════════════════════ */
interface ModalProps {
  editing: AppUser | null;
  onClose: () => void;
  onSaved: () => void;
}

function UserModal({ editing, onClose, onSaved }: ModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !editing;

  const [form, setForm] = useState<FormState>(() =>
    editing
      ? { fullName: editing.fullName ?? "", username: editing.username, password: "", confirm: "", role: editing.role as UserRole, active: editing.active ?? true }
      : emptyForm()
  );
  const [submitted, setSubmitted] = useState(false);

  const idFull = useId(); const idUser = useId(); const idPass = useId();
  const idConf = useId(); const idRole = useId();

  /* ── Validaciones ─────────────────────────────────────────────────────── */
  const errUsername  = !form.username.trim() ? "El usuario es obligatorio." : form.username.trim().length < 3 ? "Mínimo 3 caracteres." : "";
  const errPassword  = isNew && !form.password ? "La contraseña es obligatoria para un nuevo usuario." : form.password && form.password.length < 6 ? "Mínimo 6 caracteres." : "";
  const errConfirm   = form.password && form.password !== form.confirm ? "Las contraseñas no coinciden." : "";
  const hasErrors    = !!errUsername || !!errPassword || !!errConfirm;

  /* ── Mutations ────────────────────────────────────────────────────────── */
  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario creado correctamente.");
      onSaved();
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateUser>[1] }) =>
      updateUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario actualizado.");
      onSaved();
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const saving = createMut.isPending || updateMut.isPending;

  function set(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;

    if (isNew) {
      createMut.mutate({ username: form.username.trim(), password: form.password, role: form.role, fullName: form.fullName.trim() || undefined });
    } else {
      const payload: Parameters<typeof updateUser>[1] = {
        username: form.username.trim(),
        role: form.role,
        fullName: form.fullName.trim() || undefined,
        active: form.active,
      };
      if (form.password) payload.password = form.password;
      updateMut.mutate({ id: editing!.id, payload });
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 id="modal-title" style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
            {isNew ? "Nuevo usuario" : `Editar — ${editing!.username}`}
          </h2>
          <button className="btn" onClick={onClose} aria-label="Cerrar" style={{ padding: "4px 10px" }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Nombre completo */}
          <div style={{ marginBottom: 14 }}>
            <label htmlFor={idFull} style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px" }}>
              Nombre completo <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span>
            </label>
            <input id={idFull} className="input" style={{ width: "100%" }}
              value={form.fullName} onChange={(e) => set("fullName", e.target.value)}
              placeholder="Ej: Juan Pérez" disabled={saving} />
          </div>

          {/* Username */}
          <div style={{ marginBottom: 14 }}>
            <label htmlFor={idUser} style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px" }}>
              Usuario *
            </label>
            <input id={idUser} className="input" style={{ width: "100%" }}
              value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s/g, ""))}
              placeholder="Ej: jperez" disabled={saving}
              aria-invalid={submitted && !!errUsername}
              aria-describedby={submitted && errUsername ? `${idUser}-err` : undefined}
            />
            {submitted && errUsername && <p id={`${idUser}-err`} className="form-error" role="alert">{errUsername}</p>}
          </div>

          {/* Rol */}
          <div style={{ marginBottom: 14 }}>
            <label htmlFor={idRole} style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px" }}>
              Rol *
            </label>
            <select id={idRole} className="input" style={{ width: "100%" }}
              value={form.role} onChange={(e) => set("role", e.target.value as UserRole)} disabled={saving}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]} ({r})</option>
              ))}
            </select>
          </div>

          {/* Estado — solo para edición */}
          {!isNew && (
            <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>
                Estado
              </label>
              <button
                type="button"
                className={`btn ${form.active ? "btn--primary" : "btn--danger"}`}
                style={{ fontSize: 12, padding: "4px 14px" }}
                onClick={() => set("active", !form.active)}
                disabled={saving}
              >
                {form.active ? "Activo" : "Inactivo"}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {form.active ? "El usuario puede iniciar sesión." : "El usuario no puede iniciar sesión."}
              </span>
            </div>
          )}

          {/* Contraseña */}
          <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
              {isNew ? "Contraseña *" : "Cambiar contraseña"}
              {!isNew && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>(dejar en blanco para no cambiar)</span>}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <input id={idPass} className="input" type="password" style={{ width: "100%" }}
                  value={form.password} onChange={(e) => set("password", e.target.value)}
                  placeholder={isNew ? "Contraseña" : "Nueva contraseña"} disabled={saving}
                  aria-invalid={submitted && !!errPassword}
                  aria-describedby={submitted && errPassword ? `${idPass}-err` : undefined}
                  autoComplete="new-password"
                />
                {submitted && errPassword && <p id={`${idPass}-err`} className="form-error" role="alert">{errPassword}</p>}
              </div>
              <div>
                <input id={idConf} className="input" type="password" style={{ width: "100%" }}
                  value={form.confirm} onChange={(e) => set("confirm", e.target.value)}
                  placeholder="Confirmar contraseña" disabled={saving}
                  aria-invalid={submitted && !!errConfirm}
                  aria-describedby={submitted && errConfirm ? `${idConf}-err` : undefined}
                  autoComplete="new-password"
                />
                {submitted && errConfirm && <p id={`${idConf}-err`} className="form-error" role="alert">{errConfirm}</p>}
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Guardando…" : isNew ? "Crear usuario" : "Guardar cambios"}
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);

  const { data: users = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
  });

  const deleteMut = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario desactivado. Ya no puede iniciar sesión.");
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function openCreate() { setEditing(null); setModalOpen(true); }
  function openEdit(u: AppUser) { setEditing(u); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  function handleDelete(u: AppUser) {
    if (u.id === me?.userId) {
      toast.error("No podés desactivar tu propio usuario.");
      return;
    }
    // Es una baja lógica: el usuario se conserva para no perder la autoría de los
    // movimientos que registró.
    const mensaje =
      `¿Desactivar al usuario "${u.username}"?\n\n` +
      `El usuario quedará inactivo y no podrá iniciar sesión. Podrá reactivarse posteriormente.`;
    if (!window.confirm(mensaje)) return;
    deleteMut.mutate(u.id);
  }

  const saving = deleteMut.isPending;

  return (
    <div>
      {/* ── Encabezado ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Usuarios</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Gestión de cuentas, roles y contraseñas del sistema.
          </p>
        </div>
        <button className="btn btn--primary" onClick={openCreate} style={{ flexShrink: 0 }}>
          + Nuevo usuario
        </button>
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
        users.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No hay usuarios registrados.</p>
        ) : (
          <table className="table" aria-label="Lista de usuarios">
            <thead>
              <tr>
                <th scope="col" style={{ width: 48 }} />
                <th scope="col">Nombre / Usuario</th>
                <th scope="col">Rol</th>
                <th scope="col">Estado</th>
                <th scope="col" style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === me?.userId;
                return (
                  <tr key={u.id}>
                    {/* Avatar */}
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

                    {/* Nombre + username */}
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <strong style={{ fontSize: 14 }}>
                          {u.fullName || u.username}
                          {isSelf && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>(tú)</span>}
                        </strong>
                        {u.fullName && <span style={{ fontSize: 12, color: "var(--muted)" }}>@{u.username}</span>}
                      </div>
                    </td>

                    {/* Rol */}
                    <td>
                      <span className={ROLE_BADGE[u.role] ?? "badge"}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>

                    {/* Estado */}
                    <td>
                      <span className={u.active ? "badge badge--entry" : "badge"}>
                        {u.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          className="btn"
                          onClick={() => openEdit(u)}
                          disabled={saving}
                          aria-label={`Editar usuario ${u.username}`}
                          style={{ fontSize: 12 }}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn--danger"
                          onClick={() => handleDelete(u)}
                          disabled={saving || isSelf || !u.active}
                          title={
                            isSelf
                              ? "No podés desactivar tu propio usuario"
                              : !u.active
                                ? "El usuario ya está inactivo"
                                : undefined
                          }
                          aria-label={`Desactivar usuario ${u.username}`}
                          style={{ fontSize: 12 }}
                        >
                          Desactivar
                        </button>
                      </div>
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
          {users.length} usuario{users.length !== 1 ? "s" : ""} · {users.filter((u) => u.active).length} activo{users.filter((u) => u.active).length !== 1 ? "s" : ""}
        </p>
      )}

      {/* ── Modal ── */}
      {modalOpen && (
        <UserModal editing={editing} onClose={closeModal} onSaved={closeModal} />
      )}
    </div>
  );
}
