import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { closeUserSessions, resetUserPassword, updateUser, type UserDetail } from "../../api/users";
import { useToast } from "../../design-system/toast";
import { getFriendlyApiError } from "../../utils/apiError";
import { fmtDateTimeLong } from "../../utils/dateFormat";

// Misma política que el backend (`password-policy.ts`): 8+ caracteres, letras y números.
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

type Props = {
  user: UserDetail;
  readOnly: boolean;
  isSelf: boolean;
};

export default function SecurityTab({ user, readOnly, isSelf }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const idPass = useId();
  const idConf = useId();

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const errPassword = newPassword && !PASSWORD_PATTERN.test(newPassword)
    ? "Mínimo 8 caracteres, con letras y números." : "";
  const errConfirm = newPassword && newPassword !== confirm ? "Las contraseñas no coinciden." : "";

  const toggleActiveMut = useMutation({
    mutationFn: (active: boolean) => updateUser(user.id, { active }),
    onSuccess: (_, active) => {
      toast.success(active ? "Usuario activado." : "Usuario desactivado. Ya no puede iniciar sesión.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user", user.id] });
      queryClient.invalidateQueries({ queryKey: ["user-audit", user.id] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const resetMut = useMutation({
    mutationFn: () => resetUserPassword(user.id, newPassword, mustChange),
    onSuccess: () => {
      toast.success("Contraseña restablecida.");
      setNewPassword(""); setConfirm(""); setSubmitted(false);
      queryClient.invalidateQueries({ queryKey: ["user-audit", user.id] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const closeSessionsMut = useMutation({
    mutationFn: () => closeUserSessions(user.id),
    onSuccess: () => {
      toast.success("Se cerraron todas las sesiones activas de este usuario.");
      queryClient.invalidateQueries({ queryKey: ["user-audit", user.id] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!newPassword || errPassword || errConfirm) return;
    resetMut.mutate();
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)",
    marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {readOnly && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", background: "var(--panel-hi)", padding: "10px 12px", borderRadius: 8 }}>
          Un Gerente no puede administrar la seguridad de cuentas Administrador ni de otro Gerente.
        </p>
      )}

      {/* ── Estado ── */}
      <div>
        <span style={labelStyle}>Estado</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
          <span className={user.active ? "badge badge--entry" : "badge"}>{user.active ? "Activo" : "Inactivo"}</span>
          {!readOnly && (
            <button
              className={`btn ${user.active ? "btn--danger" : "btn--primary"}`}
              style={{ fontSize: 12 }}
              disabled={toggleActiveMut.isPending || (isSelf && user.active)}
              title={isSelf && user.active ? "No podés desactivar tu propio usuario" : undefined}
              onClick={() => {
                const msg = user.active
                  ? `¿Desactivar al usuario "${user.username}"? No va a poder iniciar sesión hasta que se reactive.`
                  : `¿Reactivar al usuario "${user.username}"?`;
                if (window.confirm(msg)) toggleActiveMut.mutate(!user.active);
              }}
            >
              {user.active ? "Desactivar" : "Reactivar"}
            </button>
          )}
        </div>
      </div>

      {/* ── Último acceso ── */}
      <div>
        <span style={labelStyle}>Último acceso</span>
        <p style={{ margin: "4px 0 0", fontSize: 13 }}>
          {user.lastLoginAt ? fmtDateTimeLong(user.lastLoginAt) : "Nunca inició sesión."}
        </p>
        {user.mustChangePassword && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Tiene pendiente cambiar su contraseña en el próximo ingreso.
          </p>
        )}
      </div>

      {!readOnly && (
        <>
          {/* ── Restablecer contraseña ── */}
          <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 16 }}>
            <span style={labelStyle}>Restablecer contraseña</span>
            <form onSubmit={handleResetSubmit} noValidate style={{ marginTop: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <input id={idPass} className="input" type="password" style={{ width: "100%" }}
                    value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Contraseña temporal" disabled={resetMut.isPending}
                    aria-invalid={submitted && !!errPassword}
                    autoComplete="new-password" />
                  {submitted && errPassword && <p className="form-error" role="alert">{errPassword}</p>}
                </div>
                <div>
                  <input id={idConf} className="input" type="password" style={{ width: "100%" }}
                    value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Confirmar" disabled={resetMut.isPending}
                    aria-invalid={submitted && !!errConfirm}
                    autoComplete="new-password" />
                  {submitted && errConfirm && <p className="form-error" role="alert">{errConfirm}</p>}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
                <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} disabled={resetMut.isPending} />
                Debe cambiarla en el próximo ingreso
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button type="submit" className="btn btn--primary" disabled={resetMut.isPending}>
                  {resetMut.isPending ? "Restableciendo…" : "Restablecer contraseña"}
                </button>
              </div>
            </form>
          </div>

          {/* ── Cerrar sesiones ── */}
          <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 16 }}>
            <span style={labelStyle}>Sesiones activas</span>
            <p style={{ margin: "4px 0 10px", fontSize: 13, color: "var(--muted)" }}>
              Invalida cualquier sesión ya iniciada de este usuario, sin cambiarle la contraseña. Va a tener que
              volver a iniciar sesión en su próxima acción.
            </p>
            <button
              className="btn"
              disabled={closeSessionsMut.isPending}
              onClick={() => {
                if (window.confirm(`¿Cerrar todas las sesiones activas de "${user.username}"?`)) closeSessionsMut.mutate();
              }}
            >
              {closeSessionsMut.isPending ? "Cerrando…" : "Cerrar sesiones"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
