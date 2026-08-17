import { DataSource } from 'typeorm';
import { DestinationsService } from '../src/modules/destinations/destinations.service';
import { Destination } from '../src/modules/destinations/entities/destination.entity';
import { createTestDataSource, resetDb } from './test-datasource';

let ds: DataSource;
let service: DestinationsService;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new DestinationsService(ds.getRepository(Destination));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('destinos — catálogo de Salida', () => {
  it('crea, recorta y encuentra un destino mientras se escribe', async () => {
    const created = await service.create({ name: '  Cliente San Lorenzo  ' });
    await service.create({ name: 'Sucursal Encarnación' });

    expect(created.name).toBe('Cliente San Lorenzo');
    expect((await service.findAll('loren')).map((item) => item.name)).toEqual([
      'Cliente San Lorenzo',
    ]);
  });

  it('rechaza duplicados sin distinguir mayúsculas ni espacios', async () => {
    await service.create({ name: 'Centro de Distribución Este' });
    await expect(service.create({ name: ' centro DE distribución ESTE ' }))
      .rejects.toThrow(/Ya existe/i);
  });

  it('la baja es lógica y el catálogo operativo solo lista activos', async () => {
    const active = await service.create({ name: 'Destino Activo' });
    const inactive = await service.create({ name: 'Destino Inactivo' });
    await service.deactivate(inactive.id);

    expect((await service.findAll()).map((item) => item.id)).toEqual([active.id]);
    expect(await service.findOne(inactive.id)).toMatchObject({ active: false });
  });

  it('impide renombrar una ficha sobre otro destino existente', async () => {
    await service.create({ name: 'Destino Uno' });
    const two = await service.create({ name: 'Destino Dos' });

    await expect(service.update(two.id, { name: 'DESTINO UNO' })).rejects.toThrow(/Ya existe/i);
  });
});
