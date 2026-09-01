import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { Product } from '../src/modules/products/entities/product.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Stock } from '../src/modules/stocks/entities/stock.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { MovementDetail } from '../src/modules/movements/entities/movement-detail.entity';
import { LogisticsDocument } from '../src/modules/movements/entities/logistics-document.entity';
import { DocumentSequence } from '../src/modules/movements/entities/document-sequence.entity';
import { RegularizationLog } from '../src/modules/movements/entities/regularization-log.entity';
import { AdjustmentRequest } from '../src/modules/adjustments/entities/adjustment-request.entity';
import { AdjustmentRequestLine } from '../src/modules/adjustments/entities/adjustment-request-line.entity';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { SapStockSnapshot } from '../src/modules/reports/entities/sap-stock.entity';
import { Pila } from '../src/modules/pilas/entities/pila.entity';
import { Supplier } from '../src/modules/suppliers/entities/supplier.entity';
import { Destination } from '../src/modules/destinations/entities/destination.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { UserAuditLog } from '../src/modules/users/entities/user-audit-log.entity';
import { UserWarehouse } from '../src/modules/warehouses/entities/user-warehouse.entity';
import { WarehouseAccessService } from '../src/modules/warehouses/warehouse-access.service';
import { RolePermission } from '../src/modules/permissions/entities/role-permission.entity';
import { UserPermission } from '../src/modules/permissions/entities/user-permission.entity';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { ROLE_PERMISSIONS_SEED } from '../src/modules/permissions/role-permissions.seed';
import { IdempotencyKey } from '../src/common/idempotency/idempotency-key.entity';
import { AuthEvent } from '../src/modules/auth/entities/auth-event.entity';
import { RefreshSession } from '../src/modules/auth/entities/refresh-session.entity';
import { applyAppendOnlyTriggers } from '../src/common/append-only';
import {
  addConstraintIfMissing,
  INVENTORY_CHECKS,
  INVENTORY_FKS,
  inventoryFkName,
} from '../src/common/inventory-constraints';

export const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';

/**
 * Conjunto mínimo de entidades que toca el motor de stock. No incluye User /
 * Transport / billing porque no hay relaciones (los IDs son columnas uuid planas),
 * así que synchronize crea sólo estas tablas y sus FKs (Lot→Product, Location→Warehouse).
 */
export const TEST_ENTITIES = [
  Product, Warehouse, Location, Stock, Lot, Pallet, Pila, Supplier, Destination, User, UserWarehouse,
  Movement, MovementDetail, LogisticsDocument, DocumentSequence, RegularizationLog,
  AdjustmentRequest, AdjustmentRequestLine, Attachment, DocumentEvent, SapStockSnapshot,
  UserAuditLog, RolePermission, UserPermission, IdempotencyKey, AuthEvent, RefreshSession,
];

/** Tablas a vaciar entre tests (orden irrelevante por CASCADE). */
const TABLES = [
  'movement_details', 'movements', 'stocks', 'pallets', 'pilas', 'lots',
  'logistics_documents', 'regularization_logs',
  'adjustment_request_lines', 'adjustment_requests',
  'attachments', 'document_events', 'document_sequences',
  'sap_stock_snapshots', 'user_warehouses', 'products', 'locations', 'warehouses', 'suppliers', 'destinations',
  'user_audit_log', 'auth_events', 'refresh_sessions', 'role_permissions', 'user_permissions', 'users',
  'idempotency_keys',
];

/**
 * DataSource de integración. Apunta al PostgreSQL de docker-compose.test.yml
 * (host 5434 por defecto) y construye el schema con synchronize:true — el glob
 * de entidades no funciona bajo ts-jest, por eso la lista explícita de arriba.
 */
export function createTestDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.TEST_DB_HOST || 'localhost',
    port: Number(process.env.TEST_DB_PORT) || 5434,
    username: process.env.TEST_DB_USERNAME || 'rl_test',
    password: process.env.TEST_DB_PASSWORD || 'test_password_change_me',
    database: process.env.TEST_DB_DATABASE || 'logistica_palets_test',
    entities: TEST_ENTITIES,
    synchronize: true,
    logging: false,
    // Misma zona que la aplicación y que el data-source del CLI. Sin esto, la
    // suite corría contra una base en UTC mientras el proceso de Node está en
    // UTC-3: TypeORM parsea `timestamp without time zone` con la zona del
    // proceso, así que todo valor puesto por un default de la base
    // —`passwordChangedAt`, `createdAt`— volvía tres horas adelantado.
    //
    // No es cosmético: con eso, un token recién emitido parecía anterior al
    // último cambio de contraseña y `wasIssuedBeforePasswordChange` lo daba por
    // vencido. Ningún test lo había ejercitado contra la base hasta ahora, así
    // que el desfase pasó inadvertido — y era la peor clase de test verde: uno
    // que corre contra un entorno que no es el de producción.
    extra: { options: '-c timezone=Etc/GMT+3' },
  });
}

/**
 * Aplica las claves foráneas y los CHECK de la migración RL-C-03 sobre el
 * esquema que armó `synchronize`.
 *
 * Sin esto la suite correría contra un esquema MÁS PERMISIVO que producción:
 * `synchronize` sólo crea claves foráneas para relaciones `@ManyToOne`, y en
 * este modelo casi todas son columnas `uuid` planas. Un test que dejara un
 * movimiento apuntando a un producto inexistente pasaría en verde y fallaría
 * recién en el despliegue. Se reutiliza la misma definición que la migración,
 * así que las dos no pueden divergir.
 */
