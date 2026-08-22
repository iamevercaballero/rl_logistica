import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUserPermissions,
  setUserPermissions,
  restoreUserPermissions,
  type EffectivePermissions,
  type PermissionOverrideInput,
  type UserDetail,
  type UserPermissionsResponse,
} from "../../api/users";
import { useToast } from "../../design-system/toast";
import { getFriendlyApiError } from "../../utils/apiError";
import { ACTION_LABELS, PERMISSION_CATEGORIES, type PermissionAction } from "./permissionsCatalog";

type Props = {
  user: UserDetail;
  readOnly: boolean;
};

/** `true`/`false` por "module:action" — el estado que se ve tildado en pantalla. */
type CheckedMap = Record<string, boolean>;

function key(module: string, action: string) {
  return `${module}:${action}`;
}

function toCheckedMap(effective: EffectivePermissions): CheckedMap {
  const map: CheckedMap = {};
  for (const [module, actions] of Object.entries(effective)) {
    for (const action of actions) map[key(module, action)] = true;
  }
  return map;
}

export default function PermissionsTab({ user, readOnly }: Props) {
  const permsQ = useQuery({
    queryKey: ["user-permissions", user.id],
    queryFn: () => getUserPermissions(user.id),
  });

  if (permsQ.isLoading) return <p style={{ color: "var(--muted)" }} aria-busy="true">Cargando permisos…</p>;
  if (!permsQ.data) return <p className="form-error">No se pudieron cargar los permisos.</p>;

  // `key={dataUpdatedAt}`: sin esto, guardar u otorgar/restaurar permisos
  // invalida la query y trae datos nuevos, pero React reutiliza la MISMA
  // instancia de `PermissionsForm` — su estado local (`checked`), inicializado
  // una sola vez, quedaría mostrando los tildes de ANTES del refetch. Cada
  // fetch exitoso es, a todo efecto, un usuario "nuevo" para este formulario.
  return (
    <PermissionsForm
      key={permsQ.dataUpdatedAt}
      userId={user.id}
      role={user.role}
      data={permsQ.data}
      readOnly={readOnly}
    />
  );
}

/**
 * Arranca con `data` ya resuelto: el estado local (`checked`) nace del prop en
 * el primer render, sin un efecto que lo resincronice.
 */
function PermissionsForm({ userId, role, data, readOnly }: {
  userId: string;
  role: string;
  data: UserPermissionsResponse;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [checked, setChecked] = useState<CheckedMap>(() => toCheckedMap(data.effective));
  const [touched, setTouched] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => {
      const overrides: PermissionOverrideInput[] = [];
      for (const category of PERMISSION_CATEGORIES) {
        for (const mod of category.modules) {
          const roleHas = new Set(data.roleDefaults[mod.key] ?? []);
          for (const action of mod.actions) {
            const isChecked = !!checked[key(mod.key, action)];
            const roleDefault = roleHas.has(action);
            if (isChecked !== roleDefault) {
              overrides.push({ module: mod.key, action, effect: isChecked ? "ALLOW" : "DENY" });
            }
          }
        }
      }
      return setUserPermissions(userId, overrides);
    },
    onSuccess: () => {
      toast.success("Permisos actualizados.");
      setTouched(false);
      queryClient.invalidateQueries({ queryKey: ["user-permissions", userId] });
      queryClient.invalidateQueries({ queryKey: ["user-audit", userId] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  const restoreMut = useMutation({
    mutationFn: () => restoreUserPermissions(userId),
    onSuccess: () => {
      toast.success("Se restauraron los permisos del rol.");
      queryClient.invalidateQueries({ queryKey: ["user-permissions", userId] });
      queryClient.invalidateQueries({ queryKey: ["user-audit", userId] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function toggle(module: string, action: PermissionAction) {
    if (readOnly) return;
    setChecked((prev) => ({ ...prev, [key(module, action)]: !prev[key(module, action)] }));
    setTouched(true);
  }

  const hasOverrides = data.overrides.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Los permisos tildados por defecto vienen del rol <strong>{role}</strong>. Un cambio puntual acá queda
          marcado como excepción — no afecta a los demás usuarios con ese rol.
        </p>
        {!readOnly && (
          <button
            className="btn"
            disabled={!hasOverrides || restoreMut.isPending}
            onClick={() => {
              if (window.confirm(`¿Restaurar los permisos por defecto del rol ${role}? Se van a borrar las excepciones puntuales de este usuario.`)) {
                restoreMut.mutate();
              }
            }}
            title={!hasOverrides ? "Este usuario ya usa los permisos por defecto de su rol" : undefined}
          >
            Restaurar permisos del rol
          </button>
        )}
      </div>

      {readOnly && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", background: "var(--panel-hi)", padding: "10px 12px", borderRadius: 8 }}>
          Un Gerente no puede modificar permisos de cuentas Administrador ni de otro Gerente.
        </p>
      )}

      {PERMISSION_CATEGORIES.map((category) => (
        <div key={category.key}>
          <h4 style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", margin: "0 0 10px" }}>
            {category.label}
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {category.modules.map((mod) => {
              const roleHas = new Set(data.roleDefaults[mod.key] ?? []);
              return (
                <div key={mod.key} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 18px", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 150 }}>
                    {mod.label}
                    {mod.enforcementPending && (
                      <span
                        title="El sistema todavía no aplica estos permisos en Facturación: se guardan, pero por ahora el acceso lo sigue decidiendo el rol."
                        style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", cursor: "help" }}
                      >
                        sin efecto todavía
                      </span>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {mod.actions.map((action) => {
                      const isChecked = !!checked[key(mod.key, action)];
                      const isOverride = isChecked !== roleHas.has(action);
                      return (
                        <label key={action} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: readOnly ? "default" : "pointer" }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(mod.key, action)}
                            disabled={readOnly}
                          />
                          <span style={{ color: isOverride ? "var(--primary-text)" : undefined, fontWeight: isOverride ? 700 : 400 }}>
                            {ACTION_LABELS[action]}
                          </span>
                          {isOverride && <span title="Distinto del permiso por defecto del rol" style={{ color: "var(--primary)" }}>●</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!readOnly && (
        <div style={{ display: "flex", justifyContent: "flex-end", position: "sticky", bottom: 0, background: "var(--bg-base)", paddingTop: 8 }}>
          <button className="btn btn--primary" disabled={!touched || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Guardando…" : "Guardar permisos"}
          </button>
        </div>
      )}
    </div>
  );
}
