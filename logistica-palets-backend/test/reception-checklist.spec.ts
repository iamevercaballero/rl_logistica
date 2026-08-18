import { DataSource } from 'typeorm';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { CHECKLIST_SEE_DETAILS } from '../src/modules/movements/reception-checklist';
import { Product } from '../src/modules/products/entities/product.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { User } from '../src/modules/users/entities/user.entity';
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

let ds: DataSource;
let service: MovementsService;
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
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

/** Segundo producto para los casos multi-material. */
async function secondProduct() {
  return ds.getRepository(Product).save(
    ds.getRepository(Product).create({
      code: '50144376',
      description: 'INTERLAYER CARTON 116 X 97M.',
      unitOfMeasure: 'UN',
      active: true,
    }),
  );
}

type ItemInput = {
  lotCode: string;
  quantity: number;
  fechaFabricacion?: string;
  fechaVencimiento?: string;
  sapLot?: string;
};

/**
 * Entrada RLNE con una línea por producto y un `palletItem` por paleta física.
 * El vencimiento es obligatorio para registrar una entrada, así que los casos
 * que no lo declaran reciben uno por defecto.
 */
async function createEntry(
  lines: { productId: string; items: ItemInput[] }[],
  header: {
    supplier?: string;
    documentNumber?: string;
    carrier?: string;
    driver?: string;
    driverDocument?: string;
    vehiclePlate?: string;
    date?: string;
  } = {},
) {
  return service.createDocument(
    {
      type: 'ENTRY',
      warehouseId: base.warehouse.id,
      supplier: 'PROVEEDOR DE PRUEBA S.A.',
      ...header,
      lines: lines.map((line) => ({
        productId: line.productId,
        palletItems: line.items.map((item) => ({
          fechaVencimiento: '2027-12-31',
          ...item,
          locationId: base.location.id,
        })),
      })),
    },
    TEST_USER_ID,
  );
}

