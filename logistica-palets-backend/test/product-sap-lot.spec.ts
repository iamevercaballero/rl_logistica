import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { LotsService } from '../src/modules/lots/lots.service';
import { PalletsService } from '../src/modules/pallets/pallets.service';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Product } from '../src/modules/products/entities/product.entity';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import type { UploadsService } from '../src/modules/uploads/uploads.service';
import {
  createTestDataSource,
  resetDb,
  seedBasics,
  TEST_USER_ID,
  type Basics,
  createAccessService,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;
const noopUploads = { log: async () => {} } as unknown as UploadsService;

const SAP_LOT = 'Z051308201';

let ds: DataSource;
let service: MovementsService;
let lots: LotsService;
let pallets: PalletsService;
let base: Basics;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new MovementsService(
    ds,
    noopEvents,
    noopCache,
    new DocumentSequenceService(),
    noopUploads,
    new PilasService(),
    createAccessService(ds),
  );
  lots = new LotsService(
    ds.getRepository(Lot),
    ds.getRepository(Product),
    ds.getRepository(Pallet),
  );
  pallets = new PalletsService(
    ds,
    ds.getRepository(Pallet),
    ds.getRepository(Lot),
    ds.getRepository(Location),
    new PilasService(),
    createAccessService(ds),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

/** Material configurado explícitamente como "no utiliza Lote SAP". */
async function noSapProduct(code = 'SIN-SAP') {
  return ds.getRepository(Product).save(
    ds.getRepository(Product).create({
      code,
      description: 'Material sin lote SAP',
      unitOfMeasure: 'UN',
      active: true,
      usesSapLot: false,
    }),
  );
}

/** Entrada RLNE mandando siempre el lote SAP de cabecera, como hace el formulario. */
async function entryWithSapLot(lines: { productId: string; lotCode: string; quantity?: number }[]) {
  return service.createDocument(
    {
      type: 'ENTRY',
      encargadoId: TEST_USER_ID,
      warehouseId: base.warehouse.id,
      lines: lines.map((line) => ({
        productId: line.productId,
        palletItems: [{
          lotCode: line.lotCode,
          quantity: line.quantity ?? 100,
          fechaVencimiento: '2027-12-31',
          sapLot: SAP_LOT,
          locationId: base.location.id,
        }],
      })),
    },
    TEST_USER_ID,
  );
}

const lotByCode = (lotCode: string) => ds.getRepository(Lot).findOneByOrFail({ lotCode });

describe('configuración de Lote SAP por material', () => {
  it('los materiales existentes nacen usando Lote SAP', async () => {
    // El default preserva el comportamiento actual: quien no configuró nada
    // sigue autocompletando el lote SAP en cada entrada.
    expect(base.product.usesSapLot).toBe(true);
    expect((await ds.getRepository(Product).findOneByOrFail({ id: base.product.id })).usesSapLot).toBe(true);
  });

  it('material loteable SAP: la entrada sigue autocompletando el lote SAP', async () => {
    await entryWithSapLot([{ productId: base.product.id, lotCode: 'CON-SAP-1' }]);

    expect((await lotByCode('CON-SAP-1')).sapLot).toBe(SAP_LOT);
  });

  it('material no loteable SAP: la entrada guarda el lote sin lote SAP', async () => {
    const product = await noSapProduct();
    await entryWithSapLot([{ productId: product.id, lotCode: 'SIN-SAP-1' }]);

    const lot = await lotByCode('SIN-SAP-1');
    expect(lot.sapLot).toBeNull();
    // Lo demás del lote queda intacto: la regla solo toca sapLot.
    expect(lot.lotCode).toBe('SIN-SAP-1');
    expect(lot.fechaVencimiento).toBe('2027-12-31');
    expect(lot.stockActual).toBe(100);
  });

  it('entrada multi-producto: cada material resuelve su propio Lote SAP', async () => {
    const sinSap = await noSapProduct();
    const created = await entryWithSapLot([
      { productId: base.product.id, lotCode: 'MIX-CON-SAP', quantity: 60 },
      { productId: sinSap.id, lotCode: 'MIX-SIN-SAP', quantity: 40 },
    ]);

    expect((await lotByCode('MIX-CON-SAP')).sapLot).toBe(SAP_LOT);
    expect((await lotByCode('MIX-SIN-SAP')).sapLot).toBeNull();
    // La entrada se registra completa: el material sin SAP no la hace fallar.
    expect(created.movementIds).toHaveLength(2);
    expect(await ds.getRepository(Pallet).count()).toBe(2);
  });

  it('apagar el flag después no borra los lotes SAP ya registrados', async () => {
    await entryWithSapLot([{ productId: base.product.id, lotCode: 'HIST-SAP' }]);
    expect((await lotByCode('HIST-SAP')).sapLot).toBe(SAP_LOT);

    base.product.usesSapLot = false;
    await ds.getRepository(Product).save(base.product);

    // El histórico queda igual...
    expect((await lotByCode('HIST-SAP')).sapLot).toBe(SAP_LOT);
    // ...y la configuración aplica solo a lo que venga después.
    await entryWithSapLot([{ productId: base.product.id, lotCode: 'HIST-SAP-2' }]);
    expect((await lotByCode('HIST-SAP-2')).sapLot).toBeNull();
  });

  it('un lote existente sin SAP no lo recibe en una entrada posterior del mismo material', async () => {
    const product = await noSapProduct();
    await entryWithSapLot([{ productId: product.id, lotCode: 'REPETIDO' }]);
    await entryWithSapLot([{ productId: product.id, lotCode: 'REPETIDO' }]);

    const lot = await lotByCode('REPETIDO');
    expect(lot.sapLot).toBeNull();
    expect(lot.stockActual).toBe(200);
  });
});

describe('corregir movimiento con la configuración de Lote SAP', () => {
  it('material loteable SAP: se puede corregir el lote SAP como hasta ahora', async () => {
    const created = await entryWithSapLot([{ productId: base.product.id, lotCode: 'EDIT-CON-SAP' }]);
    const lot = await lotByCode('EDIT-CON-SAP');

    const result = await service.requestQuantityEdit(
      created.movementIds[0],
      { reason: 'Corrección del lote SAP informado', lots: [{ lotId: lot.id, sapLot: 'Z999999999' }] },
      TEST_USER_ID,
    );

    expect(result.lotFieldChanges).toBe(1);
    expect(result.warnings).toEqual([]);
    expect((await lotByCode('EDIT-CON-SAP')).sapLot).toBe('Z999999999');
  });

  it('material no loteable SAP: la corrección avisa e ignora el lote SAP, sin cortar el resto', async () => {
    const product = await noSapProduct();
    const created = await entryWithSapLot([{ productId: product.id, lotCode: 'EDIT-SIN-SAP' }]);
    const lot = await lotByCode('EDIT-SIN-SAP');

    const result = await service.requestQuantityEdit(
      created.movementIds[0],
      {
        reason: 'Corrección de datos del lote',
        lots: [{ lotId: lot.id, sapLot: 'Z999999999', proveedor: 'PROVEEDOR CORREGIDO' }],
      },
      TEST_USER_ID,
    );

    // El proveedor sí se aplica; el lote SAP se ignora con aviso.
    expect(result.lotFieldChanges).toBe(1);
    expect(result.warnings).toEqual([
      'El material del lote EDIT-SIN-SAP no utiliza Lote SAP: ese dato no se modificó.',
    ]);
    const after = await lotByCode('EDIT-SIN-SAP');
    expect(after.sapLot).toBeNull();
    expect(after.proveedor).toBe('PROVEEDOR CORREGIDO');
  });

  it('editMetadata no propaga un lote SAP a un material que no los usa', async () => {
    const product = await noSapProduct();
    const created = await entryWithSapLot([{ productId: product.id, lotCode: 'META-SIN-SAP' }]);

    await service.editMetadata(
      created.movementIds[0],
      { reason: 'Carga del lote SAP', sapLot: 'Z999999999', proveedor: 'PROVEEDOR X' },
      TEST_USER_ID,
    );

    const lot = await lotByCode('META-SIN-SAP');
    expect(lot.sapLot).toBeNull();
    expect(lot.proveedor).toBe('PROVEEDOR X');
  });

  it('editMetadata sigue propagando el lote SAP a un material que sí los usa', async () => {
    const created = await entryWithSapLot([{ productId: base.product.id, lotCode: 'META-CON-SAP' }]);

    await service.editMetadata(
      created.movementIds[0],
      { reason: 'Corrección del lote SAP', sapLot: 'Z777777777' },
      TEST_USER_ID,
    );

    expect((await lotByCode('META-CON-SAP')).sapLot).toBe('Z777777777');
  });
});

describe('alta y edición manual de lotes', () => {
  it('rechaza asignar un lote SAP a un material que no los usa', async () => {
    const product = await noSapProduct('SIN-SAP-MANUAL');

    await expect(lots.create({ productId: product.id, lotCode: 'MANUAL-1', sapLot: SAP_LOT }))
      .rejects.toThrow('no utiliza Lote SAP');
    // Nada quedó a medias.
    expect(await ds.getRepository(Lot).count()).toBe(0);

    const created = await lots.create({ productId: product.id, lotCode: 'MANUAL-1' });
    expect(created.sapLot).toBeNull();
    await expect(lots.update(created.id, { sapLot: SAP_LOT })).rejects.toThrow('no utiliza Lote SAP');
    expect((await lotByCode('MANUAL-1')).sapLot).toBeNull();
  });

  it('permite el lote SAP manual en un material que sí los usa', async () => {
    const created = await lots.create({ productId: base.product.id, lotCode: 'MANUAL-2', sapLot: SAP_LOT });
    expect(created.sapLot).toBe(SAP_LOT);

    const updated = await lots.update(created.id, { sapLot: 'Z111111111' });
    expect(updated.sapLot).toBe('Z111111111');
  });

  it('editar otros datos de un lote histórico con SAP no lo borra aunque el material ya no los use', async () => {
    const created = await lots.create({ productId: base.product.id, lotCode: 'MANUAL-3', sapLot: SAP_LOT });
    base.product.usesSapLot = false;
    await ds.getRepository(Product).save(base.product);

    const updated = await lots.update(created.id, { proveedor: 'PROVEEDOR NUEVO' });
    expect(updated.proveedor).toBe('PROVEEDOR NUEVO');
    expect(updated.sapLot).toBe(SAP_LOT);
  });
});

describe('la configuración viaja al ajuste de inventario', () => {
  it('el listado de pallets informa la configuración real del material', async () => {
    // El buscador de materiales del ajuste arma el material desde el palet
    // cuando no viene del catálogo: necesita el dato exacto, no un default.
    const sinSap = await noSapProduct();
    await entryWithSapLot([
      { productId: base.product.id, lotCode: 'PAL-CON-SAP' },
      { productId: sinSap.id, lotCode: 'PAL-SIN-SAP' },
    ]);

    const rows = await pallets.findAll();
    const byLot = new Map(rows.map((row) => [row.lotCode, row]));

    expect(byLot.get('PAL-CON-SAP')?.usesSapLot).toBe(true);
    expect(byLot.get('PAL-SIN-SAP')?.usesSapLot).toBe(false);
  });

  it('el listado de pallets informa las reglas de apilamiento del material', async () => {
    // El detalle del palet las muestra: sin estos campos la pantalla caía
    // siempre en el default optimista, sin importar cómo esté el material.
    const rigido = await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        code: 'NO-APILABLE',
        description: 'Material que no se apila',
        unitOfMeasure: 'UN',
        active: true,
        stackable: false,
        canReceiveWeightOnTop: false,
        maxStackLevel: 2,
      }),
    );
    await entryWithSapLot([
      { productId: base.product.id, lotCode: 'PAL-APILABLE' },
      { productId: rigido.id, lotCode: 'PAL-RIGIDO' },
    ]);

    const byLot = new Map((await pallets.findAll()).map((row) => [row.lotCode, row]));

    expect(byLot.get('PAL-APILABLE')).toMatchObject({
      stackable: true,
      canReceiveWeightOnTop: true,
      maxStackLevel: null,
    });
    expect(byLot.get('PAL-RIGIDO')).toMatchObject({
      stackable: false,
      canReceiveWeightOnTop: false,
      maxStackLevel: 2,
    });
  });
});
