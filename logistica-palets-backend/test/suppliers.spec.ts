/**
 * Catálogo de proveedores. Lo que importa: que no se pueda partir el mismo
 * proveedor en dos filas por diferencias de mayúsculas o espacios — era
 * exactamente lo que pasaba cuando el proveedor era texto libre en el remito.
 */
import { DataSource } from 'typeorm';
import { SuppliersService } from '../src/modules/suppliers/suppliers.service';
import { Supplier } from '../src/modules/suppliers/entities/supplier.entity';
import { createTestDataSource, resetDb } from './test-datasource';

let ds: DataSource;
let service: SuppliersService;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new SuppliersService(ds.getRepository(Supplier), ds);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('proveedores — catálogo', () => {
  it('crea un proveedor con RUC opcional', async () => {
    const sinRuc = await service.create({ name: 'Distribuidora del Este' });
    expect(sinRuc.ruc).toBeNull();
    expect(sinRuc.active).toBe(true);

    const conRuc = await service.create({ name: 'Cervepar S.A.', ruc: '80012345-6' });
    expect(conRuc.ruc).toBe('80012345-6');
  });

  it('rechaza un nombre repetido aunque cambie la caja', async () => {
    await service.create({ name: 'Cervepar' });
    await expect(service.create({ name: 'CERVEPAR' })).rejects.toThrow(/Ya existe/i);
    await expect(service.create({ name: 'cervepar' })).rejects.toThrow(/Ya existe/i);
  });

  it('recorta espacios antes de comparar', async () => {
    await service.create({ name: 'Crown' });
    await expect(service.create({ name: '  Crown  ' })).rejects.toThrow(/Ya existe/i);
  });

  it('el listado por defecto solo trae los activos', async () => {
    const a = await service.create({ name: 'Activo SA' });
    const b = await service.create({ name: 'Inactivo SA' });
    await service.deactivate(b.id);

    const activos = await service.findAll();
    expect(activos.map((s) => s.id)).toEqual([a.id]);

    const todos = await service.findAll(undefined, true);
    expect(todos).toHaveLength(2);
  });

  it('busca por nombre y por RUC', async () => {
    await service.create({ name: 'Cervepar S.A.', ruc: '80012345-6' });
    await service.create({ name: 'Crown Paraguay' });

    expect((await service.findAll('cerve')).map((s) => s.name)).toEqual(['Cervepar S.A.']);
    expect((await service.findAll('80012345')).map((s) => s.name)).toEqual(['Cervepar S.A.']);
  });

  it('la baja es lógica: el proveedor sigue existiendo para el histórico', async () => {
    const s = await service.create({ name: 'Proveedor Viejo' });
    await service.deactivate(s.id);

    const encontrado = await service.findOne(s.id);
    expect(encontrado.active).toBe(false);
    expect(encontrado.name).toBe('Proveedor Viejo');
  });

  it('renombrar no puede chocar con otro proveedor existente', async () => {
    await service.create({ name: 'Uno' });
    const dos = await service.create({ name: 'Dos' });

    await expect(service.update(dos.id, { name: 'Uno' })).rejects.toThrow(/Ya existe/i);
    // Pero sí puede "renombrarse" a su propio nombre.
    await expect(service.update(dos.id, { name: 'Dos', ruc: '123' })).resolves.toBeDefined();
  });
});
