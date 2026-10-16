/**
 * ¿En qué depósito cae el inventario inicial?
 *
 * Antes la respuesta era `warehouses[0]`: el primer depósito activo que
 * devolviera la base, sin que nadie lo eligiera ni se enterara. Con un solo
 * depósito da lo mismo, pero con dos la carga entera podía caer en el
 * equivocado — y revertirla deja de ser posible en cuanto el depósito empieza a
 * operar, así que el error no tenía arreglo barato.
 *
 * Había además un bug más fino, que es el que fija el tercer test: la ubicación
 * `STOCK-INICIAL` se buscaba por código suelto, mientras el índice único es
 * `(warehouseId, code)`. Con la ubicación ya creada en un depósito, elegir el
 * otro no servía de nada: se reusaba la del primero y el stock aterrizaba ahí.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MovementsService } from '../src/modules/movements/movements.service';
import { DocumentSequenceService } from '../src/modules/movements/document-sequence.service';
import { PilasService } from '../src/modules/pilas/pilas.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Movement } from '../src/modules/movements/entities/movement.entity';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { UserWarehouse } from '../src/modules/warehouses/entities/user-warehouse.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { EventsGateway } from '../src/modules/events/events.gateway';
import type { CacheService } from '../src/modules/cache/cache.service';
import {
  createAccessService, createTestDataSource, grantWarehouse, resetDb, seedBasics,
  TEST_USER_ID, type Basics,
} from './test-datasource';

const noopEvents = { emitMovementCreated() {}, emitStockUpdated() {} } as unknown as EventsGateway;
const noopCache = { delPattern: async () => {} } as unknown as CacheService;

let ds: DataSource;
let movements: MovementsService;
let base: Basics;

/** Planilla de stock mínima, con el separador que Excel en español produce. */
function planilla(filas: string[][]): Buffer {
  const cabecera = 'codigo;descripcion;um;cantidad;fecha de vencimiento;lote proveedor';
  return Buffer.from([cabecera, ...filas.map((f) => f.join(';'))].join('\n'), 'utf8');
}

/**
 * Los códigos llevan dígitos a propósito: el importador rechaza los que no los
 * tienen ("código inválido"), y con un código tipo `P-NUEVO` las filas erraban
 * antes de llegar a la lógica del depósito — los tests pasaban sin probar nada.
 */
const UNA_FILA = planilla([['50142631', 'MATERIAL NUEVO', 'UN', '100', '31/12/2030', 'LOTE-A']]);

/**
 * Depósito activo extra, para que la elección deje de ser obvia.
 *
 * Se le asigna al usuario de prueba porque `create` valida el acceso al
 * depósito de la ubicación, y el usuario del harness es un OPERATOR acotado a
 * sus asignaciones. En producción la ruta es ADMIN —alcance global— así que sin
 * la asignación el test probaría un Forbidden del harness en vez de la lógica
 * de elección de depósito. Y como el snapshot atrapa el fallo por material y lo
 * devuelve como `status: 'ERROR'`, eso se vería como "no se creó el
 * movimiento", no como un error a la vista.
 */
async function otroDeposito(name = 'Depósito dos', active = true): Promise<Warehouse> {
  const repo = ds.getRepository(Warehouse);
  const warehouse = await repo.save(repo.create({ name, documentCode: '02', active }));
  await grantWarehouse(ds, warehouse.id);
  return warehouse;
}

const stockInicialDe = (warehouseId: string) =>
  ds.getRepository(Location).findOne({
    where: { code: 'STOCK-INICIAL', warehouse: { id: warehouseId } },
  });

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  const uploads = new UploadsService(ds.getRepository(Attachment), ds.getRepository(DocumentEvent));
  movements = new MovementsService(
    ds, noopEvents, noopCache, new DocumentSequenceService(), uploads,
    new PilasService(), createAccessService(ds),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('un solo depósito activo', () => {
  it('no hace falta elegirlo', async () => {
    const res = await movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, true);

    expect(res.warehouse).toEqual({ id: base.warehouse.id, name: base.warehouse.name });
    expect(res.summary.adjusted).toBe(1);
  });

  it('crea STOCK-INICIAL en ese depósito', async () => {
    await movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, true);

    const ubicacion = await stockInicialDe(base.warehouse.id);
    expect(ubicacion).not.toBeNull();
    expect(ubicacion!.zone).toBe('RECEPCION');
    // Staging, no estantería: sin capacidad declarada.
    expect(ubicacion!.capacityBases ?? null).toBeNull();
  });

  it('el ensayo informa el depósito sin crear la ubicación', async () => {
    const res = await movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, false);

    expect(res.warehouse?.id).toBe(base.warehouse.id);
    expect(await stockInicialDe(base.warehouse.id)).toBeNull();
  });
});

