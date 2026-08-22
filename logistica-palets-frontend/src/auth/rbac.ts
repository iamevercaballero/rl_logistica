export type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";
export type ModuleKey =
  | "products"
  | "lots"
  | "warehouses"
  | "locations"
  | "pallets"
  | "movements"
  | "bitacora"
  | "transports"
  | "reports"
  | "billing"
  | "users";

type ModulePermissions = {
  read: Role[];
  create: Role[];
  update: Role[];
  remove: Role[];
  /** Aprobar/rechazar (circuito de aprobación). Opcional: solo módulos con flujo de aprobación. */
  approve?: Role[];
};

export const PERMS: Record<ModuleKey, ModulePermissions> = {
  products: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    // Dar de baja catálogo maestro es de supervisión, no de piso (igual que el backend).
    remove: ["ADMIN", "MANAGER"],
  },
  lots: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  warehouses: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    // Eliminar un depósito arrastra su estructura: queda fuera del alcance del operador.
    remove: ["ADMIN", "MANAGER"],
  },
  locations: {
    // Ubicaciones es el localizador de stock: leerlo es de piso. Crear,
    // modificar, desactivar o borrar es administrar la estructura del depósito
    // —vive en Depósitos y es de supervisión— igual que en el backend.
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  pallets: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    remove: ["ADMIN", "MANAGER"],
  },
  movements: {
    // OPERATOR debe poder operar movimientos (crear entrada/salida/transferencia
    // y ver su historial). Antes estaba excluido del read y RequireRole le bloqueaba
    // la página entera pese a tener permiso de crear en el backend.
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    remove: [],
    approve: ["ADMIN", "MANAGER"],
  },
  bitacora: {
    read:   ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: [],
    update: [],
    remove: [],
  },
  transports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    remove: ["ADMIN", "MANAGER", "OPERATOR"],
  },
  reports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: [],
    update: [],
    remove: [],
  },
  billing: {
    read: ["ADMIN", "MANAGER", "AUDITOR"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN"],
  },
  users: {
    // MANAGER administra personal acotado (OPERATOR/AUDITOR) — el techo real
    // (a quién puede tocar, qué permisos puede otorgar) lo valida el backend
    // (`UsersService.assertManagerCeiling`, `PermissionsService.assertCanManagePermission`),
    // esto solo decide si ve el módulo. Mismo criterio que `role_permissions`.
    read:   ["ADMIN", "MANAGER"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
};

export function canRead(module: ModuleKey, role: Role) {
  return PERMS[module].read.includes(role);
}

export function canCreate(module: ModuleKey, role: Role) {
  return PERMS[module].create.includes(role);
}

export function canUpdate(module: ModuleKey, role: Role) {
  return PERMS[module].update.includes(role);
}

export function canDelete(module: ModuleKey, role: Role) {
  return PERMS[module].remove.includes(role);
}

export function canWrite(module: ModuleKey, role: Role) {
  return canCreate(module, role) || canUpdate(module, role) || canDelete(module, role);
}

/**
 * Quién puede aprobar/rechazar en un circuito de aprobación.
 * Regla WMS: solo MANAGER y ADMIN. OPERATOR crea y envía a aprobación; AUDITOR es solo lectura.
 */
export function canApprove(role: Role) {
  return role === "ADMIN" || role === "MANAGER";
}
