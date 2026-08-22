import { useQuery } from "@tanstack/react-query";
import { getUserAuditLog, type UserAuditAction, type UserAuditEntry } from "../../api/users";
import { listWarehouses, warehouseLabel } from "../../api/warehouses";
import { fmtDateTimeLong } from "../../utils/dateFormat";
import { ACTION_LABELS, ALL_PERMISSION_MODULES, type PermissionAction } from "./permissionsCatalog";

type Props = {
  userId: string;
  /** userId → nombre para mostrar — resuelto del lado de la página con la lista ya cargada. */
  actorNames: Map<string, string>;
};

const ACTION_TITLES: Record<UserAuditAction, string> = {
  USER_CREATED: "Usuario creado",
  USER_UPDATED: "Datos actualizados",
  ROLE_CHANGED: "Cambio de rol",
  USER_ACTIVATED: "Usuario activado",
  USER_DEACTIVATED: "Usuario desactivado",
  PASSWORD_RESET: "Contraseña restablecida",
  SESSIONS_CLOSED: "Sesiones cerradas",
  WAREHOUSE_ASSIGNED: "Depósito asignado",
  WAREHOUSE_REMOVED: "Depósito quitado",
  PERMISSION_GRANTED: "Permiso otorgado",
  PERMISSION_REVOKED: "Permiso revocado",
  PERMISSIONS_RESTORED: "Permisos restaurados al del rol",
};

const moduleLabel = (mod: string) => ALL_PERMISSION_MODULES.find((m) => m.key === mod)?.label ?? mod;

export default function HistoryTab({ userId, actorNames }: Props) {
  const logQ = useQuery({ queryKey: ["user-audit", userId], queryFn: () => getUserAuditLog(userId) });
  const warehousesQ = useQuery({ queryKey: ["warehouses"], queryFn: listWarehouses });

  function warehouseName(id: string | null) {
    if (!id) return "—";
    const w = warehousesQ.data?.find((x) => x.id === id);
    return w ? warehouseLabel(w) : id;
  }

  function detail(entry: UserAuditEntry): string | null {
    switch (entry.action) {
      case "ROLE_CHANGED":
        return `${entry.oldValue ?? "—"} → ${entry.newValue ?? "—"}`;
      case "USER_UPDATED":
        return entry.field === "fullName" ? `Nombre: "${entry.oldValue ?? "—"}" → "${entry.newValue ?? "—"}"` : null;
      case "WAREHOUSE_ASSIGNED":
        return warehouseName(entry.newValue);
      case "WAREHOUSE_REMOVED":
        return warehouseName(entry.oldValue);
      case "PERMISSION_GRANTED":
      case "PERMISSION_REVOKED": {
        if (!entry.field) return null;
        const [mod, action] = entry.field.split(":");
        const actionLabel = ACTION_LABELS[action as PermissionAction] ?? action;
        return `${moduleLabel(mod)} · ${actionLabel}`;
      }
      default:
        return null;
    }
  }

  if (logQ.isLoading) return <p style={{ color: "var(--muted)" }} aria-busy="true">Cargando historial…</p>;

  const entries = logQ.data ?? [];
  if (entries.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13 }}>Todavía no hay eventos registrados para este usuario.</p>;
  }

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
      {entries.map((entry, i) => (
        <li
          key={entry.id}
          style={{
            display: "flex", gap: 12, padding: "10px 0",
            borderBottom: i < entries.length - 1 ? "1px solid var(--border-dim)" : undefined,
          }}
        >
          <div style={{ width: 8, paddingTop: 5, flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>{ACTION_TITLES[entry.action] ?? entry.action}</strong>
              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDateTimeLong(entry.createdAt)}</span>
            </div>
            {detail(entry) && <p style={{ margin: "2px 0 0", fontSize: 12.5 }}>{detail(entry)}</p>}
            <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--muted)" }}>
              Por {actorNames.get(entry.actorUserId) ?? "un usuario que ya no está en el sistema"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
