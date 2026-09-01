import { PermissionAction } from './entities/role-permission.entity';
import type { UserRole } from '../users/entities/user.entity';

/**
 * La plantilla de cada rol — transcripción fiel de la matriz que hoy vive en
 * `frontend/src/auth/rbac.ts` + los `@Roles()` reales de cada controller
 * (verificada módulo por módulo, no contra la spec).
 *
 * Fuente única: la migración `CreateRolePermissions` y los tests de
 * integración importan este mismo array, para que no puedan divergir entre
 * "lo que se siembra en producción" y "lo que se prueba".
 */
export type RolePermissionSeedRow = { module: string; action: PermissionAction; roles: readonly UserRole[] };

const ALL: readonly UserRole[] = ['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'];
const ADMIN_MANAGER: readonly UserRole[] = ['ADMIN', 'MANAGER'];
const ADMIN_MANAGER_OPERATOR: readonly UserRole[] = ['ADMIN', 'MANAGER', 'OPERATOR'];
const ADMIN_MANAGER_AUDITOR: readonly UserRole[] = ['ADMIN', 'MANAGER', 'AUDITOR'];

export const ROLE_PERMISSIONS_SEED: readonly RolePermissionSeedRow[] = [
  { module: 'dashboard', action: 'read', roles: ALL },

  { module: 'products', action: 'read', roles: ALL },
  { module: 'products', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'products', action: 'update', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'products', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'warehouses', action: 'read', roles: ALL },
  { module: 'warehouses', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'warehouses', action: 'update', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'warehouses', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'locations', action: 'read', roles: ALL },
  { module: 'locations', action: 'create', roles: ADMIN_MANAGER },
  { module: 'locations', action: 'update', roles: ADMIN_MANAGER },
  { module: 'locations', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'lots', action: 'read', roles: ALL },
  { module: 'lots', action: 'create', roles: ADMIN_MANAGER },
  { module: 'lots', action: 'update', roles: ADMIN_MANAGER },
  { module: 'lots', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'pallets', action: 'read', roles: ALL },
  { module: 'pallets', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'pallets', action: 'update', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'pallets', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'movements', action: 'read', roles: ALL },
  { module: 'movements', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'movements', action: 'update', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'movements', action: 'approve', roles: ADMIN_MANAGER },

  { module: 'adjustments', action: 'read', roles: ALL },
  { module: 'adjustments', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'adjustments', action: 'update', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'adjustments', action: 'approve', roles: ADMIN_MANAGER },

  { module: 'transports', action: 'read', roles: ALL },
  { module: 'transports', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'transports', action: 'update', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'transports', action: 'remove', roles: ADMIN_MANAGER_OPERATOR },

  // Proveedores y destinos son el mismo tipo de catálogo maestro: el operador
  // los da de alta sobre la marcha al cargar un movimiento, pero editarlos o
  // darlos de baja es de supervisión. `remove` es la baja lógica
  // (`:id/deactivate`) — estos catálogos no tienen DELETE.
  { module: 'suppliers', action: 'read', roles: ALL },
  { module: 'suppliers', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'suppliers', action: 'update', roles: ADMIN_MANAGER },
  { module: 'suppliers', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'destinations', action: 'read', roles: ALL },
  { module: 'destinations', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'destinations', action: 'update', roles: ADMIN_MANAGER },
  { module: 'destinations', action: 'remove', roles: ADMIN_MANAGER },

  // Adjuntos: subir es de piso, borrar no. `read` cubre listar y descargar.
  { module: 'attachments', action: 'read', roles: ALL },
  { module: 'attachments', action: 'create', roles: ADMIN_MANAGER_OPERATOR },
  { module: 'attachments', action: 'remove', roles: ADMIN_MANAGER },

  // Alertas: `read` es ALL porque el panel de alertas activas lo ve todo el
  // mundo; la lista de reglas es más angosta, pero eso lo sigue resolviendo el
  // `@Roles()` del endpoint — los dos guards se aplican.
  { module: 'alerts', action: 'read', roles: ALL },
  { module: 'alerts', action: 'create', roles: ADMIN_MANAGER },
  { module: 'alerts', action: 'update', roles: ADMIN_MANAGER },
  { module: 'alerts', action: 'remove', roles: ADMIN_MANAGER },

  { module: 'reports', action: 'read', roles: ALL },
  // `create` es la carga del corte de stock de SAP, que alimenta el reporte de
  // diferencias. Es la única escritura del módulo.
  { module: 'reports', action: 'create', roles: ADMIN_MANAGER },
  { module: 'bitacora', action: 'read', roles: ALL },

  { module: 'billing', action: 'read', roles: ADMIN_MANAGER_AUDITOR },
  { module: 'billing', action: 'create', roles: ADMIN_MANAGER },
  { module: 'billing', action: 'update', roles: ADMIN_MANAGER },
  { module: 'billing', action: 'remove', roles: ['ADMIN'] },

  // Antes de esta feature, "users" era ADMIN-only. Habilitar MANAGER acá es el
  // cambio intencional de esta feature (administración acotada de personal
  // operativo) — el techo real (qué usuario/rol puede tocar) lo valida
  // `UsersService`/`PermissionsService`, no esta tabla.
  { module: 'users', action: 'read', roles: ADMIN_MANAGER },
  { module: 'users', action: 'create', roles: ADMIN_MANAGER },
  { module: 'users', action: 'update', roles: ADMIN_MANAGER },
  { module: 'users', action: 'remove', roles: ADMIN_MANAGER },
];
