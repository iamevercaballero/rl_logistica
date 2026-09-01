/**
 * Alcance por depósito de los adjuntos (RL-M-07).
 *
 * Hasta acá cualquier rol autenticado podía listar y descargar los adjuntos de
 * cualquier entidad con sólo conocer un UUID: un operador del depósito 02 veía
 * las fotos y los remitos del 01. El permiso fino `attachments:read` lo tienen
 * todos los roles, así que no acotaba nada.
 *
 * El control no puede vivir en el adjunto —no guarda depósito— sino en la
 * entidad a la que pertenece. Estos casos ejercitan esa resolución contra la
 * base, que es donde puede fallar en silencio.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { AdjustmentRequest } from '../src/modules/adjustments/entities/adjustment-request.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { AccessUser, WarehouseAccessService } from '../src/modules/warehouses/warehouse-access.service';
import {
  createAccessService,
  createTestDataSource,
  grantWarehouse,
  resetDb,
  seedBasics,
  TEST_USER_ID,
  type Basics,
} from './test-datasource';

let ds: DataSource;
let access: WarehouseAccessService;
let base: Basics;
let otroDeposito: Warehouse;

/** Operador acotado a `warehouseId`. */
async function operadorDe(warehouseId: string, username: string): Promise<AccessUser> {
  const repo = ds.getRepository(User);
  const u = await repo.save(
    repo.create({ username, fullName: username, passwordHash: 'x', role: 'OPERATOR', active: true }),
  );
  await grantWarehouse(ds, warehouseId, u.id);
  return { userId: u.id, role: 'OPERATOR' };
}

async function movimientoEn(warehouseId: string, locationId?: string): Promise<Movement> {
  const repo = ds.getRepository(Movement);
  return repo.save(
    repo.create({
      type: 'ENTRY', date: new Date(), productId: base.product.id, quantity: 5,
      warehouseId, locationId: locationId ?? null as unknown as undefined,
      createdById: TEST_USER_ID, status: 'NORMAL', voidStatus: 'NONE',
    }),
  );
}

async function ajusteEn(warehouseId: string | null): Promise<AdjustmentRequest> {
  const repo = ds.getRepository(AdjustmentRequest);
  return repo.save(
    repo.create({
      code: `RLAI-2026-${Math.floor(Math.random() * 900000 + 100000)}`,
      type: 'ADJUSTMENT_IN', status: 'BORRADOR', reason: 'DIFERENCIA_INVENTARIO',
      warehouseId, createdById: TEST_USER_ID, totalLines: 1, totalQuantity: 1,
    }),
  );
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  access = createAccessService(ds);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
  otroDeposito = await ds.getRepository(Warehouse).save(
    ds.getRepository(Warehouse).create({ name: 'Depósito 02', documentCode: '02', active: true }),
  );
  await ds.getRepository(Location).save(
    ds.getRepository(Location).create({ code: 'B-1', type: 'RACK', warehouse: otroDeposito, active: true }),
  );
});

describe('adjuntos de un movimiento', () => {
  it('el operador del otro depósito no alcanza el movimiento', async () => {
    // Es el caso del hallazgo: conocer el UUID no puede alcanzar.
    const mov = await movimientoEn(base.warehouse.id, base.location.id);
    const ajeno = await operadorDe(otroDeposito.id, 'operador.dep02');

    await expect(access.assertEntityAccess(ajeno, 'movement', mov.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('el operador de su propio depósito sí lo alcanza', async () => {
    const mov = await movimientoEn(base.warehouse.id, base.location.id);
    const propio = await operadorDe(base.warehouse.id, 'operador.dep01');

    await expect(access.assertEntityAccess(propio, 'movement', mov.id)).resolves.toBeDefined();
  });

  it('un rol de alcance global alcanza los dos depósitos', async () => {
    const enUno = await movimientoEn(base.warehouse.id, base.location.id);
    const enOtro = await movimientoEn(otroDeposito.id);
    const admin: AccessUser = { userId: TEST_USER_ID, role: 'ADMIN' };

    await expect(access.assertEntityAccess(admin, 'movement', enUno.id)).resolves.toBeDefined();
    await expect(access.assertEntityAccess(admin, 'movement', enOtro.id)).resolves.toBeDefined();
  });
});

describe('adjuntos de una solicitud de ajuste', () => {
  it('resuelve el depósito del ajuste, que antes el resolutor no conocía', async () => {
    // `adjustment` se agregó a `WarehouseSourceEntity` para esto: sin ese caso,
    // los adjuntos de un ajuste no tenían forma de resolver su depósito.
    const ajuste = await ajusteEn(base.warehouse.id);
    expect(await access.resolveEntityWarehouseId('adjustment', ajuste.id)).toBe(base.warehouse.id);
  });

  it('el operador del otro depósito no alcanza el ajuste', async () => {
    const ajuste = await ajusteEn(base.warehouse.id);
    const ajeno = await operadorDe(otroDeposito.id, 'operador.dep02');

    await expect(access.assertEntityAccess(ajeno, 'adjustment', ajuste.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('un ajuste sin depósito no se puede resolver, y por eso el controlador lo trata aparte', async () => {
    // Historia previa al multi-depósito. `resolveEntityWarehouseId` devuelve
    // null y `assertEntityAccess` responde 400 — también para un ADMIN, que es
    // el motivo por el que el controlador de adjuntos resuelve el depósito él
    // mismo y aplica el criterio de los ajustes: sin depósito, sólo los roles
    // de alcance global.
    const ajuste = await ajusteEn(null);
    expect(await access.resolveEntityWarehouseId('adjustment', ajuste.id)).toBeNull();
  });
});

describe('entidad inexistente', () => {
  it('un UUID que no existe no deja pasar a nadie', async () => {
    const operador = await operadorDe(base.warehouse.id, 'operador.dep01');
    // Rechaza; el tipo es BadRequestException porque el depósito no se puede
    // determinar. Lo que importa acá es que no pasa.
    await expect(
      access.assertEntityAccess(operador, 'movement', '00000000-0000-0000-0000-0000000000ee'),
    ).rejects.toThrow();
    expect(
      await access.resolveEntityWarehouseId('movement', '00000000-0000-0000-0000-0000000000ee'),
    ).toBeNull();
  });
});
