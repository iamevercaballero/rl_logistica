import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateUser, type UserDetail } from "../../api/users";
import { useToast } from "../../design-system/toast";
import { getFriendlyApiError } from "../../utils/apiError";
import { fmtDateTimeLong } from "../../utils/dateFormat";

const ROLES: string[] = ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"];
const MANAGER_ROLES: string[] = ["OPERATOR", "AUDITOR"];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  OPERATOR: "Operador",
  AUDITOR: "Auditor",
};

type Props = {
  user: UserDetail;
  /** El actor no puede tocar ADMIN/MANAGER si es MANAGER — la ficha entera queda de solo lectura. */
  readOnly: boolean;
  /** Rol del actor logueado — acota qué roles puede asignar. */
  actorRole: string;
};

export default function GeneralTab({ user, readOnly, actorRole }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // El padre monta este componente con `key={user.id}`: un usuario distinto
  // es una instancia nueva, así que el estado inicial siempre arranca fresco
  // sin necesitar un efecto que lo resincronice.
  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState(user.role);

  const idFull = useId();
  const idUser = useId();
  const idRole = useId();

  const dirty = fullName !== (user.fullName ?? "") || username !== user.username || role !== user.role;

  const availableRoles = actorRole === "MANAGER" ? MANAGER_ROLES : ROLES;
  // Un MANAGER editando a alguien que ya administra no puede ascenderlo a ADMIN/MANAGER.
  const roleOptions = availableRoles.includes(role) ? availableRoles : [role, ...availableRoles];

  const saveMut = useMutation({
    mutationFn: () => updateUser(user.id, {
      fullName: fullName.trim() || undefined,
      username: username.trim(),
      role,
    }),
    onSuccess: () => {
      toast.success("Datos actualizados.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user", user.id] });
      queryClient.invalidateQueries({ queryKey: ["user-audit", user.id] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)",
    marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {readOnly && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", background: "var(--panel-hi)", padding: "10px 12px", borderRadius: 8 }}>
          Un Gerente no puede editar cuentas Administrador ni de otro Gerente. Esta ficha es de solo lectura.
        </p>
      )}

      <div>
        <label htmlFor={idFull} style={labelStyle}>Nombre completo</label>
        <input id={idFull} className="input" style={{ width: "100%" }}
          value={fullName} onChange={(e) => setFullName(e.target.value)}
          placeholder="Ej: Juan Pérez" disabled={readOnly || saveMut.isPending} />
      </div>

      <div>
        <label htmlFor={idUser} style={labelStyle}>Usuario</label>
        <input id={idUser} className="input" style={{ width: "100%" }}
          value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
          disabled={readOnly || saveMut.isPending} />
      </div>

      <div>
        <label htmlFor={idRole} style={labelStyle}>Rol</label>
        <select id={idRole} className="input" style={{ width: "100%" }}
          value={role} onChange={(e) => setRole(e.target.value)} disabled={readOnly || saveMut.isPending}>
          {roleOptions.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r] ?? r} ({r})</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 8, borderTop: "1px solid var(--border-dim)" }}>
        <div>
          <span style={labelStyle}>Alta</span>
          <p style={{ margin: 0, fontSize: 13 }}>{fmtDateTimeLong(user.createdAt)}</p>
        </div>
        <div>
          <span style={labelStyle}>Última modificación</span>
          <p style={{ margin: 0, fontSize: 13 }}>{fmtDateTimeLong(user.updatedAt)}</p>
        </div>
      </div>

      {!readOnly && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn--primary" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      )}
    </div>
  );
}