describe('varios depósitos activos', () => {
  it('se niega a adivinar y nombra los candidatos', async () => {
    const otro = await otroDeposito();

    const fallo = movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, true);
    await expect(fallo).rejects.toBeInstanceOf(BadRequestException);
    await expect(fallo).rejects.toThrow(new RegExp(otro.name));
    await expect(fallo).rejects.toThrow(new RegExp(base.warehouse.name));
  });

  /**
   * La ambigüedad se rechaza ya en el ensayo. Si sólo fallara al confirmar, el
   * operador vería una vista previa impecable y se enteraría del problema
   * recién después de apretar el botón irreversible.
   */
  it('el ensayo también se niega, y no escribe nada', async () => {
    await otroDeposito();

    await expect(
      movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, false),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await ds.getRepository(Movement).count()).toBe(0);
  });

  it('con el depósito elegido, carga ahí', async () => {
    const otro = await otroDeposito();

    const res = await movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, true, otro.id);

    expect(res.warehouse).toEqual({ id: otro.id, name: otro.name });
    // `adjusted`/`errors` explícitos: el snapshot atrapa el fallo por material
    // y lo devuelve como `status: 'ERROR'`, así que sin esto una carga que no
    // escribió nada pasaría igual mientras `res.warehouse` fuera el correcto.
    expect(res.summary).toMatchObject({ adjusted: 1, errors: 0 });
    const movimiento = await ds.getRepository(Movement).findOne({ where: {} });
    expect(movimiento!.warehouseId).toBe(otro.id);
  });

  /**
   * El bug del índice: `STOCK-INICIAL` ya existe en el primer depósito, y la
   * búsqueda por código suelto la devolvía para cualquier depósito. El stock
   * elegido para el segundo terminaba en el primero.
   */
  it('no reusa la STOCK-INICIAL de otro depósito', async () => {
    // Primera carga: crea STOCK-INICIAL en el depósito de `seedBasics`.
    const uno = await movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, true, base.warehouse.id);
    expect(uno.summary).toMatchObject({ adjusted: 1, errors: 0 });
    const primera = await stockInicialDe(base.warehouse.id);
    expect(primera).not.toBeNull();

    // Segunda carga en otro depósito, con otro material para que no la salte
    // por "ya tiene stock".
    const otro = await otroDeposito();
    const otraFila = planilla([['50809353', 'OTRO MATERIAL', 'UN', '50', '31/12/2030', 'LOTE-B']]);
    const dos = await movements.stockSnapshotFromLotList(otraFila, TEST_USER_ID, true, otro.id);
    expect(dos.summary).toMatchObject({ adjusted: 1, errors: 0 });

    const segunda = await stockInicialDe(otro.id);
    expect(segunda).not.toBeNull();
    expect(segunda!.id).not.toBe(primera!.id);

    const movimientos = await ds.getRepository(Movement).find({ order: { createdAt: 'ASC' } });
    expect(movimientos.map((m) => m.warehouseId)).toEqual([base.warehouse.id, otro.id]);
  });

  it('rechaza un depósito inactivo', async () => {
    const inactivo = await otroDeposito('Depósito de baja', false);

    await expect(
      movements.stockSnapshotFromLotList(UNA_FILA, TEST_USER_ID, true, inactivo.id),
    ).rejects.toThrow(/inactivo/);
  });

  it('rechaza un depósito que no existe', async () => {
    await expect(
      movements.stockSnapshotFromLotList(
        UNA_FILA, TEST_USER_ID, true, '00000000-0000-0000-0000-0000000000ff',
      ),
    ).rejects.toThrow(/no existe/);
  });
});

describe('acceso al depósito de quien carga', () => {
  /** Deja al usuario de prueba como un ADMIN real: alcance por rol, sin asignaciones. */
  async function volverAdminSinAsignaciones(): Promise<void> {
    await ds.getRepository(User).update({ id: TEST_USER_ID }, { role: 'ADMIN' });
    await ds.getRepository(UserWarehouse).delete({ userId: TEST_USER_ID });
  }

  /**
   * La forma que tiene esto en producción: la ruta es ADMIN, y un ADMIN tiene
   * alcance global **por su rol**, sin una sola fila en `user_warehouses`.
   *
   * `create` arma el usuario del chequeo como `{ userId, role: requesterRole ?? '' }`.
   * Si el snapshot no le pasa el rol, `hasGlobalScope('')` da false, se cae al
   * chequeo de asignaciones y la carga entera se rechaza — material por
   * material, y tragada por el try/catch como `status: 'ERROR'`, así que el
   * resultado dice "98 errores" en vez de fallar a la vista.
   *
   * Los demás tests de este archivo le asignan el depósito al usuario, que es
   * exactamente lo que impedía ver este agujero.
   */
  it('un ADMIN sin asignaciones carga igual: su alcance es el rol', async () => {
    await volverAdminSinAsignaciones();

    const res = await movements.stockSnapshotFromLotList(
      UNA_FILA, TEST_USER_ID, true, base.warehouse.id, 'ADMIN',
    );

    expect(res.summary).toMatchObject({ adjusted: 1, errors: 0 });
    expect(await ds.getRepository(Movement).count()).toBe(1);
  });

  /**
   * La contracara, que fija por qué el rol tiene que viajar: sin él, el mismo
   * ADMIN es rechazado. No es el comportamiento deseable —es la dependencia
   * real de `create`—, y este caso existe para que no se pierda de nuevo si
   * alguien limpia el parámetro por considerarlo redundante.
   */
  it('sin el rol, el mismo ADMIN queda sin acceso', async () => {
    await volverAdminSinAsignaciones();

    const res = await movements.stockSnapshotFromLotList(
      UNA_FILA, TEST_USER_ID, true, base.warehouse.id,
    );

    expect(res.summary.adjusted).toBe(0);
    expect(res.summary.errors).toBe(1);
    expect(res.products[0].error).toMatch(/acceso a este depósito/);
    expect(await ds.getRepository(Movement).count()).toBe(0);
  });
});

describe('archivo que no se puede leer', () => {
  /**
   * Un archivo del que no sale ninguna fila no es una carga de cero
   * materiales: es un archivo que no se pudo leer. Antes devolvía un resultado
   * con todo en cero y la pantalla decía "vista previa calculada".
   */
  it('se rechaza nombrando la hoja leída, en vez de devolver todo en cero', async () => {
    const soloEncabezado = planilla([]);

    const fallo = movements.stockSnapshotFromLotList(soloEncabezado, TEST_USER_ID, false);
    await expect(fallo).rejects.toBeInstanceOf(BadRequestException);
    await expect(fallo).rejects.toThrow(/PRIMERA hoja/);
  });
});
