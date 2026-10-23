export type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";
export type ModuleKey =
  | "dashboard"
  | "products"
  | "lots"
  | "warehouses"
  | "locations"
  | "pallets"
  | "movements"
  | "adjustments"
  | "bitacora"
  | "transports"
  | "suppliers"
  | "destinations"
  | "attachments"
  | "alerts"
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
  dashboard: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: [],
    update: [],
    remove: [],
  },
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
  adjustments: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    remove: [],
    // Segregación de funciones: el operador carga la diferencia, no la aprueba.
    approve: ["ADMIN", "MANAGER"],
  },
  bitacora: {
    read:   ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: [],
    update: [],
    remove: [],
  },
  suppliers: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    // El operador da de alta un proveedor sobre la marcha al cargar una entrada;
    // editarlo o darlo de baja es de supervisión.
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  destinations: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  attachments: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    // Subir es de piso, borrar no.
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: [],
    remove: ["ADMIN", "MANAGER"],
  },
  alerts: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  transports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER", "OPERATOR"],
    remove: ["ADMIN", "MANAGER", "OPERATOR"],
  },
  reports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    // La carga del corte de stock de SAP — la única escritura del módulo.
    create: ["ADMIN", "MANAGER"],
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

/*
 * Estos helpers miran SOLO el rol: no conocen los permisos puntuales que un
 * admin otorga desde la pestaña Permisos. Las pantallas tienen que usar
 * `can(user, module, action)` de `permissions.ts`, que parte de los permisos
 * efectivos de `/auth/me` y cae acá únicamente cuando todavía no llegaron.
 *
 * Quedó claro con un caso real: a un operador se le tildó "Lotes → Editar", el
 * backend ya lo aceptaba, y el botón de editar seguía sin aparecer porque la
 * pantalla preguntaba `canUpdate("lots", role)` — que ignora el permiso.
 */
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
