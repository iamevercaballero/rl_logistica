/**
 * Catálogo de módulos y acciones para la pestaña Permisos.
 *
 * Espejo de `role-permissions.seed.ts` del backend (única fuente real de qué
 * combinaciones existen) pero solo para armar la UI: etiquetas de negocio,
 * agrupación por categoría y orden de acciones. Si el backend agrega un
 * módulo o una acción acá hay que reflejarlo — no hay forma de derivarlo
 * automáticamente sin exponer el seed entero por API.
 */

export type PermissionAction = "read" | "create" | "update" | "remove" | "approve";

export type PermissionModuleKey =
  | "dashboard"
  | "products"
  | "warehouses"
  | "locations"
  | "lots"
  | "pallets"
  | "movements"
  | "adjustments"
  | "transports"
  | "reports"
  | "bitacora"
  | "billing"
  | "suppliers"
  | "destinations"
  | "attachments"
  | "alerts"
  | "users";

export const ACTION_LABELS: Record<PermissionAction, string> = {
  read: "Ver",
  create: "Crear",
  update: "Editar",
  remove: "Eliminar",
  approve: "Aprobar",
};

/** Orden fijo de columnas cuando un módulo tiene varias acciones. */
export const ACTION_ORDER: PermissionAction[] = ["read", "create", "update", "approve", "remove"];

export type PermissionModuleDef = {
  key: PermissionModuleKey;
  label: string;
  actions: PermissionAction[];
};

export type PermissionCategory = {
  key: string;
  label: string;
  modules: PermissionModuleDef[];
};

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: "operacion",
    label: "Operación",
    modules: [
      { key: "movements", label: "Movimientos", actions: ["read", "create", "update", "approve"] },
      { key: "adjustments", label: "Diferencias de inventario", actions: ["read", "create", "update", "approve"] },
      { key: "pallets", label: "Palets", actions: ["read", "create", "update", "remove"] },
      { key: "lots", label: "Lotes", actions: ["read", "create", "update", "remove"] },
      { key: "attachments", label: "Adjuntos", actions: ["read", "create", "remove"] },
    ],
  },
  {
    key: "administracion",
    label: "Administración",
    modules: [
      { key: "products", label: "Materiales", actions: ["read", "create", "update", "remove"] },
      { key: "warehouses", label: "Depósitos", actions: ["read", "create", "update", "remove"] },
      { key: "locations", label: "Localizador", actions: ["read", "create", "update", "remove"] },
      { key: "transports", label: "Transportes", actions: ["read", "create", "update", "remove"] },
      { key: "suppliers", label: "Proveedores", actions: ["read", "create", "update", "remove"] },
      { key: "destinations", label: "Destinos", actions: ["read", "create", "update", "remove"] },
      { key: "alerts", label: "Alertas", actions: ["read", "create", "update", "remove"] },
      { key: "users", label: "Usuarios", actions: ["read", "create", "update", "remove"] },
      { key: "billing", label: "Facturación", actions: ["read", "create", "update", "remove"] },
    ],
  },
  {
    key: "informacion",
    label: "Información",
    modules: [
      { key: "dashboard", label: "Dashboard", actions: ["read"] },
      { key: "reports", label: "Reportes", actions: ["read", "create"] },
      { key: "bitacora", label: "Registros", actions: ["read"] },
    ],
  },
];

export const ALL_PERMISSION_MODULES: PermissionModuleDef[] = PERMISSION_CATEGORIES.flatMap((c) => c.modules);
