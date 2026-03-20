export type Role = "ADMIN" | "MANAGER" | "OPERATOR" | "AUDITOR";
export type ModuleKey =
  | "products"
  | "lots"
  | "warehouses"
  | "locations"
  | "pallets"
  | "movements"
  | "transports"
  | "reports";

type ModulePermissions = {
  read: Role[];
  create: Role[];
  update: Role[];
  remove: Role[];
};

export const PERMS: Record<ModuleKey, ModulePermissions> = {
  products: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
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
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  locations: {
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
    read: ["ADMIN", "MANAGER", "AUDITOR"],
    create: ["ADMIN", "MANAGER", "OPERATOR"],
    update: ["ADMIN", "MANAGER"],
    remove: [],
  },
  transports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: ["ADMIN", "MANAGER"],
    update: ["ADMIN", "MANAGER"],
    remove: ["ADMIN", "MANAGER"],
  },
  reports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    create: [],
    update: [],
    remove: [],
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
