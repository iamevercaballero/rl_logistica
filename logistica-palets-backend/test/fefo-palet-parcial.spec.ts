/**
 * Un palet abierto sigue siendo despachable.
 *
 * El criterio de "qué palet cuenta como stock operable" estaba escrito a mano
 * en cada consulta y se desincronizó: el motor de salida (`autoFefoExit`)
 * aceptaba `AVAILABLE` y `PARTIAL`, pero la pantalla que ofrece los lotes
 * (`findFefo`) pedía sólo `AVAILABLE`.
 *
 * Consecuencia en el depósito: después de la primera salida parcial el palet
 * pasaba a `PARTIAL` y desaparecía de la pantalla de Salida, con su saldo
 * intacto y sin forma de despacharlo. Se ve sobre todo con el stock inicial,
 * donde hay un solo palet por lote: la primera salida parcial dejaba el lote
 * entero sin nada seleccionable, con el mensaje "No hay pallets disponibles y
 * ubicados en el depósito activo para este material".
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { LotsService } from '../src/modules/lots/lots.service';
import { Lot } from '../src/modules/lots/entities/lot.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Product } from '../src/modules/products/entities/product.entity';
import { createTestDataSource, resetDb, seedBasics, type Basics } from './test-datasource';

let ds: DataSource;
let lots: LotsService;
let base: Basics;

/** Un lote con un palet en la ubicación de `seedBasics`, en el estado pedido. */
async function lotePalet(lotCode: string, cantidad: number, status: string) {
  const lot = await ds.getRepository(Lot).save(
    ds.getRepository(Lot).create({
      productId: base.product.id,
      lotCode,
      fechaVencimiento: '2029-01-31',
      stockActual: cantidad,
      status: 'NORMAL',
    }),
  );
  const pallet = await ds.getRepository(Pallet).save(
    ds.getRepository(Pallet).create({
      code: `${base.product.code}-${lotCode}-P1`,
      lotId: lot.id,
      quantity: cantidad,
      currentLocationId: base.location.id,
      status,
    }),
  );
  return { lot, pallet };
}

/** Palets que la pantalla de Salida ofrecería para el material de prueba. */
async function paletsOfrecidos(): Promise<Pallet[]> {
  const filas = await lots.findFefo(base.product.id, undefined, undefined, [base.warehouse.id]);
  return filas.flatMap((f: { pallets?: Pallet[] }) => f.pallets ?? []);
}

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  lots = new LotsService(
    ds.getRepository(Lot),
    ds.getRepository(Product),
    ds.getRepository(Pallet),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  base = await seedBasics(ds);
});

describe('findFefo — qué palets ofrece la pantalla de Salida', () => {
  it('ofrece un palet intacto', async () => {
    await lotePalet('L-INTACTO', 100, 'AVAILABLE');
    const ofrecidos = await paletsOfrecidos();
    expect(ofrecidos.map((p) => p.code)).toEqual([`${base.product.code}-L-INTACTO-P1`]);
  });

  /** El caso que faltaba: el palet abierto tiene saldo y hay que poder sacarlo. */
  it('ofrece también un palet PARCIAL con saldo', async () => {
    await lotePalet('L-ABIERTO', 2377, 'PARTIAL');
    const ofrecidos = await paletsOfrecidos();
    expect(ofrecidos.map((p) => p.code)).toEqual([`${base.product.code}-L-ABIERTO-P1`]);
    expect(Number(ofrecidos[0].quantity)).toBe(2377);
  });

  it('se puede seguir despachando hasta agotarlo: el saldo nunca queda inalcanzable', async () => {
    // Tres salidas parciales sobre el mismo palet, como en el depósito.
    const { pallet } = await lotePalet('L-TRES-SALIDAS', 1000, 'AVAILABLE');
    const repo = ds.getRepository(Pallet);

    for (const saldo of [700, 400, 100]) {
      await repo.update(pallet.id, { quantity: saldo, status: 'PARTIAL' });
      const ofrecidos = await paletsOfrecidos();
      expect(ofrecidos.map((p) => p.code)).toContain(pallet.code);
    }
  });

  it('no ofrece un palet sin saldo, aunque figure como PARCIAL', async () => {
    const { pallet } = await lotePalet('L-VACIO', 50, 'PARTIAL');
    await ds.getRepository(Pallet).update(pallet.id, { quantity: 0 });
    expect(await paletsOfrecidos()).toHaveLength(0);
  });

  it.each(['BLOCKED', 'DAMAGED', 'EXITED', 'EMPTY'])(
    'no ofrece un palet en estado %s',
    async (status) => {
      await lotePalet(`L-${status}`, 100, status);
      expect(await paletsOfrecidos()).toHaveLength(0);
    },
  );

  it('no ofrece un palet sin ubicación: no se puede despachar lo que no está en el depósito', async () => {
    const { pallet } = await lotePalet('L-SIN-UBIC', 100, 'AVAILABLE');
    await ds.getRepository(Pallet).update(pallet.id, { currentLocationId: null });
    expect(await paletsOfrecidos()).toHaveLength(0);
  });
});