async function applyInventoryConstraints(ds: DataSource): Promise<void> {
  // El esquema de test es un SUBCONJUNTO del de producción: `TEST_ENTITIES` deja
  // afuera lo que el motor de stock no toca (alertas, transportes, facturación).
  // Se aplican sólo las restricciones cuyas dos tablas existen acá, en vez de
  // recortar la lista a mano — así agregar una entidad al set de test alcanza
  // para que sus restricciones entren solas.
  const filas = (await ds.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  )) as Array<{ table_name: string }>;
  const existe = new Set(filas.map((f) => f.table_name));

  for (const [tabla, columna, destino, accion] of INVENTORY_FKS) {
    if (!existe.has(tabla) || !existe.has(destino)) continue;
    await ds.query(
      addConstraintIfMissing(
        tabla,
        inventoryFkName(tabla, columna),
        `FOREIGN KEY ("${columna}") REFERENCES "${destino}"("id") ON DELETE ${accion} ON UPDATE NO ACTION`,
      ),
    );
  }
  for (const [tabla, nombre, expresion] of INVENTORY_CHECKS) {
    if (!existe.has(tabla)) continue;
    await ds.query(addConstraintIfMissing(tabla, nombre, `CHECK (${expresion})`));
  }
}

/** ¿Ya se aplicaron? Una sola consulta al catálogo, para no repetir 45 DDL por test. */
let constraintsAplicadas = false;

/** Vacía las tablas del motor de stock. Llamar en beforeEach para aislar tests. */
export async function resetDb(ds: DataSource): Promise<void> {
  if (!constraintsAplicadas) {
    await applyInventoryConstraints(ds);
    // Las bitácoras son append-only por trigger en producción. Sin esto, un test
    // podría borrar o editar una fila de auditoría y pasar en verde.
    // `TRUNCATE` —lo que usa este mismo reset— no dispara triggers de fila.
    await applyAppendOnlyTriggers(ds);
    constraintsAplicadas = true;
  }
  await ds.query(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export type Basics = { product: Product; warehouse: Warehouse; location: Location; user: User };

/** Inserta un producto, un depósito y una ubicación de prueba. */
export async function seedBasics(ds: DataSource): Promise<Basics> {
  const product = await ds.getRepository(Product).save(
    ds.getRepository(Product).create({ code: 'P-TEST', description: 'Producto de prueba', unitOfMeasure: 'UN', active: true }),
  );
  const warehouse = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Depósito de prueba', documentCode: '01', active: true }),
  );
  const location = await ds.getRepository(Location).save(
    ds.getRepository(Location).create({ code: 'A-1', type: 'RACK', warehouse, active: true }),
  );
  const user = await ds.getRepository(User).save(ds.getRepository(User).create({
    id: TEST_USER_ID,
    username: 'operador.test',
    fullName: 'Operador de Prueba',
    passwordHash: 'not-used-in-tests',
    role: 'OPERATOR',
    active: true,
  }));
  // El usuario de prueba es OPERATOR, así que necesita la asignación explícita
  // al depósito. Los tests del motor de stock quedan así ejercitando el camino
  // real de permisos (`user_warehouses`) en vez de saltearlo con un rol global.
  await ds.getRepository(UserWarehouse).save(
    ds.getRepository(UserWarehouse).create({ userId: user.id, warehouseId: warehouse.id }),
  );
  return { product, warehouse, location, user };
}

/** Asigna un depósito al usuario de prueba (equivale a `user_warehouses`). */
export async function grantWarehouse(
  ds: DataSource,
  warehouseId: string,
  userId: string = TEST_USER_ID,
): Promise<void> {
  await ds.getRepository(UserWarehouse).save(
    ds.getRepository(UserWarehouse).create({ userId, warehouseId }),
  );
}

/**
 * `WarehouseAccessService` real conectado al DataSource de test.
 *
 * Se usa el servicio de verdad (no un doble) para que los tests ejerciten la
 * misma politica de permisos que produccion: un ADMIN tiene alcance global y no
 * cambia el comportamiento de los tests del motor de stock, mientras que un
 * OPERATOR queda acotado a sus asignaciones reales de `user_warehouses`.
 */
export function createAccessService(ds: DataSource): WarehouseAccessService {
  return new WarehouseAccessService(
    ds.getRepository(Warehouse),
    ds.getRepository(UserWarehouse),
    ds,
  );
}

/** `PermissionsService` real conectado al DataSource de test — mismo criterio que `createAccessService`. */
export function createPermissionsService(ds: DataSource): PermissionsService {
  return new PermissionsService(
    ds.getRepository(RolePermission),
    ds.getRepository(UserPermission),
  );
}

/**
 * Siembra `role_permissions` con la misma matriz que la migración real
 * (`ROLE_PERMISSIONS_SEED`) — así los tests ejercitan la configuración real
 * de los roles, no una inventada para la prueba.
 */
export async function seedRolePermissions(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(RolePermission);
  const rows = ROLE_PERMISSIONS_SEED.flatMap((row) =>
    row.roles.map((role) => repo.create({ role, module: row.module, action: row.action, allowed: true })),
  );
  await repo.save(rows);
}
