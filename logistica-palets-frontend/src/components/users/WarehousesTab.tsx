import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listWarehouses, warehouseLabel, type Warehouse } from "../../api/warehouses";
import { getUserWarehouses, setUserWarehouses, type UserDetail } from "../../api/users";
import { useToast } from "../../design-system/toast";
import { getFriendlyApiError } from "../../utils/apiError";

type Props = {
  user: UserDetail;
  readOnly: boolean;
};

/** Roles con alcance global por política — ver `WarehouseAccessService.hasGlobalScope`. */
const GLOBAL_SCOPE_ROLES = ["ADMIN", "MANAGER", "AUDITOR"];

export default function WarehousesTab({ user, readOnly }: Props) {
  const warehousesQ = useQuery({ queryKey: ["warehouses"], queryFn: listWarehouses });
  const assignedQ = useQuery({
    queryKey: ["user-warehouses", user.id],
    queryFn: () => getUserWarehouses(user.id),
  });

  const hasGlobalScope = GLOBAL_SCOPE_ROLES.includes(user.role);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {hasGlobalScope && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", background: "var(--panel-hi)", padding: "10px 12px", borderRadius: 8 }}>
          El rol {user.role === "ADMIN" ? "Administrador" : user.role === "MANAGER" ? "Gerente" : "Auditor"} ya tiene acceso a todos
          los depósitos por política. Marcar depósitos acá no lo restringe — solo importa para roles Operador.
        </p>
      )}
      {readOnly && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", background: "var(--panel-hi)", padding: "10px 12px", borderRadius: 8 }}>
          Un Gerente no puede reasignar depósitos de cuentas Administrador ni de otro Gerente.
        </p>
      )}

      {(warehousesQ.isLoading || assignedQ.isLoading) && (
        <p style={{ color: "var(--muted)" }} aria-busy="true">Cargando depósitos…</p>
      )}

      {warehousesQ.data && assignedQ.data && (
        // `key`: sin esto, guardar depósitos invalida la query pero React
        // reutiliza la misma instancia de `WarehousesForm` — su estado local
        // (`selected`), inicializado una sola vez, seguiría mostrando lo de
        // antes del refetch. Ver el mismo criterio en `PermissionsTab`.
        <WarehousesForm
          key={assignedQ.dataUpdatedAt}
          userId={user.id}
          warehouses={warehousesQ.data}
          assigned={assignedQ.data}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

/**
 * Arranca ya con los datos resueltos (`warehouses`/`assigned` no son opcionales):
 * el estado local nace del prop en el primer render, sin un efecto que lo
 * resincronice — evita el anti-patrón de `setState` dentro de un efecto.
 */
function WarehousesForm({ userId, warehouses, assigned, readOnly }: {
  userId: string;
  warehouses: Warehouse[];
  assigned: string[];
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(() => new Set(assigned));
  const [touched, setTouched] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => setUserWarehouses(userId, [...selected]),
    onSuccess: () => {
      toast.success("Depósitos actualizados.");
      setTouched(false);
      queryClient.invalidateQueries({ queryKey: ["user-warehouses", userId] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user-audit", userId] });
    },
    onError: (err) => toast.error(getFriendlyApiError(err)),
  });

  function toggle(id: string) {
    if (readOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setTouched(true);
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {warehouses.map((w) => (
          <label
            key={w.id}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              border: "1px solid var(--border)", borderRadius: 8,
              background: selected.has(w.id) ? "var(--primary-light)" : "transparent",
              cursor: readOnly ? "default" : "pointer",
              opacity: w.active ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(w.id)}
              onChange={() => toggle(w.id)}
              disabled={readOnly}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{warehouseLabel(w)}</span>
            {!w.active && <span className="badge" style={{ fontSize: 10 }}>Inactivo</span>}
          </label>
        ))}
        {warehouses.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No hay depósitos registrados.</p>
        )}
      </div>

      {!readOnly && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn--primary" disabled={!touched || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Guardando…" : "Guardar depósitos"}
          </button>
        </div>
      )}
    </>
  );
}