describe('checklist de recepción — resumen de la Página 1', () => {
  it('Caso 1: un producto y un lote autocompletan toda la cabecera', async () => {
    const created = await createEntry(
      [
        {
          productId: base.product.id,
          items: [
            {
              lotCode: 'L160826C',
              quantity: 500,
              fechaFabricacion: '2026-08-10',
              fechaVencimiento: '2027-08-15',
              sapLot: 'Z051308201',
            },
          ],
        },
      ],
      { documentNumber: 'MIC-000123' },
    );

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.document.code).toBe('RLNE-01-000001');
    expect(checklist.document.supplier).toBe('PROVEEDOR DE PRUEBA S.A.');
    // Punto 2: el N° de Factura del formulario es el MIC/Factura/Remito de la Entrada.
    expect(checklist.document.documentNumber).toBe('MIC-000123');
    // Punto 3: el N° de MIC propio nunca se copia del remito, se completa a mano.
    expect(checklist.document.micNumber).toBeNull();
    expect(checklist.document.originCountry).toBe('PARAGUAY');
    // Punto 11 y 12: hoy Arribo = Descarga = fecha de la Entrada.
    expect(checklist.document.arrivalDate).toBe(checklist.document.date);
    expect(checklist.document.unloadDate).toBe(checklist.document.date);

    expect(checklist.summary).toMatchObject({
      productDisplay: 'P-TEST - Producto de prueba',
      lotDisplay: 'L160826C',
      fabricationDisplay: '2026-08-10',
      expirationDisplay: '2027-08-15',
      sapLotDisplay: 'Z051308201',
      totalPallets: 1,
      totalQuantity: 500,
    });
    expect(checklist.receptionResponsible).toBe('Operador de Prueba');
    expect(checklist.consistency.ok).toBe(true);
  });

  it('Caso 2: un producto con varios lotes deja el producto y manda el resto a VER DETALLES', async () => {
    const created = await createEntry([
      {
        productId: base.product.id,
        items: [
          { lotCode: 'L001', quantity: 500, fechaFabricacion: '2026-08-10', fechaVencimiento: '2027-08-15', sapLot: 'Z01' },
          { lotCode: 'L001', quantity: 300, fechaFabricacion: '2026-08-10', fechaVencimiento: '2027-08-15', sapLot: 'Z01' },
          { lotCode: 'L002', quantity: 200, fechaFabricacion: '2026-08-11', fechaVencimiento: '2027-08-20', sapLot: 'Z02' },
        ],
      },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.summary.productDisplay).toBe('P-TEST - Producto de prueba');
    expect(checklist.summary.lotDisplay).toBe(CHECKLIST_SEE_DETAILS);
    expect(checklist.summary.fabricationDisplay).toBe(CHECKLIST_SEE_DETAILS);
    expect(checklist.summary.expirationDisplay).toBe(CHECKLIST_SEE_DETAILS);
    expect(checklist.summary.sapLotDisplay).toBe(CHECKLIST_SEE_DETAILS);

    // Página 2 con una fila por producto+lote: L001 agrupa sus dos paletas.
    expect(checklist.lots).toHaveLength(2);
    expect(checklist.lots.map((row) => [row.lotCode, row.quantity, row.pallets])).toEqual([
      ['L001', 800, 2],
      ['L002', 200, 1],
    ]);
    // Punto 20: un único material, con todos sus lotes sumados en una fila.
    expect(checklist.materials).toEqual([
      {
        productId: base.product.id,
        code: 'P-TEST',
        description: 'Producto de prueba',
        unitOfMeasure: 'UN',
        totalQuantity: 1000,
        totalPallets: 3,
      },
    ]);
  });

  it('un producto con varios lotes que comparten fecha mantiene la fecha en la cabecera', async () => {
    const created = await createEntry([
      {
        productId: base.product.id,
        items: [
          { lotCode: 'A1', quantity: 100, fechaFabricacion: '2026-08-10', fechaVencimiento: '2027-08-15', sapLot: 'Z9' },
          { lotCode: 'A2', quantity: 100, fechaFabricacion: '2026-08-10', fechaVencimiento: '2027-08-15', sapLot: 'Z9' },
        ],
      },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.summary.lotDisplay).toBe(CHECKLIST_SEE_DETAILS);
    // Las fechas y el lote SAP sí son inequívocos: se autocompletan igual.
    expect(checklist.summary.fabricationDisplay).toBe('2026-08-10');
    expect(checklist.summary.expirationDisplay).toBe('2027-08-15');
    expect(checklist.summary.sapLotDisplay).toBe('Z9');
  });

  it('Caso 3: varios productos mandan producto y lote a VER DETALLES', async () => {
    const other = await secondProduct();
    const created = await createEntry([
      {
        productId: base.product.id,
        items: [{ lotCode: 'P1-L1', quantity: 100, fechaVencimiento: '2027-01-01' }],
      },
      {
        productId: other.id,
        items: [
          { lotCode: 'P2-L1', quantity: 250, fechaVencimiento: '2027-02-01' },
          { lotCode: 'P2-L2', quantity: 250, fechaVencimiento: '2027-03-01' },
        ],
      },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.summary.productDisplay).toBe(CHECKLIST_SEE_DETAILS);
    expect(checklist.summary.lotDisplay).toBe(CHECKLIST_SEE_DETAILS);
    expect(checklist.summary.expirationDisplay).toBe(CHECKLIST_SEE_DETAILS);
    // Sin lote SAP en ningún lote: el campo queda vacío para completar a mano,
    // no "VER DETALLES" (no hay nada que detallar).
    expect(checklist.summary.sapLotDisplay).toBeNull();
    expect(checklist.summary.fabricationDisplay).toBeNull();

    expect(checklist.materials).toHaveLength(2);
    expect(checklist.materials.map((m) => [m.code, m.totalQuantity, m.totalPallets])).toEqual([
      ['P-TEST', 100, 1],
      ['50144376', 500, 2],
    ]);
    expect(checklist.lots).toHaveLength(3);
    expect(checklist.lots[1].productCode).toBe('50144376');
    expect(checklist.lots[1].productDescription).toBe('INTERLAYER CARTON 116 X 97M.');
  });
});

describe('checklist de recepción — datos operativos', () => {
  it('Caso 4: conserva los decimales de numeric(14,3)', async () => {
    const created = await createEntry([
      {
        productId: base.product.id,
        items: [
          { lotCode: 'KG-1', quantity: 2117.2, fechaVencimiento: '2027-05-05' },
          { lotCode: 'KG-2', quantity: 1058.605, fechaVencimiento: '2027-05-05' },
        ],
      },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.lots.map((row) => row.quantity)).toEqual([2117.2, 1058.605]);
    expect(checklist.summary.totalQuantity).toBe(3175.805);
    expect(checklist.materials[0].totalQuantity).toBe(3175.805);
    expect(checklist.consistency.ok).toBe(true);
  });

  it('Caso 5: sin datos de transporte el checklist se genera con esos campos vacíos', async () => {
    const created = await createEntry([
      { productId: base.product.id, items: [{ lotCode: 'SIN-TTE', quantity: 10 }] },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.document.carrier).toBeNull();
    expect(checklist.document.driver).toBeNull();
    expect(checklist.document.driverDocument).toBeNull();
    expect(checklist.document.vehiclePlate).toBeNull();
    expect(checklist.document.code).toBe('RLNE-01-000001');
    expect(checklist.lots).toHaveLength(1);
  });

  it('Caso 6: el transporte cargado a mano viaja como snapshot del RLNE', async () => {
    const created = await createEntry(
      [{ productId: base.product.id, items: [{ lotCode: 'TTE-MAN', quantity: 10 }] }],
      {
        carrier: 'TRANSPORTES MANUALES S.A.',
        driver: 'Juan Pérez',
        driverDocument: '1234567',
        vehiclePlate: 'ABC 123',
      },
    );

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.document.carrier).toBe('TRANSPORTES MANUALES S.A.');
    expect(checklist.document.driver).toBe('Juan Pérez');
    expect(checklist.document.driverDocument).toBe('1234567');
    expect(checklist.document.vehiclePlate).toBe('ABC 123');
  });

  it('Caso 7: las fechas de lote son fechas puras y no se corren de día', async () => {
    const created = await createEntry([
      {
        productId: base.product.id,
        items: [{ lotCode: 'FECHA-1', quantity: 10, fechaFabricacion: '2026-08-10', fechaVencimiento: '2027-08-15' }],
      },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    // Se transportan tal cual: el formateo DD/MM/AAAA lo hace el frontend con
    // `formatDateOnly`, que no aplica conversión de zona a una fecha calendario.
    expect(checklist.summary.fabricationDisplay).toBe('2026-08-10');
    expect(checklist.summary.expirationDisplay).toBe('2027-08-15');
    expect(checklist.lots[0].fechaFabricacion).toBe('2026-08-10');
    expect(checklist.lots[0].fechaVencimiento).toBe('2027-08-15');
  });

  it('Caso 8 y 9: los totales de la Página 1 cierran con el detalle de la Página 2', async () => {
    const other = await secondProduct();
    const created = await createEntry([
      {
        productId: base.product.id,
        items: [
          { lotCode: 'T-1', quantity: 100 },
          { lotCode: 'T-2', quantity: 150 },
        ],
      },
      {
        productId: other.id,
        items: [
          { lotCode: 'T-3', quantity: 200 },
          { lotCode: 'T-3', quantity: 200 },
          { lotCode: 'T-4', quantity: 50 },
        ],
      },
    ]);

    const checklist = await service.findDocumentChecklist(created.documentId);
    const sumPallets = checklist.lots.reduce((sum, row) => sum + row.pallets, 0);
    const sumQuantity = checklist.lots.reduce((sum, row) => sum + row.quantity, 0);

    // Punto 13: total real de paletas de todo el RLNE (2 + 3), no `totalLines`.
    expect(checklist.summary.totalPallets).toBe(5);
    expect(sumPallets).toBe(checklist.summary.totalPallets);
    expect(sumQuantity).toBe(checklist.summary.totalQuantity);
    expect(checklist.summary.totalQuantity).toBe(checklist.consistency.documentTotalQuantity);
    expect(checklist.consistency).toMatchObject({
      ok: true,
      computedTotalPallets: 5,
      documentTotalPallets: 5,
      warnings: [],
    });

    // El mismo total de paletas que imprime la Nota de Entrada.
    const print = await service.findDocumentForPrint(created.documentId);
    const notaPallets = print.movements.reduce(
      (sum, movement) =>
        sum + (print.details.filter((d) => d.movementId === movement.id && d.palletId).length || movement.pallets || 0),
      0,
    );
    expect(notaPallets).toBe(checklist.summary.totalPallets);
  });

  it('Caso 10: reimprimir después de renombrar producto, usuario y transporte no altera los snapshots', async () => {
    const created = await createEntry(
      [{ productId: base.product.id, items: [{ lotCode: 'HIST-1', quantity: 80, fechaVencimiento: '2027-09-09' }] }],
      { carrier: 'TRANSPORTE ORIGINAL', driver: 'Chofer Original', vehiclePlate: 'AAA 111' },
    );
    const before = await service.findDocumentChecklist(created.documentId);

    base.user.fullName = 'Nombre Cambiado Después';
    await ds.getRepository(User).save(base.user);

    const after = await service.findDocumentChecklist(created.documentId);

    // Cabecera y responsable: snapshots del RLNE, inmunes a cambios posteriores.
    expect(after.document.carrier).toBe('TRANSPORTE ORIGINAL');
    expect(after.document.driver).toBe('Chofer Original');
    expect(after.document.vehiclePlate).toBe('AAA 111');
    expect(after.receptionResponsible).toBe('Operador de Prueba');
    expect(after.receptionResponsible).toBe(before.receptionResponsible);

    // El catálogo de productos no tiene snapshot histórico: la descripción es
    // la vigente, igual que en la Nota de Entrada.
    base.product.description = 'Producto renombrado';
    await ds.getRepository(Product).save(base.product);
    const renamed = await service.findDocumentChecklist(created.documentId);
    expect(renamed.lots[0].productDescription).toBe('Producto renombrado');
    expect(renamed.lots[0].lotCode).toBe('HIST-1');
    expect(renamed.lots[0].fechaVencimiento).toBe('2027-09-09');
  });

  it('Caso 11: un RLNS no tiene checklist de recepción', async () => {
    const entry = await createEntry([
      { productId: base.product.id, items: [{ lotCode: 'PARA-SALIR', quantity: 100 }] },
    ]);
    expect(entry.code).toBe('RLNE-01-000001');

    const pallet = await ds.getRepository(Pallet).findOneOrFail({ where: { currentLocationId: base.location.id } });
    const exit = await service.createDocument(
      {
        type: 'EXIT',
        lines: [{ productId: base.product.id, palletItems: [{ palletId: pallet.id, quantity: 10 }] }],
      },
      TEST_USER_ID,
    );

    await expect(service.findDocumentChecklist(exit.documentId)).rejects.toThrow(
      'solo aplica a documentos de Entrada',
    );
  });

  it('Caso 12: una entrada con muchos lotes devuelve todas las filas, sin recortar', async () => {
    const items = Array.from({ length: 45 }, (_, index) => ({
      lotCode: `MASIVO-${String(index + 1).padStart(3, '0')}`,
      quantity: 10 + index,
      fechaVencimiento: '2027-12-31',
    }));
    const created = await createEntry([{ productId: base.product.id, items }]);

    const checklist = await service.findDocumentChecklist(created.documentId);

    expect(checklist.lots).toHaveLength(45);
    expect(new Set(checklist.lots.map((row) => row.lotCode)).size).toBe(45);
    expect(checklist.summary.totalPallets).toBe(45);
    expect(checklist.summary.lotDisplay).toBe(CHECKLIST_SEE_DETAILS);
    expect(checklist.consistency.ok).toBe(true);
  });
});
