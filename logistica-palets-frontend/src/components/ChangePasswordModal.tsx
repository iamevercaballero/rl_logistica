import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { changeOwnPassword } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

/**
 * Cambio de contraseña propia.
 *
 * Se abre de dos maneras: a pedido, desde el menú lateral, o de forma obligatoria
 * cuando el usuario tiene `mustChangePassword` — el caso del admin inicial, cuya
 * contraseña vive en `.env.prod`, y el de cualquier usuario al que un supervisor
 * le reseteó la clave. En el modo obligatorio no se puede cerrar: la única salida
 * es cambiarla o cerrar sesión.
 *
 * Al terminar cierra la sesión a propósito. El backend adelanta `passwordChangedAt`
 * y `jwt.strategy` rechaza todo token emitido antes de esa marca, así que el token
 * en mano queda inservible en el mismo instante. Sin este cierre explícito, el
 * siguiente request devolvería 401 y el interceptor de axios sacaría al usuario de
 * la app sin decirle que fue por su propio cambio de contraseña.
 */

/** Misma regla que `password-policy.ts` en el backend. Se valida acá para no
 *  hacer ida y vuelta por un error que se puede ver al tipear. */
const REGLA = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const REGLA_TEXTO = "Al menos 8 caracteres, con letras y números.";

export default function ChangePasswordModal({
  obligatorio = false,
  onClose,
}: {
  obligatorio?: boolean;
  onClose?: () => void;
}) {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");

  const noCoincide = repetida.length > 0 && nueva !== repetida;
  const nuevaInvalida = nueva.length > 0 && !REGLA.test(nueva);
  const esLaMisma = nueva.length > 0 && nueva === actual;

  const puedeEnviar =
    actual.length > 0 && REGLA.test(nueva) && nueva === repetida && !esLaMisma;

  const mut = useMutation({
    mutationFn: () => changeOwnPassword(actual, nueva),
    onSuccess: () => {
      toast.success("Contraseña actualizada. Iniciá sesión de nuevo.");
      logout();
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar || mut.isPending) return;
    mut.mutate();
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        // En modo obligatorio el clic afuera no cierra: no hay a dónde ir.
        if (!obligatorio && onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width: "100%", maxWidth: 420 }} role="dialog" aria-modal="true" aria-labelledby="cambiar-clave-titulo">
        <h2 id="cambiar-clave-titulo" style={{ marginTop: 0 }}>
          {obligatorio ? "Tenés que cambiar tu contraseña" : "Cambiar contraseña"}
        </h2>

        {obligatorio && (
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>
            Estás usando una contraseña asignada por otra persona. Elegí una propia
            para seguir.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Contraseña actual</span>
            <input
              type="password"
              autoComplete="current-password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              disabled={mut.isPending}
              autoFocus
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Contraseña nueva</span>
            <input
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              disabled={mut.isPending}
              aria-describedby="regla-clave"
              aria-invalid={nuevaInvalida || esLaMisma}
            />
            <span
              id="regla-clave"
              style={{ fontSize: 12, color: nuevaInvalida || esLaMisma ? "var(--danger)" : "var(--muted)" }}
            >
              {esLaMisma ? "La nueva contraseña tiene que ser distinta de la actual." : REGLA_TEXTO}
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Repetir contraseña nueva</span>
            <input
              type="password"
              autoComplete="new-password"
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
              disabled={mut.isPending}
              aria-invalid={noCoincide}
            />
            {noCoincide && (
              <span style={{ fontSize: 12, color: "var(--danger)" }}>Las contraseñas no coinciden.</span>
            )}
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            {obligatorio ? (
              <button type="button" className="btn" onClick={logout} disabled={mut.isPending}>
                Cerrar sesión
              </button>
            ) : (
              <button type="button" className="btn" onClick={onClose} disabled={mut.isPending}>
                Cancelar
              </button>
            )}
            <button type="submit" className="btn btn--primary" disabled={!puedeEnviar || mut.isPending}>
              {mut.isPending ? "Guardando..." : "Cambiar contraseña"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
