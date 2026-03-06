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

export function getUserRole(): Role | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    return (u?.role as Role) ?? null;
  } catch {
    return null;
  }
}

// ✅ Tipado fuerte para evitar el error TS2345
export const PERMS: Record<ModuleKey, { read: Role[]; write: Role[] }> = {
  products: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER"],
  },
  lots: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER", "OPERATOR"],
  },
  warehouses: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER"],
  },
  locations: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER"],
  },
  pallets: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER", "OPERATOR"],
  },
  movements: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER", "OPERATOR"],
  },
  transports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER"],
  },
  reports: {
    read: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
    write: ["ADMIN", "MANAGER", "OPERATOR", "AUDITOR"],
  },
};

export function canRead(module: ModuleKey, role: Role) {
  return PERMS[module].read.includes(role);
}

export function canWrite(module: ModuleKey, role: Role) {
  return PERMS[module].write.includes(role);
}
