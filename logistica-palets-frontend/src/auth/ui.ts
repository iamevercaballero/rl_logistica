import { canWrite, getUserRole } from "./rbac";
import type { ModuleKey } from "./rbac";

export function useCanWrite(module: ModuleKey) {
  const role = getUserRole();
  return {
    role,
    canWrite: role ? canWrite(module, role) : false,
  };
}
