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

export const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';

/**
 * Conjunto mínimo de entidades que toca el motor de stock. No incluye User /
 * Transport / billing porque no hay relaciones (los IDs son columnas uuid planas),
 * así que synchronize crea sólo estas tablas y sus FKs (Lot→Product, Location→Warehouse).
 */
export const TEST_ENTITIES = [
  Product, Warehouse, Location, Stock, Lot, Pallet, Pila, Supplier, Destination, User,
  Movement, MovementDetail, LogisticsDocument, DocumentSequence, RegularizationLog,
  AdjustmentRequest, AdjustmentRequestLine, Attachment, DocumentEvent, SapStockSnapshot,
];

/** Tablas a vaciar entre tests (orden irrelevante por CASCADE). */
const TABLES = [
  'movement_details', 'movements', 'stocks', 'pallets', 'pilas', 'lots',
  'logistics_documents', 'regularization_logs',
  'adjustment_request_lines', 'adjustment_requests',
  'attachments', 'document_events', 'document_sequences',
  'sap_stock_snapshots', 'products', 'locations', 'warehouses', 'suppliers', 'destinations', 'users',
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
  });
}

/** Vacía las tablas del motor de stock. Llamar en beforeEach para aislar tests. */
export async function resetDb(ds: DataSource): Promise<void> {
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
  return { product, warehouse, location, user };
}
